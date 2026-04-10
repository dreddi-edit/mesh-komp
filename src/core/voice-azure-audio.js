'use strict';

function trimText(value) {
  return String(value || '').trim();
}

function trimTrailingSlash(value) {
  return trimText(value).replace(/\/+$/, '');
}

function readBlobTextContent(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((entry) => readBlobTextContent(entry))
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') return value.text;
    if (typeof value.value === 'string') return value.value;
    if (typeof value.output_text === 'string') return value.output_text;
    if (Array.isArray(value.content)) return readBlobTextContent(value.content);
  }
  return '';
}

async function readJsonResponse(response) {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { error: raw.slice(0, 600) };
  }
}

function parseProviderError(payload, fallbackMessage) {
  if (!payload) return fallbackMessage;
  if (typeof payload.error === 'string') return payload.error;
  if (payload.error && typeof payload.error.message === 'string') return payload.error.message;
  if (typeof payload.message === 'string') return payload.message;
  return fallbackMessage;
}

function providerWantsMaxCompletionTokens(errorMessage) {
  const msg = String(errorMessage || '').toLowerCase();
  return (
    msg.includes('max_tokens') &&
    msg.includes('max_completion_tokens') &&
    (msg.includes('not supported') || msg.includes('unsupported parameter') || msg.includes('use'))
  );
}

function extractAssistantMessage(chatPayload = {}) {
  const message = chatPayload?.choices?.[0]?.message || {};
  const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const content = readBlobTextContent(message.content);
  return {
    role: 'assistant',
    content: String(content || '').trim(),
    toolCalls: toolCalls.map((entry) => ({
      id: String(entry?.id || ''),
      type: String(entry?.type || 'function'),
      function: {
        name: String(entry?.function?.name || ''),
        arguments: String(entry?.function?.arguments || '{}'),
      },
    })),
    finishReason: String(chatPayload?.choices?.[0]?.finish_reason || '').trim(),
    usage: chatPayload?.usage || {},
  };
}

function buildAzureVoiceConfig(env = process.env) {
  const rootEndpoint = trimTrailingSlash(
    env.AZURE_OPENAI_VOICE_ENDPOINT ||
    env.AZURE_OPENAI_ENDPOINT ||
    'https://edgar-mnpv2n5b-eastus2.openai.azure.com/'
  );

  return {
    rootEndpoint,
    apiKey: trimText(env.AZURE_OPENAI_VOICE_KEY || env.AZURE_OPENAI_KEY || ''),
    audioApiVersion: trimText(env.AZURE_OPENAI_VOICE_AUDIO_API_VERSION || '2025-04-01-preview'),
    chatApiVersion: trimText(env.AZURE_OPENAI_VOICE_CHAT_API_VERSION || '2025-04-01-preview'),
    transcribeDeployment: trimText(env.AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT || 'gpt-4o-mini-transcribe'),
    textDeployment: trimText(env.AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT || 'gpt-5.4-nano'),
    ttsDeployment: trimText(env.AZURE_OPENAI_VOICE_TTS_DEPLOYMENT || 'gpt-4o-mini-tts'),
    voice: trimText(env.AZURE_OPENAI_VOICE_TTS_VOICE || env.AZURE_OPENAI_REALTIME_VOICE || 'alloy'),
    transcriptionLanguage: trimText(env.AZURE_OPENAI_VOICE_TRANSCRIBE_LANGUAGE || ''),
    label: 'azure-stt-text-tts',
  };
}

function ensureAzureVoiceConfig(config = {}) {
  if (!trimText(config.rootEndpoint)) throw new Error('AZURE_OPENAI_VOICE_ENDPOINT or AZURE_OPENAI_ENDPOINT not configured.');
  if (!trimText(config.apiKey)) throw new Error('AZURE_OPENAI_VOICE_KEY or AZURE_OPENAI_KEY not configured.');
  if (!trimText(config.transcribeDeployment)) throw new Error('AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT not configured.');
  if (!trimText(config.textDeployment)) throw new Error('AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT not configured.');
  if (!trimText(config.ttsDeployment)) throw new Error('AZURE_OPENAI_VOICE_TTS_DEPLOYMENT not configured.');
}

function joinAzurePath(rootEndpoint, tailPath) {
  return `${trimTrailingSlash(rootEndpoint)}/${String(tailPath || '').replace(/^\/+/, '')}`;
}

function buildChatUrl(config) {
  return joinAzurePath(
    config.rootEndpoint,
    `openai/deployments/${encodeURIComponent(config.textDeployment)}/chat/completions?api-version=${encodeURIComponent(config.chatApiVersion)}`
  );
}

function buildTranscribeUrl(config) {
  return joinAzurePath(
    config.rootEndpoint,
    `openai/deployments/${encodeURIComponent(config.transcribeDeployment)}/audio/transcriptions?api-version=${encodeURIComponent(config.audioApiVersion)}`
  );
}

function buildSpeechUrl(config) {
  return joinAzurePath(
    config.rootEndpoint,
    `openai/deployments/${encodeURIComponent(config.ttsDeployment)}/audio/speech?api-version=${encodeURIComponent(config.audioApiVersion)}`
  );
}

function pcm16ToWav(pcmBuffer, sampleRate = 24000, channels = 1) {
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

async function transcribePcm16Buffer(pcmBuffer, config, options = {}) {
  ensureAzureVoiceConfig(config);
  const wavBuffer = pcm16ToWav(pcmBuffer, Number(options.sampleRate || 24000), 1);
  const form = new FormData();
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), options.filename || 'voice-input.wav');
  form.append('response_format', 'json');
  if (trimText(config.transcriptionLanguage)) {
    form.append('language', trimText(config.transcriptionLanguage));
  }

  const response = await fetch(buildTranscribeUrl(config), {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
    },
    body: form,
  });

  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(parseProviderError(payload, `Azure transcription failed (${response.status})`));
  }

  return {
    ok: true,
    text: trimText(payload?.text || payload?.transcript || ''),
    raw: payload,
  };
}

