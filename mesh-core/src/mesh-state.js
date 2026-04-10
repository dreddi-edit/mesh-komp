/**
 * MESH Worker — Shared workspace state, constants, and init-time utilities.
 * Single source of truth for mutable in-memory state during worker operation.
 * Imported by workspace-helpers.js, workspace-operations.js, and server.js.
 * Node ESM module instances are cached, so all importers share the same objects.
 */

import zlib from 'zlib';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const _require = createRequire(import.meta.url);
const { createWorkspaceMetadataStore } = _require('../../workspace-metadata-store.cjs');

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Init-time utilities — needed to compute constants at module load
// ---------------------------------------------------------------------------

function clampBrotliQuality(rawValue, fallback) {
    const numeric = Number(rawValue);
    const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
    return Math.min(11, Math.max(0, selected));
}

function parseIntegerInRange(rawValue, fallback, min, max) {
    const numeric = Number(rawValue);
    const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
    return Math.min(max, Math.max(min, selected));
}

function trimTrailingSlashes(value) {
    return String(value || '').trim().replace(/\/+$/g, '');
}

function normalizeSasToken(rawToken) {
    return String(rawToken || '').trim().replace(/^\?+/, '');
}

function sanitizeBlobContainerName(rawValue) {
    return String(rawValue || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '');
}

function toSafePath(rawPath) {
    const input = String(rawPath || '').replace(/\\/g, '/').trim();
    if (!input) return '';
    const normalized = path.posix.normalize(`/${input}`).replace(/^\/+/, '');
    return normalized === '.' ? '' : normalized;
}

function buildAzureBlobAbsoluteUrl(baseUrl, container, blobPath, sasToken = '') {
    const normalizedBase      = trimTrailingSlashes(baseUrl);
    const normalizedContainer = sanitizeBlobContainerName(container);
    const normalizedBlobPath  = toSafePath(blobPath)
        .split('/').filter(Boolean).map((s) => encodeURIComponent(s)).join('/');
    const normalizedToken = normalizeSasToken(sasToken);
    if (!normalizedBase || !normalizedContainer || !normalizedBlobPath) {
        throw new Error('Azure blob URL cannot be built from current worker settings.');
    }
    return normalizedToken
        ? `${normalizedBase}/${encodeURIComponent(normalizedContainer)}/${normalizedBlobPath}?${normalizedToken}`
        : `${normalizedBase}/${encodeURIComponent(normalizedContainer)}/${normalizedBlobPath}`;
}

function canonicalAzureBlobUrl(baseUrl, container, blobPath) {
    return buildAzureBlobAbsoluteUrl(baseUrl, container, blobPath, '');
}

