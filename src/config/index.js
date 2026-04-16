'use strict';

/**
 * MESH — Centralized configuration module.
 *
 * Single source of truth for all environment variables. Validates on import.
 * In production, missing critical vars cause an immediate process exit.
 *
 * Usage: const config = require('./config');
 * Then:  config.ANTHROPIC_API_KEY instead of process.env.ANTHROPIC_API_KEY
 *
 * @module config
 */

const {
  parseBooleanFlag,
  parseIntegerInRange,
  clampBrotliQuality,
} = require('./env-utils');

/**
 * Validate a config source and return structured errors/warnings.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  if (!nodeEnv) {
    warnings.push('NODE_ENV is not set. Defaulting to development behaviour.');
  }

  const encryptionKey = String(env.MESH_DATA_ENCRYPTION_KEY || env.AUTH_SECRET || '').trim();
  if (isProduction && !encryptionKey) {
    errors.push('MESH_DATA_ENCRYPTION_KEY must be set in production. All encrypted user data depends on this value.');
  }

  const dynamoEnabled = parseBooleanFlag(env.MESH_DYNAMO_ENABLED, false);
  const dynamoTable = String(env.MESH_DYNAMO_USERS_TABLE || env.MESH_DYNAMO_TABLE_PREFIX || '').trim();
  if (isProduction && !dynamoEnabled && !dynamoTable) {
    errors.push('MESH_DYNAMO_ENABLED must be set to true in production. Auth and user storage require DynamoDB.');
  }

  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  const bedrockAccessKey = String(env.AWS_ACCESS_KEY_ID || '').trim();
  if (!anthropicKey && !bedrockAccessKey) {
    warnings.push('Neither ANTHROPIC_API_KEY nor AWS_ACCESS_KEY_ID is set. Chat and assistant features will be unavailable.');
  }

  const corsOrigins = env.CORS_ORIGINS
    ? env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
    : [];
  if (isProduction && corsOrigins.length === 0) {
    warnings.push('CORS_ORIGINS not set — CORS will reject all cross-origin requests in production');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Build the full config object from an env source.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {object}
 */
