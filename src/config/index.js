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
  trimTrailingSlashes,
  normalizeSasToken,
  sanitizeBlobContainerName,
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

  const cosmosEndpoint = String(env.MESH_COSMOS_ENDPOINT || '').trim();
  const cosmosKey = String(env.MESH_COSMOS_KEY || '').trim();
  if (isProduction && (!cosmosEndpoint || !cosmosKey)) {
    errors.push('MESH_COSMOS_ENDPOINT and MESH_COSMOS_KEY must both be set in production. Auth and user storage require Cosmos DB.');
  }

  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    warnings.push('ANTHROPIC_API_KEY is not set. Chat and assistant features will be unavailable.');
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
    MESH_COSMOS_ENDPOINT: String(env.MESH_COSMOS_ENDPOINT || '').trim(),
    MESH_COSMOS_KEY: String(env.MESH_COSMOS_KEY || '').trim(),
    MESH_COSMOS_DATABASE: String(env.MESH_COSMOS_DATABASE || 'mesh-db').trim(),

    ANTHROPIC_API_KEY: String(env.ANTHROPIC_API_KEY || '').trim(),
    OPENAI_API_KEY: String(env.OPENAI_API_KEY || '').trim(),
    GOOGLE_API_KEY: String(env.GOOGLE_API_KEY || '').trim(),
    AWS_BEARER_TOKEN_BEDROCK: String(env.AWS_BEARER_TOKEN_BEDROCK || '').trim(),
    AZURE_OPENAI_ENDPOINT: String(env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/+$/, ''),
    AZURE_OPENAI_KEY: String(env.AZURE_OPENAI_KEY || '').trim(),
    MESH_DEFAULT_MODEL: String(env.MESH_DEFAULT_MODEL || 'gpt-5.4-mini').trim(),

    AZURE_OPENAI_VOICE_ENDPOINT: String(env.AZURE_OPENAI_VOICE_ENDPOINT || '').trim(),
    AZURE_OPENAI_VOICE_KEY: String(env.AZURE_OPENAI_VOICE_KEY || '').trim(),
    SPEECH_RMS_THRESHOLD: Number(env.MESH_VOICE_VAD_THRESHOLD || 0.012),
    SPEECH_PREFIX_MS: Number(env.MESH_VOICE_VAD_PREFIX_MS || 240),
    SPEECH_SILENCE_MS: Number(env.MESH_VOICE_VAD_SILENCE_MS || 720),
    MIN_UTTERANCE_MS: Number(env.MESH_VOICE_MIN_UTTERANCE_MS || 280),
    MAX_UTTERANCE_MS: Number(env.MESH_VOICE_MAX_UTTERANCE_MS || 14000),
    AUDIO_DELTA_BYTES: Number(env.MESH_VOICE_AUDIO_DELTA_BYTES || 4096),

    MESH_AUTH_SESSION_TOUCH_INTERVAL_MS: parseIntegerInRange(
      env.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS,
      2 * 60 * 1000,
      0,
      1000 * 60 * 60 * 24 * 14,
    ),
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
    DEMO_USER_PASSWORD: String(env.MESH_DEMO_USER_PASSWORD || '12345').trim(),

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

    MESH_AZURE_OFFLOAD_ENABLED: parseBooleanFlag(env.MESH_AZURE_OFFLOAD_ENABLED, false),
    MESH_AZURE_BLOB_BASE_URL: trimTrailingSlashes(env.MESH_AZURE_BLOB_BASE_URL || ''),
    MESH_AZURE_BLOB_CONTAINER: sanitizeBlobContainerName(env.MESH_AZURE_BLOB_CONTAINER || ''),
    MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN: normalizeSasToken(env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || env.MESH_AZURE_BLOB_SAS_TOKEN || ''),
    MESH_AZURE_BLOB_INGEST_SAS_TOKEN: normalizeSasToken(
      env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN || env.MESH_AZURE_BLOB_SAS_TOKEN || env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || '',
    ),
    MESH_AZURE_BLOB_READ_SAS_TOKEN: normalizeSasToken(
      env.MESH_AZURE_BLOB_READ_SAS_TOKEN || env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN
      || env.MESH_AZURE_BLOB_SAS_TOKEN || env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || '',
    ),
    MESH_AZURE_BLOB_DELETE_SAS_TOKEN: normalizeSasToken(env.MESH_AZURE_BLOB_DELETE_SAS_TOKEN || ''),
    MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES, 900, 100, 5000),
    MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES, 60_000_000, 5_000_000, 250_000_000),
    MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS, 64, 8, 192),
    MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS, 4, 1, 12),

    RATE_LIMIT_API_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_API_MAX, 100, 10, 10000),
    RATE_LIMIT_API_WINDOW_MS: parseIntegerInRange(env.MESH_RATE_LIMIT_API_WINDOW_MS, 60_000, 1000, 600_000),
    RATE_LIMIT_UPLOAD_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_UPLOAD_MAX, 20, 5, 1000),
  };
}

const config = buildConfig();
const validation = validateConfig();

module.exports = config;
module.exports.validateConfig = validateConfig;
module.exports.buildConfig = buildConfig;
module.exports.validation = validation;