async function synthesizeSpeech(text, config, options = {}) {
  ensureAzureVoiceConfig(config);
  const input = trimText(text);
  if (!input) return { ok: true, audio: Buffer.alloc(0), transcript: '' };

  const response = await fetch(buildSpeechUrl(config), {
    method: 'POST',
    headers: {
      'api-key': config.apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      input,
      voice: trimText(options.voice || config.voice || 'alloy'),
      response_format: trimText(options.responseFormat || 'pcm'),
      speed: Number(options.speed || 1),
    }),
  });

  if (!response.ok) {
    const payload = await readJsonResponse(response);
    throw new Error(parseProviderError(payload, `Azure speech synthesis failed (${response.status})`));
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return {
    ok: true,
    audio,
    transcript: input,
  };
}

async function callAzureVoiceChat(messages, config, options = {}) {
  ensureAzureVoiceConfig(config);
  const baseBody = {
    model: trimText(config.textDeployment),
    messages,
    tools: Array.isArray(options.tools) ? options.tools : [],
    tool_choice: options.toolChoice || 'auto',
    temperature: Number.isFinite(options.temperature) ? options.temperature : 0.2,
  };

  const headers = {
    'api-key': config.apiKey,
    'Content-Type': 'application/json',
  };

  const firstResponse = await fetch(buildChatUrl(config), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...baseBody,
      max_tokens: Math.max(256, Number(options.maxTokens || 900)),
    }),
  });

  const firstPayload = await readJsonResponse(firstResponse);
  if (firstResponse.ok) {
    return extractAssistantMessage(firstPayload);
  }

  const firstError = parseProviderError(firstPayload, `Azure voice text request failed (${firstResponse.status})`);
  if (/missing required parameter:\s*'model'/i.test(firstError)) {
    const retryResponse = await fetch(buildChatUrl(config), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...baseBody,
        model: trimText(config.textDeployment),
        max_completion_tokens: Math.max(256, Number(options.maxTokens || 900)),
      }),
    });

    const retryPayload = await readJsonResponse(retryResponse);
    if (!retryResponse.ok) {
      throw new Error(parseProviderError(retryPayload, `Azure voice text request failed (${retryResponse.status})`));
    }

    return extractAssistantMessage(retryPayload);
  }

  if (!providerWantsMaxCompletionTokens(firstError) && !/unknown parameter:\s*'model'/i.test(firstError)) {
    throw new Error(firstError);
  }

  const fallbackBody = {
    messages,
    tools: Array.isArray(options.tools) ? options.tools : [],
    tool_choice: options.toolChoice || 'auto',
    temperature: Number.isFinite(options.temperature) ? options.temperature : 0.2,
  };

  const retryResponse = await fetch(buildChatUrl(config), {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...fallbackBody,
      max_completion_tokens: Math.max(256, Number(options.maxTokens || 900)),
    }),
  });

  const retryPayload = await readJsonResponse(retryResponse);
  if (!retryResponse.ok) {
    throw new Error(parseProviderError(retryPayload, `Azure voice text request failed (${retryResponse.status})`));
  }

  return extractAssistantMessage(retryPayload);
}

async function runAzureVoiceToolLoop(options = {}) {
  const executeTool = typeof options.executeTool === 'function' ? options.executeTool : null;
  if (!executeTool) throw new Error('Voice tool executor not provided.');

  const messages = Array.isArray(options.messages) ? options.messages.slice() : [];
  const tools = Array.isArray(options.tools) ? options.tools : [];
  const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || 8), 12));

  for (let step = 0; step < maxSteps; step += 1) {
    const assistantMessage = await callAzureVoiceChat(messages, options.config || {}, {
      tools,
      toolChoice: options.toolChoice || 'auto',
      maxTokens: options.maxTokens || 900,
      temperature: options.temperature,
    });

    const assistantRecord = {
      role: 'assistant',
      content: assistantMessage.content || '',
    };

    if (assistantMessage.toolCalls.length) {
      assistantRecord.tool_calls = assistantMessage.toolCalls.map((entry) => ({
        id: entry.id,
        type: entry.type,
        function: {
          name: entry.function.name,
          arguments: entry.function.arguments,
        },
      }));
    }
    messages.push(assistantRecord);

    if (!assistantMessage.toolCalls.length) {
      return {
        ok: true,
        text: trimText(assistantMessage.content || ''),
        messages,
        usage: assistantMessage.usage,
        finishReason: assistantMessage.finishReason,
      };
    }

    for (const toolCall of assistantMessage.toolCalls) {
      let args = {};
      try {
        args = JSON.parse(toolCall.function.arguments || '{}');
      } catch {
        args = {};
      }

      let result;
      try {
        result = await executeTool(toolCall.function.name, args);
      } catch (error) {
        result = { ok: false, error: String(error?.message || 'Voice tool failed') };
      }

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify(result),
      });
    }
  }

  return {
    ok: false,
    text: 'I hit the maximum number of voice tool steps before finishing.',
    messages,
    finishReason: 'max_steps',
  };
}

module.exports = {
  buildAzureVoiceConfig,
  ensureAzureVoiceConfig,
  transcribePcm16Buffer,
  synthesizeSpeech,
  runAzureVoiceToolLoop,
  pcm16ToWav,
};
