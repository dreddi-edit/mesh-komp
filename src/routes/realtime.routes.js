const WebSocket = require('ws');
const { createVoiceAgentSession, voiceChatToolDefinitions } = require('../core/voice-agent');
const {
  buildAwsVoiceConfig,
  ensureAwsVoiceConfig,
  transcribePcm16Buffer,
  synthesizeSpeech,
  runAwsVoiceToolLoop,
} = require('../core/voice-aws-audio');
const config = require('../config');
const logger = require('../logger');

const SAMPLE_RATE = 24000;
const SPEECH_RMS_THRESHOLD = config.SPEECH_RMS_THRESHOLD;
const SPEECH_PREFIX_MS = config.SPEECH_PREFIX_MS;
const SPEECH_SILENCE_MS = config.SPEECH_SILENCE_MS;
const MIN_UTTERANCE_MS = config.MIN_UTTERANCE_MS;
const MAX_UTTERANCE_MS = config.MAX_UTTERANCE_MS;
const AUDIO_DELTA_BYTES = config.AUDIO_DELTA_BYTES;
const PERF_LOG = config.MESH_WORKSPACE_PERF_LOG;
const HEARTBEAT_INTERVAL_MS = config.VOICE_HEARTBEAT_INTERVAL_MS;
const HEARTBEAT_TIMEOUT_MS = config.VOICE_HEARTBEAT_TIMEOUT_MS;
const SESSION_MAX_DURATION_MS = config.VOICE_SESSION_MAX_DURATION_MS;
const PROCESSING_TIMEOUT_MS = config.VOICE_PROCESSING_TIMEOUT_MS;

/**
 * @param {import('http').Server} server
 * @param {object} core  All exports from src/core/index.js
 */
// Maximum concurrent voice WebSocket sessions per user.
// Prevents runaway Transcribe/Polly cost from browser-reload loops.
const MAX_VOICE_SESSIONS_PER_USER = 2;

