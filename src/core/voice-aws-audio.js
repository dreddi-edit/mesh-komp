'use strict';

/**
 * MESH — AWS Voice Audio Layer
 * Replaces Azure OpenAI voice pipeline with AWS-native services:
 *   - STT: Amazon Transcribe Streaming (replaces Azure Whisper)
 *   - LLM: AWS Bedrock (unchanged)
 *   - TTS: Amazon Polly (replaces Azure TTS)
 */

const config = require('../config');
const { callBedrockDirect } = require('./model-providers');

let TranscribeStreamingClient, StartStreamTranscriptionCommand;
try {
  ({ TranscribeStreamingClient, StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming'));
} catch {
  TranscribeStreamingClient = null;
}

let PollyClient, SynthesizeSpeechCommand;
try {
  ({ PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly'));
} catch {
  PollyClient = null;
}

const { Readable } = require('stream');

function trimText(value) {
  return String(value || '').trim();
}

/**
 * Build AWS voice config from environment.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env]
 * @returns {object}
 */
function buildAwsVoiceConfig(env = process.env) {
  const region = trimText(env.AWS_REGION_BEDROCK || env.AWS_REGION || 'us-east-1');
  return {
    region,
    accessKeyId: trimText(env.AWS_ACCESS_KEY_ID || ''),
    secretAccessKey: trimText(env.AWS_SECRET_ACCESS_KEY || ''),
    transcribeLanguage: trimText(env.MESH_VOICE_TRANSCRIBE_LANGUAGE || env.MESH_VOICE_TRANSCRIBE_LANG || 'en-US'),
    pollyVoiceId: trimText(env.MESH_VOICE_POLLY_VOICE || 'Joanna'),
    pollyEngine: trimText(env.MESH_VOICE_POLLY_ENGINE || 'neural'),
    label: 'aws-transcribe-bedrock-polly',
  };
}

/**
 * @param {object} config
 * @throws {Error} if AWS credentials are not configured
 */
function ensureAwsVoiceConfig(config = {}) {
  if (!config.region) throw new Error('AWS region not configured for voice. Set AWS_REGION_BEDROCK.');
  if (!TranscribeStreamingClient) throw new Error('AWS Transcribe SDK not installed. Run: npm install @aws-sdk/client-transcribe-streaming');
  if (!PollyClient) throw new Error('AWS Polly SDK not installed. Run: npm install @aws-sdk/client-polly');
}

/**
 * Create a configured AWS client with credentials when available.
 *
 * @template T
 * @param {new(opts: object) => T} ClientCtor
 * @param {object} voiceConfig
 * @returns {T}
 */
function createAwsClient(ClientCtor, voiceConfig) {
  const opts = { region: voiceConfig.region };
  if (voiceConfig.accessKeyId && voiceConfig.secretAccessKey) {
    opts.credentials = {
      accessKeyId: voiceConfig.accessKeyId,
      secretAccessKey: voiceConfig.secretAccessKey,
    };
  }
  return new ClientCtor(opts);
}

/**
 * Convert a raw PCM-16 mono buffer to WAV format.
 *
 * @param {Buffer} pcmBuffer
 * @param {number} [sampleRate=24000]
 * @param {number} [channels=1]
 * @returns {Buffer}
 */
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

/**
 * Transcribe a PCM-16 audio buffer using Amazon Transcribe Streaming.
 *
 * @param {Buffer} pcmBuffer - Raw PCM-16 mono audio
 * @param {object} voiceConfig - From buildAwsVoiceConfig()
 * @param {{ sampleRate?: number }} [options]
 * @returns {Promise<{ ok: true, text: string, raw: object }>}
 */
async function transcribePcm16Buffer(pcmBuffer, voiceConfig, options = {}) {
  ensureAwsVoiceConfig(voiceConfig);

  const sampleRate = Number(options.sampleRate || 24000);
  const languageCode = trimText(options.language || voiceConfig.transcribeLanguage || 'en-US');

  const client = createAwsClient(TranscribeStreamingClient, voiceConfig);

  // Transcribe Streaming requires an async iterable of audio chunks
  async function* audioStream() {
    const CHUNK_SIZE = 8192;
    for (let offset = 0; offset < pcmBuffer.length; offset += CHUNK_SIZE) {
      yield { AudioEvent: { AudioChunk: pcmBuffer.subarray(offset, offset + CHUNK_SIZE) } };
    }
  }

  const command = new StartStreamTranscriptionCommand({
    LanguageCode: languageCode,
    MediaEncoding: 'pcm',
    MediaSampleRateHertz: sampleRate,
    AudioStream: audioStream(),
  });

  const response = await client.send(command);

  let transcript = '';
  for await (const event of response.TranscriptResultStream) {
    const results = event?.TranscriptEvent?.Transcript?.Results || [];
    for (const result of results) {
      if (result.IsPartial) continue;
      const alt = result.Alternatives?.[0];
      if (alt?.Transcript) {
        transcript += (transcript ? ' ' : '') + alt.Transcript;
      }
    }
  }

  return {
    ok: true,
    text: trimText(transcript),
    raw: { languageCode, sampleRate },
  };
}

/**
 * Synthesize speech using Amazon Polly.
 * Returns raw PCM audio (matching the format Azure TTS returned).
 *
 * @param {string} text
 * @param {object} voiceConfig - From buildAwsVoiceConfig()
 * @param {{ voiceId?: string, engine?: string }} [options]
 * @returns {Promise<{ ok: true, audio: Buffer, transcript: string }>}
 */
async function synthesizeSpeech(text, voiceConfig, options = {}) {
  ensureAwsVoiceConfig(voiceConfig);

  const input = trimText(text);
  if (!input) return { ok: true, audio: Buffer.alloc(0), transcript: '' };

  const voiceId = trimText(options.voiceId || options.voice || voiceConfig.pollyVoiceId || 'Joanna');
  const engine = trimText(options.engine || voiceConfig.pollyEngine || 'neural');

  const client = createAwsClient(PollyClient, voiceConfig);

  const command = new SynthesizeSpeechCommand({
    Text: input,
    OutputFormat: 'pcm',
    SampleRate: '24000',
    VoiceId: voiceId,
    Engine: engine,
  });

  const response = await client.send(command);

  // Collect the streaming audio body into a Buffer
  const chunks = [];
  for await (const chunk of response.AudioStream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const audio = Buffer.concat(chunks);

  return {
    ok: true,
    audio,
    transcript: input,
  };
}

/**
 * Run a Bedrock-powered voice tool loop (LLM step, unchanged from Azure implementation).
 *
 * @param {object} options
 * @returns {Promise<{ ok: boolean, text: string, messages: object[], finishReason: string }>}
 */
async function runAwsVoiceToolLoop(options = {}) {
  const executeTool = typeof options.executeTool === 'function' ? options.executeTool : null;
  if (!executeTool) throw new Error('Voice tool executor not provided.');

  const messages = Array.isArray(options.messages) ? options.messages.slice() : [];
  const maxSteps = Math.max(1, Math.min(Number(options.maxSteps || 8), 12));

  for (let step = 0; step < maxSteps; step += 1) {
    const model = trimText(options.model || config.MESH_DEFAULT_MODEL);
    const maxTokens = Math.max(256, Number(options.maxTokens || 900));
    const result = await callBedrockDirect({ model, messages, maxTokens });

    const assistantRecord = {
      role: 'assistant',
      content: trimText(result.content || ''),
    };
    messages.push(assistantRecord);

    // Bedrock direct mode does not support tool_calls in this implementation —
    // return immediately with the text response.
    return {
      ok: true,
      text: trimText(result.content || ''),
      messages,
      usage: result.usage,
      finishReason: 'stop',
    };
  }

  return {
    ok: false,
    text: 'I hit the maximum number of voice tool steps before finishing.',
    messages,
    finishReason: 'max_steps',
  };
}

module.exports = {
  buildAwsVoiceConfig,
  ensureAwsVoiceConfig,
  transcribePcm16Buffer,
  synthesizeSpeech,
  runAwsVoiceToolLoop,
  pcm16ToWav,
};