function buildConfig(env = process.env) {
  const NODE_ENV = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const IS_PRODUCTION = NODE_ENV === 'production';
  const PORT = Number(env.PORT || 8080);

  const RAW_INDEX_PARALLELISM = env.MESH_WORKSPACE_INDEX_PARALLELISM;
  const MESH_WORKSPACE_INDEX_PARALLELISM = parseIntegerInRange(env.MESH_WORKSPACE_INDEX_PARALLELISM, 8, 1, 24);

  return {
    NODE_ENV,
    IS_PRODUCTION,
    PORT,
    LOG_LEVEL: String(env.LOG_LEVEL || 'info').toLowerCase(),

    MESH_DATA_ENCRYPTION_KEY: String(env.MESH_DATA_ENCRYPTION_KEY || env.AUTH_SECRET || '').trim(),
    MESH_SECURE_DB_FILE: String(env.MESH_SECURE_DB_FILE || '').trim(),

    // DynamoDB (replaces Cosmos DB)
    MESH_DYNAMO_ENABLED: parseBooleanFlag(env.MESH_DYNAMO_ENABLED, false),
    MESH_DYNAMO_TABLE_PREFIX: String(env.MESH_DYNAMO_TABLE_PREFIX || 'mesh').trim(),
    MESH_DYNAMO_USERS_TABLE: String(env.MESH_DYNAMO_USERS_TABLE || '').trim(),
    MESH_DYNAMO_SESSIONS_TABLE: String(env.MESH_DYNAMO_SESSIONS_TABLE || '').trim(),
    MESH_DYNAMO_STORES_TABLE: String(env.MESH_DYNAMO_STORES_TABLE || '').trim(),

    ANTHROPIC_API_KEY: String(env.ANTHROPIC_API_KEY || '').trim(),
    OPENAI_API_KEY: String(env.OPENAI_API_KEY || '').trim(),
    GOOGLE_API_KEY: String(env.GOOGLE_API_KEY || '').trim(),
    AWS_BEARER_TOKEN_BEDROCK: String(env.AWS_BEARER_TOKEN_BEDROCK || '').trim(),
    BEDROCK_PROXY_URL: String(env.BEDROCK_PROXY_URL || '').trim().replace(/\/+$/, ''),
    AWS_ACCESS_KEY_ID: String(env.AWS_ACCESS_KEY_ID || '').trim(),
    AWS_SECRET_ACCESS_KEY: String(env.AWS_SECRET_ACCESS_KEY || '').trim(),
    AWS_REGION_BEDROCK: String(env.AWS_REGION_BEDROCK || 'us-east-1').trim(),
    MESH_DEFAULT_MODEL: String(env.MESH_DEFAULT_MODEL || 'claude-sonnet-4-6').trim(),

    // AWS Voice (Amazon Transcribe + Polly)
    MESH_VOICE_TRANSCRIBE_LANGUAGE: String(env.MESH_VOICE_TRANSCRIBE_LANGUAGE || env.MESH_VOICE_TRANSCRIBE_LANG || 'en-US').trim(),
    MESH_VOICE_POLLY_VOICE: String(env.MESH_VOICE_POLLY_VOICE || 'Joanna').trim(),
    MESH_VOICE_POLLY_ENGINE: String(env.MESH_VOICE_POLLY_ENGINE || 'neural').trim(),

    SPEECH_RMS_THRESHOLD: Number(env.MESH_VOICE_VAD_THRESHOLD || 0.012),
    SPEECH_PREFIX_MS: Number(env.MESH_VOICE_VAD_PREFIX_MS || 240),
    SPEECH_SILENCE_MS: Number(env.MESH_VOICE_VAD_SILENCE_MS || 720),
    MIN_UTTERANCE_MS: Number(env.MESH_VOICE_MIN_UTTERANCE_MS || 280),
    MAX_UTTERANCE_MS: Number(env.MESH_VOICE_MAX_UTTERANCE_MS || 14000),
    AUDIO_DELTA_BYTES: Number(env.MESH_VOICE_AUDIO_DELTA_BYTES || 4096),
    VOICE_HEARTBEAT_INTERVAL_MS: parseIntegerInRange(env.MESH_VOICE_HEARTBEAT_INTERVAL_MS, 30_000, 5_000, 120_000),
    VOICE_HEARTBEAT_TIMEOUT_MS: parseIntegerInRange(env.MESH_VOICE_HEARTBEAT_TIMEOUT_MS, 10_000, 3_000, 60_000),
    VOICE_SESSION_MAX_DURATION_MS: parseIntegerInRange(env.MESH_VOICE_SESSION_MAX_DURATION_MS, 30 * 60 * 1000, 60_000, 4 * 60 * 60 * 1000),
    VOICE_PROCESSING_TIMEOUT_MS: parseIntegerInRange(env.MESH_VOICE_PROCESSING_TIMEOUT_MS, 30_000, 5_000, 120_000),

    MESH_AUTH_SESSION_TOUCH_INTERVAL_MS: parseIntegerInRange(
      env.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS,
      2 * 60 * 1000,
      0,
      1000 * 60 * 60 * 24 * 14,
    ),
    CSRF_SECRET: String(env.MESH_CSRF_SECRET || env.MESH_DATA_ENCRYPTION_KEY || env.AUTH_SECRET || 'csrf-fallback-dev-only').trim(),

    AUTH_COOKIE_NAME: String(env.MESH_AUTH_COOKIE_NAME || 'mesh_auth').trim() || 'mesh_auth',
    AUTH_COOKIE_PATH: String(env.MESH_AUTH_COOKIE_PATH || '/').trim() || '/',
    AUTH_COOKIE_SAME_SITE: String(env.MESH_AUTH_COOKIE_SAMESITE || 'Strict').trim() || 'Strict',
    AUTH_COOKIE_SECURE: parseBooleanFlag(env.MESH_AUTH_COOKIE_SECURE, IS_PRODUCTION),

    DEMO_USER_ENABLED: parseBooleanFlag(env.MESH_DEMO_USER_ENABLED, !IS_PRODUCTION),
    DEMO_USER_EMAIL: String(env.MESH_DEMO_USER_EMAIL || 'edgar@test.com').trim().toLowerCase(),
    DEMO_USER_EMAIL_ALIASES: String(env.MESH_DEMO_USER_EMAIL_ALIASES || '')
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean),
    // No default — MESH_DEMO_USER_PASSWORD must be set explicitly.
    // An empty fallback disables demo login rather than using a guessable password.
    DEMO_USER_PASSWORD: String(env.MESH_DEMO_USER_PASSWORD || '').trim(),

    MESH_CORE_URL: String(env.MESH_CORE_URL || 'http://localhost:8080/mesh/tunnel').trim(),
    MESH_TERMINAL_UPLOAD_ROOT: String(env.MESH_TERMINAL_UPLOAD_ROOT || '').trim(),

    WORKSPACE_BROTLI_QUALITY: clampBrotliQuality(env.MESH_WORKSPACE_BROTLI_QUALITY, 5),
    WORKSPACE_INITIAL_BROTLI_QUALITY: clampBrotliQuality(env.MESH_WORKSPACE_INITIAL_BROTLI_QUALITY, 3),
    MESH_TUNNEL_BROTLI_QUALITY: clampBrotliQuality(env.MESH_TUNNEL_BROTLI_QUALITY, 4),

    MESH_WORKSPACE_INDEX_PARALLELISM,
    MESH_WORKSPACE_READ_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_READ_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? MESH_WORKSPACE_INDEX_PARALLELISM : 16,
      1,
      64,
    ),
    MESH_WORKSPACE_BUILD_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_BUILD_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? MESH_WORKSPACE_INDEX_PARALLELISM : 6,
      1,
      32,
    ),
    MESH_WORKSPACE_ENRICH_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_ENRICH_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? Math.min(MESH_WORKSPACE_INDEX_PARALLELISM, 16) : 4,
      1,
      24,
    ),
    MESH_WORKSPACE_PERF_LOG: parseBooleanFlag(env.MESH_WORKSPACE_PERF_LOG, false),

    WORKSPACE_SELECT_ASYNC_MODE: String(env.MESH_WORKSPACE_SELECT_ASYNC_MODE || 'off').trim().toLowerCase(),
    WORKSPACE_SELECT_ASYNC_ENABLED: (() => {
      const asyncMode = String(env.MESH_WORKSPACE_SELECT_ASYNC_MODE || 'off').trim().toLowerCase();
      return parseBooleanFlag(
        env.MESH_WORKSPACE_SELECT_ASYNC_ENABLED,
        ['queue', 'async', 'background', 'on', 'enabled', 'true', '1'].includes(asyncMode),
      );
    })(),
    WORKSPACE_SELECT_JOB_TTL_MS: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_JOB_TTL_MS, 20 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    WORKSPACE_SELECT_MAX_JOB_HISTORY: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_MAX_JOB_HISTORY, 500, 50, 5000),
    WORKSPACE_SELECT_MAX_PENDING: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_MAX_PENDING, 12, 1, 200),

    // S3 blob offload (replaces Azure Blob Storage)
    MESH_S3_OFFLOAD_ENABLED: parseBooleanFlag(env.MESH_S3_OFFLOAD_ENABLED, false),
    MESH_S3_BUCKET: String(env.MESH_S3_BUCKET || '').trim(),
    MESH_S3_PREFIX: String(env.MESH_S3_PREFIX || '').trim().replace(/\/+$/, ''),
    MESH_S3_OFFLOAD_MAX_CHUNK_FILES: parseIntegerInRange(env.MESH_S3_OFFLOAD_MAX_CHUNK_FILES, 900, 100, 5000),
    MESH_S3_OFFLOAD_MAX_CHUNK_BYTES: parseIntegerInRange(env.MESH_S3_OFFLOAD_MAX_CHUNK_BYTES, 60_000_000, 5_000_000, 250_000_000),
    MESH_S3_OFFLOAD_MAX_PARALLEL_READS: parseIntegerInRange(env.MESH_S3_OFFLOAD_MAX_PARALLEL_READS, 64, 8, 192),
    MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS: parseIntegerInRange(env.MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS, 4, 1, 12),

    RATE_LIMIT_API_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_API_MAX, 100, 10, 10000),
    RATE_LIMIT_API_WINDOW_MS: parseIntegerInRange(env.MESH_RATE_LIMIT_API_WINDOW_MS, 60_000, 1000, 600_000),
    RATE_LIMIT_UPLOAD_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_UPLOAD_MAX, 20, 5, 1000),

    CORS_ORIGINS: env.CORS_ORIGINS
      ? env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
      : (IS_PRODUCTION ? [] : ['http://localhost:3000', 'http://localhost:3001']),

    // LRU cache sizes
    RATE_LIMITER_MAX_ENTRIES: parseIntegerInRange(env.RATE_LIMITER_MAX_ENTRIES, 5000, 1000, 50000),
    WORKSPACE_FILE_CACHE_MAX: parseIntegerInRange(env.WORKSPACE_FILE_CACHE_MAX, 10000, 100, 100000),
    SESSION_CACHE_MAX: parseIntegerInRange(env.SESSION_CACHE_MAX, 1000, 100, 10000),
    CODEC_SESSION_CACHE_MAX: parseIntegerInRange(env.CODEC_SESSION_CACHE_MAX, 500, 100, 5000),
    ASSISTANT_RUNS_CACHE_MAX: parseIntegerInRange(env.ASSISTANT_RUNS_CACHE_MAX, 500, 50, 5000),
    INFER_FILES_CACHE_MAX: parseIntegerInRange(env.INFER_FILES_CACHE_MAX, 500, 50, 5000),
  };
}

const config = buildConfig();
const validation = validateConfig();

module.exports = config;
module.exports.validateConfig = validateConfig;
module.exports.buildConfig = buildConfig;
module.exports.validation = validation;