function setupRealtimeRelay(server, core) {
  const { readAuthTokenFromRequest, resolveAuthUserFromRequest } = core;
  const wss = new WebSocket.Server({ noServer: true });
  /** @type {Map<string, Set<import('ws')>>} */
  const activeSessions = new Map();

  function registerSession(userId, ws) {
    if (!activeSessions.has(userId)) activeSessions.set(userId, new Set());
    activeSessions.get(userId).add(ws);
    ws.once('close', () => {
      const set = activeSessions.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) activeSessions.delete(userId);
      }
    });
  }

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
      const userId = String(resolved.user.id);
      const existing = activeSessions.get(userId);
      if (existing && existing.size >= MAX_VOICE_SESSIONS_PER_USER) {
        logger.warn('Voice session limit reached', { scope: 'realtime-routes', userId, active: existing.size });
        socket.write('HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        registerSession(userId, clientWs);
        handleSession(clientWs, { authUserId: userId, core });
      });
    } catch (upgradeErr) {
      logger.error('Voice WS upgrade failed', { scope: 'realtime-routes', error: String(upgradeErr?.message || upgradeErr || 'unknown') });
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
    logger.info(label, { scope: 'voice-perf', ...meta });
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
  const voiceConfig = buildAwsVoiceConfig(process.env);
  try {
    ensureAwsVoiceConfig(voiceConfig);
  } catch (error) {
    clientWs.send(JSON.stringify({ type: 'error', error: { message: String(error?.message || 'Voice service not configured') } }));
    clientWs.close();
    return;
  }

  let sessionConfigured = false;
  let clientClosed = false;
  let conversationMessages = [];
  const speechState = createSpeechState();
  const sessionStartedAt = Date.now();
  const sessionAbort = new AbortController();
  let heartbeatInterval = null;
  let heartbeatTimeout = null;
  let sessionMaxTimer = null;
  let pongReceived = true;

  const voiceSession = createVoiceAgentSession({
    authUserId: String(options?.authUserId || ''),
    deps: buildVoiceDeps(core),
    sendClientEvent,
    sendAzureEvent: () => {}, // legacy no-op — voice-agent.js calls this for Azure Realtime events, AWS path ignores them
  });

  function sendClientEvent(payload) {
    if (clientClosed || clientWs.readyState !== WebSocket.OPEN) return;
    try {
      clientWs.send(JSON.stringify(payload));
    } catch {}
  }

  function teardown(reason) {
    if (clientClosed) return;
    clientClosed = true;
    sessionAbort.abort();
    if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    if (heartbeatTimeout) { clearTimeout(heartbeatTimeout); heartbeatTimeout = null; }
    if (sessionMaxTimer) { clearTimeout(sessionMaxTimer); sessionMaxTimer = null; }
    resetSpeechCapture(speechState);
    speechState.preRollChunks = [];
    logVoicePerf('session_end', {
      reason,
      durationMs: Date.now() - sessionStartedAt,
      turns: conversationMessages.filter((m) => m.role === 'user').length,
    });
    if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
      try { clientWs.close(1000, reason); } catch {}
    }
  }

  heartbeatInterval = setInterval(() => {
    if (clientClosed) return;
    if (!pongReceived) {
      teardown('heartbeat_timeout');
      return;
    }
    pongReceived = false;
    try { clientWs.ping(); } catch { teardown('ping_failed'); }
  }, HEARTBEAT_INTERVAL_MS);

  clientWs.on('pong', () => { pongReceived = true; });

  sessionMaxTimer = setTimeout(() => {
    sendClientEvent({ type: 'error', error: { message: 'Voice session reached maximum duration.' } });
    teardown('session_max_duration');
  }, SESSION_MAX_DURATION_MS);

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

    if (sessionAbort.signal.aborted) return;

    const spoken = await synthesizeSpeech(replyText, voiceConfig, {
      voice: voiceConfig.voice,
      responseFormat: 'pcm',
    });

    if (sessionAbort.signal.aborted) return;

    const audio = Buffer.isBuffer(spoken.audio) ? spoken.audio : Buffer.alloc(0);
    for (let offset = 0; offset < audio.length; offset += AUDIO_DELTA_BYTES) {
      if (sessionAbort.signal.aborted) return;
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

    const turnTimeout = setTimeout(() => {
      if (speechState.processing) {
        sendClientEvent({ type: 'error', error: { message: 'Voice turn processing timed out.' } });
        speechState.processing = false;
      }
    }, PROCESSING_TIMEOUT_MS * 3);

    try {
      if (sessionAbort.signal.aborted) return;

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

      if (sessionAbort.signal.aborted) return;

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

      if (sessionAbort.signal.aborted) return;

      const messages = [
        { role: 'system', content: voiceSession.buildInstructions(capsuleContext) },
        ...conversationMessages,
        { role: 'user', content: transcript },
      ];

      const toolLoopStartedAt = Date.now();
      const result = await runAwsVoiceToolLoop({
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

      if (sessionAbort.signal.aborted) return;

      conversationMessages = (Array.isArray(result.messages) ? result.messages : messages)
        .filter((entry) => String(entry?.role || '').toLowerCase() !== 'system')
        .slice(-24);

      const replyText = buildAssistantResponseText(result);
      await streamSpeechResponse(replyText);
    } catch (error) {
      if (sessionAbort.signal.aborted) return;
      const detail = String(error?.message || 'Voice processing failed');
      sendClientEvent({ type: 'error', error: { message: detail } });
    } finally {
      clearTimeout(turnTimeout);
      speechState.processing = false;
    }
  }

  function handleAudioAppend(base64) {
    if (speechState.processing || sessionAbort.signal.aborted) return;
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
    if (sessionAbort.signal.aborted) return;

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
            protocol: 'aws-transcribe-bedrock-polly',
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
  clientWs.on('close', () => { teardown('client_close'); });
  clientWs.on('error', () => { teardown('client_error'); });

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
