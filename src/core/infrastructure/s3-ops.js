'use strict';

/**
 * S3 blob read/write/copy/delete operations and workspace storage normalization.
 */

const zlib = require('zlib');
const { promisify } = require('util');

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const {
  getS3Client,
  workspaceOffloadConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} = require('./s3-config');
const { toSafePath } = require('./path-utils');

/**
 * @param {object|null} storage
 * @param {string} [filePath]
 * @returns {{ provider: string, blobPath: string }|null}
 */
function normalizeWorkspaceBlobStorage(storage, filePath = '') {
  if (!storage || typeof storage !== 'object') return null;
  if (!storage.provider && !storage.blobPath && !storage.s3Key) return null;
  const provider = String(storage.provider || '').trim().toLowerCase();
  if (provider && provider !== 's3') return null;
  const blobPath = toSafePath(storage.blobPath || storage.s3Key || filePath);
  if (!blobPath) return null;
  return { provider: 's3', blobPath };
}

/**
 * @param {string} rawText
 * @returns {Promise<{ compressedBase64: string, originalSize: number, compressedSize: number }>}
 */
async function compressLocalWorkspaceText(rawText) {
  const normalized = typeof rawText === 'string' ? rawText : String(rawText || '');
  const buffer = await brotliCompress(Buffer.from(normalized, 'utf8'), {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: WORKSPACE_BROTLI_QUALITY,
    },
  });
  return {
    compressedBase64: buffer.toString('base64'),
    originalSize: Buffer.byteLength(normalized, 'utf8'),
    compressedSize: buffer.length,
  };
}

/**
 * @param {string} base64Buffer
 * @returns {Promise<string>}
 */
async function decompressLocalWorkspaceText(base64Buffer) {
  const unpacked = await brotliDecompress(Buffer.from(base64Buffer, 'base64'));
  return unpacked.toString('utf8');
}

/**
 * @param {object} candidate
 * @param {string} filePath
 * @returns {object|null}
 */
function normalizeIncomingWorkspacePreindexedFile(candidate, filePath) {
  if (!candidate || typeof candidate !== 'object') return null;
  const normalized = { ...candidate, path: filePath };

  if (!normalized.transportEnvelope && normalized.envelopeVersion && Array.isArray(normalized.chunks)) {
    normalized.transportEnvelope = {
      envelopeVersion: normalized.envelopeVersion,
      contentEncoding: normalized.contentEncoding,
      rawBytes: normalized.rawBytes,
      compressedBytes: normalized.compressedBytes,
      chunkSize: normalized.chunkSize,
      chunkCount: normalized.chunkCount,
      spanCount: normalized.spanCount,
      digest: normalized.digest,
      chunkIndex: Array.isArray(normalized.chunkIndex) ? normalized.chunkIndex : [],
      spanIndex: normalized.spanIndex && typeof normalized.spanIndex === 'object' ? normalized.spanIndex : {},
      chunks: normalized.chunks,
      manifestText: typeof normalized.manifestText === 'string' ? normalized.manifestText : '',
    };
  }

  const storage = normalizeWorkspaceBlobStorage(candidate?.storage, filePath);
  if (storage) normalized.storage = storage;

  return normalized;
}

/**
 * @param {object} storage
 * @param {number} [sizeBytes]
 * @returns {Promise<{ content: string, byteLength: number }>}
 */
async function readWorkspaceBlobText(storage = {}, sizeBytes = 0) {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error('S3 storage reference missing.');

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  const response = await getS3Client().send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
  if (!response.Body) throw new Error('S3 download returned empty body.');

  const decoder = new TextDecoder('utf-8', { fatal: false });
  const sizeLimit = 25_000_000;
  let totalBytes = 0;
  let textLength = 0;
  let truncated = false;
  let binary = false;
  let content = '';

  for await (const chunk of response.Body) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += value.length;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === 0) { binary = true; break; }
    }
    if (binary) break;
    if (textLength >= sizeLimit) { truncated = true; continue; }
    const decoded = decoder.decode(value, { stream: true });
    const remaining = sizeLimit - textLength;
    if (decoded.length <= remaining) {
      content += decoded;
      textLength += decoded.length;
    } else {
      content += decoded.slice(0, remaining);
      textLength += remaining;
      truncated = true;
    }
  }

  if (binary) {
    return { content: '[binary or unreadable]', byteLength: totalBytes || Number(sizeBytes || 0) };
  }

  const tail = decoder.decode();
  if (tail && textLength < sizeLimit) {
    const remaining = sizeLimit - textLength;
    content += tail.length <= remaining ? tail : tail.slice(0, remaining);
    textLength += Math.min(tail.length, remaining);
    if (tail.length > remaining) truncated = true;
  }

  if (truncated) {
    content += `\n\n[mesh note] File truncated during indexing because it exceeded ${sizeLimit.toLocaleString()} characters.`;
  }

  return { content, byteLength: totalBytes || Number(sizeBytes || 0) };
}

/**
 * @param {object} storage
 * @param {string} [content]
 * @returns {Promise<{ provider: string, blobPath: string }>}
 */
async function writeWorkspaceBlobText(storage = {}, content = '') {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error('S3 storage reference missing.');

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  await getS3Client().send(new PutObjectCommand({
    Bucket: s3.bucket,
    Key: key,
    Body: String(content || ''),
    ContentType: 'text/plain; charset=utf-8',
  }));
  return normalized;
}

/**
 * @param {object} sourceStorage
 * @param {object} targetStorage
 * @returns {Promise<{ provider: string, blobPath: string }>}
 */
async function copyWorkspaceBlob(sourceStorage = {}, targetStorage = {}) {
  const normalizedSource = normalizeWorkspaceBlobStorage(sourceStorage);
  const normalizedTarget = normalizeWorkspaceBlobStorage(targetStorage);
  if (!normalizedSource || !normalizedTarget) throw new Error('S3 copy references are invalid.');

  const s3 = workspaceOffloadConfig.s3;
  const sourceKey = s3.prefix ? `${s3.prefix}/${normalizedSource.blobPath}` : normalizedSource.blobPath;
  const targetKey = s3.prefix ? `${s3.prefix}/${normalizedTarget.blobPath}` : normalizedTarget.blobPath;

  await getS3Client().send(new CopyObjectCommand({
    Bucket: s3.bucket,
    CopySource: `${s3.bucket}/${sourceKey}`,
    Key: targetKey,
  }));
  return normalizedTarget;
}

/**
 * @param {object} storage
 * @returns {Promise<void>}
 */
async function deleteWorkspaceBlob(storage = {}) {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error('S3 storage reference missing.');

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  } catch (error) {
    if (error?.name !== 'NoSuchKey') throw error;
  }
}

module.exports = {
  normalizeWorkspaceBlobStorage,
  compressLocalWorkspaceText,
  decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile,
  readWorkspaceBlobText,
  writeWorkspaceBlobText,
  copyWorkspaceBlob,
  deleteWorkspaceBlob,
};
