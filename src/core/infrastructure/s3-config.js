'use strict';

/**
 * S3 SDK lazy loading, client singleton, and workspace offload configuration.
 * workspaceOffloadConfig is created at module load time from env/config values.
 */

const config = require('../../config');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } =
    require('@aws-sdk/client-s3'));
} catch {
  S3Client = null;
}

let _s3Client = null;

/** @returns {import('@aws-sdk/client-s3').S3Client} */
function getS3Client() {
  if (_s3Client) return _s3Client;
  if (!S3Client) throw new Error('AWS S3 SDK not available. Run: npm install @aws-sdk/client-s3');
  const opts = { region: config.AWS_REGION_BEDROCK || process.env.AWS_REGION || 'us-east-1' };
  if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
    opts.credentials = {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    };
  }
  _s3Client = new S3Client(opts);
  return _s3Client;
}

/** @returns {object} */
function createWorkspaceOffloadConfig() {
  const requested = config.MESH_S3_OFFLOAD_ENABLED;
  const bucket = config.MESH_S3_BUCKET;
  const prefix = config.MESH_S3_PREFIX || '';
  const maxChunkFiles = config.MESH_S3_OFFLOAD_MAX_CHUNK_FILES;
  const maxChunkBytes = config.MESH_S3_OFFLOAD_MAX_CHUNK_BYTES;
  const maxParallelReads = config.MESH_S3_OFFLOAD_MAX_PARALLEL_READS;
  const maxInflightChunks = config.MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS;

  let enabled = false;
  let reason = 'disabled-by-env';
  if (requested && !bucket) reason = 'missing-bucket';
  else if (requested && !S3Client) reason = 'sdk-not-installed';
  else if (requested) {
    enabled = true;
    reason = 'ready';
  }

  return {
    mode: enabled ? 's3' : 'direct',
    s3: { enabled, reason, bucket, prefix, maxChunkFiles, maxChunkBytes, maxParallelReads, maxInflightChunks },
    // Legacy alias so callers that read workspaceOffloadConfig.azureBlob still get a safe object
    azureBlob: { enabled: false, reason: 'migrated-to-s3' },
  };
}

const workspaceOffloadConfig = createWorkspaceOffloadConfig();

/** @returns {object} */
function workspaceOffloadClientConfig() {
  const s3 = workspaceOffloadConfig.s3 || {};
  return {
    ok: true,
    mode: s3.enabled ? 's3' : 'direct',
    s3: {
      enabled: Boolean(s3.enabled),
      reason: String(s3.reason || 'disabled-by-env'),
      bucket: s3.enabled ? String(s3.bucket || '') : '',
      prefix: String(s3.prefix || ''),
      maxChunkFiles: Number(s3.maxChunkFiles || 0),
      maxChunkBytes: Number(s3.maxChunkBytes || 0),
      maxParallelReads: Number(s3.maxParallelReads || 0),
      maxInflightChunks: Number(s3.maxInflightChunks || 0),
    },
    // Legacy field — kept so frontend code that reads .azureBlob doesn't crash
    azureBlob: { enabled: false, reason: 'migrated-to-s3' },
  };
}

module.exports = {
  getS3Client,
  createWorkspaceOffloadConfig,
  workspaceOffloadConfig,
  workspaceOffloadClientConfig,
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
};
