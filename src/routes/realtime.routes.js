const WebSocket = require('ws');
const { createVoiceAgentSession, voiceChatToolDefinitions } = require('../core/voice-agent');
const {
  buildAzureVoiceConfig,
  ensureAzureVoiceConfig,
  transcribePcm16Buffer,
  synthesizeSpeech,
  runAzureVoiceToolLoop,
} = require('../core/voice-azure-audio');

const SAMPLE_RATE = 24000;
const SPEECH_RMS_THRESHOLD = Number(process.env.MESH_VOICE_VAD_THRESHOLD || 0.012);
const SPEECH_PREFIX_MS = Number(process.env.MESH_VOICE_VAD_PREFIX_MS || 240);
const SPEECH_SILENCE_MS = Number(process.env.MESH_VOICE_VAD_SILENCE_MS || 720);
const MIN_UTTERANCE_MS = Number(process.env.MESH_VOICE_MIN_UTTERANCE_MS || 280);
const MAX_UTTERANCE_MS = Number(process.env.MESH_VOICE_MAX_UTTERANCE_MS || 14000);
const AUDIO_DELTA_BYTES = Number(process.env.MESH_VOICE_AUDIO_DELTA_BYTES || 4096);
const PERF_LOG = ['1', 'true', 'yes', 'on'].includes(String(process.env.MESH_WORKSPACE_PERF_LOG || '').trim().toLowerCase());

/**
 * @param {import('http').Server} server
 * @param {object} core  All exports from src/core/index.js
 */
