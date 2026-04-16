'use strict';

/**
 * Voice service — coordinates voice chat session lifecycle.
 * Routes call this service rather than core directly.
 */

/**
 * @typedef {object} VoiceServiceDeps
 * @property {object} voiceAgent  Voice agent module (createVoiceAgentSession, etc.)
 * @property {object} voiceAudio  AWS voice audio module (buildAwsVoiceConfig, etc.)
 * @property {object} config  Application config
 * @property {object} logger  Logger instance
 */

/**
 * @typedef {object} VoiceService
 * @property {Function} buildConfig
 * @property {Function} ensureConfig
 * @property {Function} createSession
 * @property {Function} getToolDefinitions
 * @property {Function} transcribe
 * @property {Function} synthesize
 * @property {Function} runToolLoop
 */

/**
 * Creates a voice service instance with injected dependencies.
 *
 * @param {VoiceServiceDeps} deps
 * @returns {VoiceService}
 */
function createVoiceService({ voiceAgent, voiceAudio, config, logger }) {
  /**
   * Builds the AWS voice config from environment.
   *
   * @returns {object}
   */
  function buildConfig() {
    return voiceAudio.buildAwsVoiceConfig();
  }

  /**
   * Validates that the AWS voice config has required fields.
   * Throws if misconfigured.
   *
   * @returns {object}
   */
  function ensureConfig() {
    return voiceAudio.ensureAwsVoiceConfig();
  }

  /**
   * Creates a new voice agent session for the given workspace context.
   *
   * @param {object} options
   * @returns {object}  Voice agent session handle
   */
  function createSession(options) {
    return voiceAgent.createVoiceAgentSession(options);
  }

  /**
   * Returns the tool definitions available to the voice agent.
   *
   * @returns {object[]}
   */
  function getToolDefinitions() {
    return voiceAgent.voiceChatToolDefinitions;
  }

  /**
   * Transcribes a PCM-16 audio buffer to text.
   *
   * @param {Buffer} pcmBuffer
   * @param {object} voiceConfig
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async function transcribe(pcmBuffer, voiceConfig, signal) {
    return voiceAudio.transcribePcm16Buffer(pcmBuffer, voiceConfig, signal);
  }

  /**
   * Synthesizes text to speech audio.
   *
   * @param {string} text
   * @param {object} voiceConfig
   * @returns {Promise<Buffer>}
   */
  async function synthesize(text, voiceConfig) {
    return voiceAudio.synthesizeSpeech(text, voiceConfig);
  }

  /**
   * Runs the AWS voice tool execution loop.
   *
   * @param {object} params
   * @returns {Promise<object>}
   */
  async function runToolLoop(params) {
    return voiceAudio.runAwsVoiceToolLoop(params);
  }

  return {
    buildConfig,
    ensureConfig,
    createSession,
    getToolDefinitions,
    transcribe,
    synthesize,
    runToolLoop,
  };
}

module.exports = { createVoiceService };