function createWorkspaceBlobConfig() {
    const baseUrl        = trimTrailingSlashes(process.env.MESH_AZURE_BLOB_BASE_URL || '');
    const container      = sanitizeBlobContainerName(process.env.MESH_AZURE_BLOB_CONTAINER || '');
    const uploadSasToken = normalizeSasToken(process.env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || process.env.MESH_AZURE_BLOB_SAS_TOKEN || '');
    const readSasToken   = normalizeSasToken(process.env.MESH_AZURE_BLOB_READ_SAS_TOKEN || process.env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN || process.env.MESH_AZURE_BLOB_SAS_TOKEN || uploadSasToken);
    const deleteSasToken = normalizeSasToken(process.env.MESH_AZURE_BLOB_DELETE_SAS_TOKEN || process.env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || process.env.MESH_AZURE_BLOB_SAS_TOKEN || '');
    return {
        enabled: Boolean(baseUrl && container && (uploadSasToken || readSasToken)),
        baseUrl,
        container,
        uploadSasToken,
        readSasToken,
        deleteSasToken,
    };
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const WORKSPACE_CACHE_FILE               = path.join(__dirname, '..', '.mesh-worker-workspace-cache.json');
export const WORKSPACE_BROTLI_QUALITY           = clampBrotliQuality(process.env.MESH_WORKSPACE_BROTLI_QUALITY, 5);
export const WORKSPACE_INITIAL_BROTLI_QUALITY   = clampBrotliQuality(process.env.MESH_WORKSPACE_INITIAL_BROTLI_QUALITY, 3);
const RAW_WORKSPACE_INDEX_PARALLELISM           = process.env.MESH_WORKSPACE_INDEX_PARALLELISM;
export const WORKSPACE_INDEX_PARALLELISM        = parseIntegerInRange(process.env.MESH_WORKSPACE_INDEX_PARALLELISM, 8, 1, 24);
export const WORKSPACE_READ_CONCURRENCY         = parseIntegerInRange(process.env.MESH_WORKSPACE_READ_CONCURRENCY, RAW_WORKSPACE_INDEX_PARALLELISM !== undefined ? WORKSPACE_INDEX_PARALLELISM : 16, 1, 64);
export const WORKSPACE_BUILD_CONCURRENCY        = parseIntegerInRange(process.env.MESH_WORKSPACE_BUILD_CONCURRENCY, RAW_WORKSPACE_INDEX_PARALLELISM !== undefined ? WORKSPACE_INDEX_PARALLELISM : 6, 1, 32);
export const WORKSPACE_ENRICH_CONCURRENCY       = parseIntegerInRange(process.env.MESH_WORKSPACE_ENRICH_CONCURRENCY, RAW_WORKSPACE_INDEX_PARALLELISM !== undefined ? Math.min(WORKSPACE_INDEX_PARALLELISM, 16) : 4, 1, 24);
export const WORKSPACE_PERF_LOG_ENABLED         = ['1', 'true', 'yes', 'on', 'enabled'].includes(String(process.env.MESH_WORKSPACE_PERF_LOG || '').trim().toLowerCase());
export const WORKSPACE_SOURCE_UPLOAD            = 'upload';
export const WORKSPACE_SOURCE_LOCAL_PATH        = 'local-path';
export const LOCAL_WORKSPACE_SKIP_EXTENSIONS    = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|gz|tar|lock)$/i;
export const LOCAL_WORKSPACE_SKIP_DIRS          = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__)(\/|$)/;
export const LOCAL_WORKSPACE_MAX_FILE_CHARS     = 1_000_000;
export const WORKSPACE_BLOB_INLINE_BUFFER_BYTES = parseIntegerInRange(process.env.MESH_WORKSPACE_BLOB_INLINE_BUFFER_BYTES,     8 * 1024 * 1024, 256 * 1024,  64 * 1024 * 1024);
export const WORKSPACE_BLOB_DOWNLOAD_CHUNK_BYTES= parseIntegerInRange(process.env.MESH_WORKSPACE_BLOB_DOWNLOAD_CHUNK_BYTES,         1024 * 1024,  64 * 1024,   8 * 1024 * 1024);
export const WORKSPACE_BLOB_UPLOAD_BUFFER_BYTES = parseIntegerInRange(process.env.MESH_WORKSPACE_BLOB_UPLOAD_BUFFER_BYTES,     4 * 1024 * 1024, 256 * 1024,  16 * 1024 * 1024);
export const WORKSPACE_BLOB_UPLOAD_MAX_CONCURRENCY = parseIntegerInRange(process.env.MESH_WORKSPACE_BLOB_UPLOAD_MAX_CONCURRENCY, 5, 1, 16);
export const BLOB_WORKSPACE_SOURCE_NOTE = `[mesh note] File truncated during indexing because it exceeded ${LOCAL_WORKSPACE_MAX_FILE_CHARS.toLocaleString()} characters.`;

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

export const workspaceState = {
    folderName:         null,
    rootPath:           null,
    workspaceId:        null,
    sessionId:          null,
    sourceKind:         WORKSPACE_SOURCE_UPLOAD,
    files:              new Map(),
    fileCountTotal:     0,
    fileCountCompleted: 0,
    fileCountFailed:    0,
    fileCountPending:   0,
    status:             '',
    indexedAt:          null,
};

export const workspaceMetadataStore = createWorkspaceMetadataStore();
export const workspaceBlobConfig    = createWorkspaceBlobConfig();
export const brotliCompress         = promisify(zlib.brotliCompress);
export const brotliDecompress       = promisify(zlib.brotliDecompress);
export const execFileAsync          = promisify(execFile);

// Also export utilities so workspace-helpers.js can re-use them without duplication
export {
    clampBrotliQuality,
    parseIntegerInRange,
    trimTrailingSlashes,
    normalizeSasToken,
    sanitizeBlobContainerName,
    toSafePath,
    buildAzureBlobAbsoluteUrl,
    canonicalAzureBlobUrl,
    createWorkspaceBlobConfig,
};