function setupRealtimeRelay(server, core) {
  const { readAuthTokenFromRequest, resolveAuthUserFromRequest } = core;
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/api/realtime') return;

    try {
      const token = readAuthTokenFromRequest(req);
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const resolved = await resolveAuthUserFromRequest(req);
      if (!resolved) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        handleSession(clientWs, { authUserId: resolved.user.id, core });
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
}

/**
 * @param {object} core
 * @returns {object}
 */
function buildVoiceDeps(core) {
  const {
    MESH_DEFAULT_MODEL,
    toSafePath,
    assistantRuns,
    assistantRunSnapshot,
    createAssistantRun,
    applyAssistantRunDecision,
    getStoredCredentialsForUser,
    mergeChatCredentials,
    openWorkspaceFileWithFallback,
    recoverWorkspaceWithFallback,
    searchWorkspaceWithFallback,
    runGitWithFallback,
    localGitStatus,
    runLocalGit,
    gitPathFromWorkspacePath,
    workspacePathFromGitPath,
    resolveLocalWorkspaceAbsolutePath,
    readLocalWorkspaceFileText,
    localWorkspaceSave,
  } = core;
  return {
    MESH_DEFAULT_MODEL,
    toSafePath,
    assistantRuns,
    assistantRunSnapshot,
    createAssistantRun,
    applyAssistantRunDecision,
    getStoredCredentialsForUser,
    mergeChatCredentials,
    openWorkspaceFileWithFallback,
    recoverWorkspaceWithFallback,
    searchWorkspaceWithFallback,
    runGitWithFallback,
    localGitStatus,
    runLocalGit,
    gitPathFromWorkspacePath,
    workspacePathFromGitPath,
    resolveLocalWorkspaceAbsolutePath,
    readLocalWorkspaceFileText,
    localWorkspaceSave,
  };
}

function createSpeechState() {
  return {
    speechActive: false,
    processing: false,
    utteranceChunks: [],
    preRollChunks: [],
    utteranceMs: 0,
    silenceMs: 0,
  };
}

function logVoicePerf(label, meta = {}) {
  if (!PERF_LOG) return;
  try {
    console.log(`[voice][perf] ${label}`, meta);
  } catch { /* ignore log errors */ }
}

function decodeAudioChunk(base64) {
  const raw = String(base64 || '').trim();
  if (!raw) return Buffer.alloc(0);
  try {
    return Buffer.from(raw, 'base64');
  } catch {
    return Buffer.alloc(0);
  }
}

function chunkDurationMs(pcmBuffer) {
  return Math.round((pcmBuffer.length / 2 / SAMPLE_RATE) * 1000);
}

function computeChunkRms(pcmBuffer) {
  if (!pcmBuffer || !pcmBuffer.length) return 0;
  let sumSquares = 0;
  const samples = Math.floor(pcmBuffer.length / 2);
  for (let idx = 0; idx < samples; idx += 1) {
    const value = pcmBuffer.readInt16LE(idx * 2) / 32768;
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / Math.max(samples, 1));
}

function pushPreRollChunk(speechState, pcmBuffer) {
  if (!pcmBuffer.length) return;
  const durationMs = chunkDurationMs(pcmBuffer);
  speechState.preRollChunks.push({ pcmBuffer, durationMs });
  let total = speechState.preRollChunks.reduce((sum, entry) => sum + entry.durationMs, 0);
  while (total > SPEECH_PREFIX_MS && speechState.preRollChunks.length > 1) {
    total -= speechState.preRollChunks.shift().durationMs;
  }
}

function resetSpeechCapture(speechState) {
  speechState.speechActive = false;
  speechState.utteranceChunks = [];
  speechState.utteranceMs = 0;
  speechState.silenceMs = 0;
}

function buildAssistantResponseText(result) {
  const text = String(result?.text || '').trim();
  if (text) return text;
  if (result?.finishReason === 'max_steps') return 'I made progress but hit the voice tool step limit before finishing.';
  return 'I finished the request.';
}

/**
 * @param {object} context
 * @param {object} core
 * @returns {Promise<string[]>}
 */
async function listVoiceContextPaths(context = {}, core = {}) {
  const { dedupePaths, toSafePath, workspaceMetadataStore } = core;
  // Access localAssistantWorkspace directly on core — live state, not a startup snapshot
  const localAssistantWorkspace = core.localAssistantWorkspace;

  const rawPaths = [
    context.activeFilePath,
    ...(Array.isArray(context.selectedPaths) ? context.selectedPaths : []),
  ];
  const preferred = (dedupePaths ? dedupePaths(rawPaths) : rawPaths)
    .map((entry) => toSafePath ? toSafePath(entry) : String(entry || '').trim())
    .filter(Boolean);

  if (preferred.length) return preferred.slice(0, 6);

  const workspaceId = String(context.workspaceId || localAssistantWorkspace?.workspaceId || '').trim();
  if (workspaceMetadataStore?.enabled && workspaceId) {
    try {
      const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
      return docs
        .map((doc) => toSafePath ? toSafePath(doc?.path) : String(doc?.path || '').trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch { /* ignore metadata listing errors */ }
  }

  return Array.from(localAssistantWorkspace?.files?.keys?.() || []).slice(0, 6);
}

/**
 * @param {object} voiceSession
 * @param {object} core
 * @returns {Promise<string>}
 */
async function buildVoiceCapsuleContext(voiceSession, core = {}) {
  const { loadCapsuleContextEntries, buildCapsuleContextBlock } = core;
  const context = typeof voiceSession?.getContextSnapshot === 'function'
    ? voiceSession.getContextSnapshot()
    : {};
  const paths = await listVoiceContextPaths(context, core);
  if (!paths.length) return '';
  const result = await loadCapsuleContextEntries(paths, { maxFiles: 5, maxModelChars: 5000 });
  return buildCapsuleContextBlock(result.entries || [], []);
}

async function handleSession(clientWs, options = {}) {
  const { core } = options;
  const voiceConfig = buildAzureVoiceConfig(process.env);
  try {
    ensureAzureVoiceConfig(voiceConfig);
  } catch (error) {
    clientWs.send(JSON.stringify({ type: 'error', error: { message: String(error?.message || 'Voice service not configured') } }));
    clientWs.close();
    return;
  }

  let sessionConfigured = false;
  let clientClosed = false;
  let conversationMessages = [];
  const speechState = createSpeechState();
  const voiceSession = createVoiceAgentSession({
    authUserId: String(options?.authUserId || ''),
    deps: buildVoiceDeps(core),
    sendClientEvent,
    sendAzureEvent: () => {},
  });

  function sendClientEvent(payload) {
    if (clientWs.readyState !== WebSocket.OPEN) return;
    try {
      clientWs.send(JSON.stringify(payload));
    } catch {}
  }

  async function streamSpeechResponse(text) {
    const replyText = String(text || '').trim();
    if (!replyText) {
      sendClientEvent({ type: 'response.done' });
      return;
    }

    sendClientEvent({
      type: 'response.output_audio_transcript.done',
      transcript: replyText,
    });

    const spoken = await synthesizeSpeech(replyText, voiceConfig, {
      voice: voiceConfig.voice,
      responseFormat: 'pcm',
    });

    const audio = Buffer.isBuffer(spoken.audio) ? spoken.audio : Buffer.alloc(0);
    for (let offset = 0; offset < audio.length; offset += AUDIO_DELTA_BYTES) {
      const slice = audio.subarray(offset, Math.min(audio.length, offset + AUDIO_DELTA_BYTES));
      sendClientEvent({
        type: 'response.output_audio.delta',
        delta: slice.toString('base64'),
      });
    }
    sendClientEvent({ type: 'response.done' });
  }

  async function finalizeUtterance(reason = 'vad') {
    if (speechState.processing) return;
    if (!speechState.utteranceChunks.length) {
      resetSpeechCapture(speechState);
      return;
    }
    if (speechState.utteranceMs < MIN_UTTERANCE_MS) {
      resetSpeechCapture(speechState);
      return;
    }

    speechState.processing = true;
    const utteranceBuffer = Buffer.concat(speechState.utteranceChunks);
    const utteranceMs = speechState.utteranceMs;
    resetSpeechCapture(speechState);
    sendClientEvent({ type: 'input_audio_buffer.speech_stopped', reason });

    try {
      const transcribeStartedAt = Date.now();
      const transcription = await transcribePcm16Buffer(utteranceBuffer, voiceConfig, {
        sampleRate: SAMPLE_RATE,
        filename: 'voice-turn.wav',
      });
      logVoicePerf('transcription', {
        utteranceMs,
        elapsedMs: Date.now() - transcribeStartedAt,
        textChars: String(transcription.text || '').length,
      });

      const transcript = String(transcription.text || '').trim();
      if (!transcript) {
        sendClientEvent({
          type: 'voice.narration',
          text: 'I did not catch that. Please try again.',
          appendToChat: false,
        });
        await streamSpeechResponse('I did not catch that. Please try again.');
        return;
      }

      sendClientEvent({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript,
      });

      let capsuleContext = '';
      try {
        capsuleContext = await buildVoiceCapsuleContext(voiceSession, core);
      } catch { /* proceed without context */ }

      const messages = [
        { role: 'system', content: voiceSession.buildInstructions(capsuleContext) },
        ...conversationMessages,
        { role: 'user', content: transcript },
      ];

      const toolLoopStartedAt = Date.now();
      const result = await runAzureVoiceToolLoop({
        config: voiceConfig,
        messages,
        tools: voiceChatToolDefinitions(),
        executeTool: (name, args) => voiceSession.executeTool(name, args),
        maxSteps: 8,
        maxTokens: 900,
        temperature: 0.2,
      });
      logVoicePerf('tool_loop', {
        elapsedMs: Date.now() - toolLoopStartedAt,
        finishReason: result.finishReason || '',
        messageCount: Array.isArray(result.messages) ? result.messages.length : 0,
      });

      conversationMessages = (Array.isArray(result.messages) ? result.messages : messages)
        .filter((entry) => String(entry?.role || '').toLowerCase() !== 'system')
        .slice(-24);

      const replyText = buildAssistantResponseText(result);
      await streamSpeechResponse(replyText);
    } catch (error) {
      const detail = String(error?.message || 'Voice processing failed');
      sendClientEvent({ type: 'error', error: { message: detail } });
    } finally {
      speechState.processing = false;
    }
  }

  function handleAudioAppend(base64) {
    if (speechState.processing) return;
    const pcmBuffer = decodeAudioChunk(base64);
    if (!pcmBuffer.length) return;

    const durationMs = chunkDurationMs(pcmBuffer);
    const rms = computeChunkRms(pcmBuffer);
    const isSpeech = rms >= SPEECH_RMS_THRESHOLD;

    if (!speechState.speechActive) {
      pushPreRollChunk(speechState, pcmBuffer);
      if (!isSpeech) return;

      speechState.speechActive = true;
      speechState.utteranceChunks = speechState.preRollChunks.map((entry) => entry.pcmBuffer);
      speechState.utteranceMs = speechState.preRollChunks.reduce((sum, entry) => sum + entry.durationMs, 0);
      speechState.preRollChunks = [];
      sendClientEvent({ type: 'input_audio_buffer.speech_started' });
    }

    speechState.utteranceChunks.push(pcmBuffer);
    speechState.utteranceMs += durationMs;
    if (isSpeech) {
      speechState.silenceMs = 0;
    } else {
      speechState.silenceMs += durationMs;
    }

    if (speechState.utteranceMs >= MAX_UTTERANCE_MS || speechState.silenceMs >= SPEECH_SILENCE_MS) {
      finalizeUtterance(speechState.utteranceMs >= MAX_UTTERANCE_MS ? 'max_duration' : 'silence')
        .catch((error) => {
          sendClientEvent({ type: 'error', error: { message: String(error?.message || 'Voice VAD failed') } });
        });
    }
  }

  async function forwardClientMessage(raw) {
    let parsed = null;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {}
    if (!parsed) return;

    if (parsed.type === 'mesh.voice.configure') {
      try {
        const handled = await voiceSession.handleClientMessage(parsed);
        if (handled?.handled && !sessionConfigured) {
          sessionConfigured = true;
          sendClientEvent({
            type: 'session.ready',
            protocol: 'azure-stt-text-tts',
            deployment: voiceConfig.textDeployment,
            profile: voiceConfig.label,
          });
        }
      } catch (error) {
        sendClientEvent({ type: 'error', error: { message: String(error?.message || 'Voice session update failed') } });
      }
      return;
    }

    try {
      const handled = await voiceSession.handleClientMessage(parsed);
      if (handled?.handled) return;
    } catch (error) {
      sendClientEvent({ type: 'error', error: { message: String(error?.message || 'Voice session update failed') } });
      return;
    }

    if (!sessionConfigured) return;

    if (parsed.type === 'input_audio_buffer.append') {
      handleAudioAppend(parsed.audio);
      return;
    }

    if (parsed.type === 'input_audio_buffer.commit') {
      await finalizeUtterance('commit');
      return;
    }

    if (parsed.type === 'input_audio_buffer.clear') {
      resetSpeechCapture(speechState);
      speechState.preRollChunks = [];
    }
  }

  clientWs.on('message', (raw) => {
    forwardClientMessage(raw).catch((error) => {
      sendClientEvent({ type: 'error', error: { message: String(error?.message || 'Voice relay error') } });
    });
  });
  clientWs.on('close', () => {
    clientClosed = true;
  });
  clientWs.on('error', () => {
    clientClosed = true;
  });

  sendClientEvent({
    type: 'voice.session.configured',
    voiceSessionId: voiceSession.state.voiceSessionId,
      selectedCodingModel: voiceSession.state.selectedCodingModel,
      autonomyMode: voiceSession.state.autonomyMode,
      workspaceFolderName: voiceSession.state.workspaceFolderName,
      workspaceId: voiceSession.state.workspaceId,
      sessionId: voiceSession.state.sessionId,
      activeFilePath: voiceSession.state.activeFilePath,
      selectedPaths: voiceSession.state.selectedPaths,
  });
}

module.exports = { setupRealtimeRelay, listVoiceContextPaths, buildVoiceCapsuleContext };
