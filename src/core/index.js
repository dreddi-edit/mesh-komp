'use strict';

/**
 * MESH Core — wiring hub.
 * Imports all domain sub-modules, initialises shared mutable state (globals),
 * and re-exports everything so routes can require a single entry point.
 *
 * Global state (localAssistantWorkspace, assistantRuns, etc.) lives here and
 * is injected into the global namespace via Object.assign(global, module.exports)
 * so extracted sub-modules can access it without circular imports.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { LRUCache } = require('lru-cache');

const config   = require('../config');
const secureDb = require('../../secure-db');
const {
  buildStructuralEditFallback,
  classifyTerminalCommandGuard,
  extractFirstJsonObject,
  normalizeAssistantEditPrefs,
  normalizeAutonomyMode,
  normalizeRunMode,
  pathHasExtensionHint: sharedPathHasExtensionHint,
  rankWorkspacePathsForQuery: sharedRankWorkspacePathsForQuery,
  sanitizeAssistantRunPlan,
  scorePathForQuery: sharedScorePathForQuery,
  selectReferenceMatchLimit: sharedSelectReferenceMatchLimit,
  shouldAutoApplyAction,
  toSafePath: sharedSafePath,
} = require('../../assistant-core');
const {
  LEGACY_WORKSPACE_ENCODING,
  TRANSPORT_CONTENT_ENCODING,
  TRANSPORT_ENVELOPE_VERSION,
  WORKSPACE_RECORD_VERSION,
  buildWorkspaceFileRecord,
  buildWorkspaceFileView,
  decodeRawStorage,
  ensureWorkspaceFileRecord,
  recoverWorkspaceFileRecord,
  serializeWorkspaceFileRecord,
  suggestRecoverySpanIds,
} = require('../../mesh-core/src/compression-core.cjs');
const { createWorkspaceMetadataStore } = require('../../workspace-metadata-store.cjs');
const { clampBrotliQuality, parseBooleanFlag, parseIntegerInRange, trimTrailingSlashes, normalizeSasToken } = require('../config/env-utils');

// ── Domain modules ──────────────────────────────────────────────────────────
const auth = require('./auth');
const mp   = require('./model-providers');
const ar   = require('./assistant-runs');
const wi   = require('./workspace-infrastructure');
const wc   = require('./workspace-context');
const wo   = require('./workspace-ops');
const dep  = require('./deployments');

let pty;
try { pty = require('node-pty'); } catch { pty = null; }

// ── Node util shortcuts ──────────────────────────────────────────────────────
const brotliCompress   = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);
const execFileAsync    = promisify(execFile);

// ── Config constants ─────────────────────────────────────────────────────────
const MESH_CORE_URL                    = config.MESH_CORE_URL;
const LOCAL_WORKSPACE_CACHE_FILE       = path.join(__dirname, '.mesh-workspace-cache.json');
const OPERATIONS_STORE_FILE            = path.join(__dirname, '.mesh-operations-store.json');
const WORKSPACE_BROTLI_QUALITY         = config.WORKSPACE_BROTLI_QUALITY;
const WORKSPACE_INITIAL_BROTLI_QUALITY = config.WORKSPACE_INITIAL_BROTLI_QUALITY;
const MESH_TUNNEL_BROTLI_QUALITY       = config.MESH_TUNNEL_BROTLI_QUALITY;
const MESH_WORKSPACE_INDEX_PARALLELISM = config.MESH_WORKSPACE_INDEX_PARALLELISM;
const MESH_WORKSPACE_READ_CONCURRENCY  = config.MESH_WORKSPACE_READ_CONCURRENCY;
const MESH_WORKSPACE_BUILD_CONCURRENCY = config.MESH_WORKSPACE_BUILD_CONCURRENCY;
const MESH_WORKSPACE_ENRICH_CONCURRENCY = config.MESH_WORKSPACE_ENRICH_CONCURRENCY;
const MESH_WORKSPACE_PERF_LOG          = config.MESH_WORKSPACE_PERF_LOG;
const WORKSPACE_SELECT_ASYNC_MODE      = config.WORKSPACE_SELECT_ASYNC_MODE;
const WORKSPACE_SELECT_ASYNC_ENABLED   = config.WORKSPACE_SELECT_ASYNC_ENABLED;
const WORKSPACE_SELECT_JOB_TTL_MS      = config.WORKSPACE_SELECT_JOB_TTL_MS;
const WORKSPACE_SELECT_MAX_JOB_HISTORY = config.WORKSPACE_SELECT_MAX_JOB_HISTORY;
const WORKSPACE_SELECT_MAX_PENDING     = config.WORKSPACE_SELECT_MAX_PENDING;
const WORKSPACE_SOURCE_UPLOAD          = 'upload';
const WORKSPACE_SOURCE_LOCAL_PATH      = 'local-path';
const LOCAL_WORKSPACE_SKIP_EXTENSIONS  = /(\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|wav|ogg|zip|gz|tar|wasm|map)|\.min\.(js|css))$/i;
const LOCAL_WORKSPACE_SKIP_DIRS        = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__)(\/|$)/;
const LOCAL_WORKSPACE_MAX_FILE_CHARS   = 1_000_000;
const MAX_OPERATION_LOGS               = 600;

// ── Shared mutable state ─────────────────────────────────────────────────────
const localAssistantWorkspace = {
  folderName: null,
  rootPath: null,
  workspaceId: null,
  sessionId: null,
  sourceKind: WORKSPACE_SOURCE_UPLOAD,
  files: new LRUCache({ max: config.WORKSPACE_FILE_CACHE_MAX }),
  fileCountTotal: 0,
  fileCountCompleted: 0,
  fileCountFailed: 0,
  fileCountPending: 0,
  status: '',
  indexedAt: null,
};
const workspaceMetadataStore    = createWorkspaceMetadataStore();
const operationsStore           = { deployments: { pending: [], history: [] }, policies: [], logs: [], updatedAt: null };
const assistantRuns             = new LRUCache({ max: config.ASSISTANT_RUNS_CACHE_MAX });
const assistantTerminalSessions = new LRUCache({ max: config.ASSISTANT_RUNS_CACHE_MAX });
const workspaceSelectJobs       = new LRUCache({ max: config.ASSISTANT_RUNS_CACHE_MAX });
const workspaceSelectJobOrder   = [];
const workspaceSelectChains     = new LRUCache({ max: config.ASSISTANT_RUNS_CACHE_MAX });
let   lastAuthStoreErrorLogAt   = 0;

// ── Utility functions ────────────────────────────────────────────────────────
const { toSafePath, mapWithConcurrency } = wi;
const { isWorkspaceIndexablePath, normalizeWorkspaceBlobStorage, createWorkspacePerfTracker, readWorkspaceBlobText } = wi;
const { parsePolicyScopeFromPayload, stringifyPolicyScope, normalizePolicyMode, normalizePolicyStatus } = dep;

/** @returns {string} */
function toIsoNow() { return new Date().toISOString(); }

/** @param {string} value @param {string} [fallback] @returns {string} */
function toSafeSlug(value, fallback = 'item') {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

/** @param {string} rawValue @returns {string} */
function normalizeWorkspaceSourceKind(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === WORKSPACE_SOURCE_LOCAL_PATH
    ? WORKSPACE_SOURCE_LOCAL_PATH
    : WORKSPACE_SOURCE_UPLOAD;
}

/** @param {string} rawValue @returns {string} */
function sanitizeBlobContainerName(rawValue) {
  return String(rawValue || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * @param {string} filePath
 * @param {*} fallbackValue
 * @returns {*}
 */
function safeReadJsonFile(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return fallbackValue;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return fallbackValue;
    return parsed;
  } catch {
    return fallbackValue;
  }
}

/**
 * @param {string} filePath
 * @param {*} value
 */
function safeWriteJsonFile(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), 'utf8');
  } catch {
    // Ignore persistence write failures in demo mode.
  }
}

/** @param {string} level @returns {string} */
function normalizeOperationLevel(level) {
  const normalized = String(level || 'info').trim().toLowerCase();
  return ['err', 'warn', 'info', 'ok'].includes(normalized) ? normalized : 'info';
}

/** @param {string} region @returns {string} */
function normalizeOperationRegion(region) {
  const normalized = String(region || 'eu').trim().toLowerCase();
  return ['eu', 'us', 'ap'].includes(normalized) ? normalized : 'eu';
}

/** @returns {object[]} */
function defaultOperationPolicies() { return []; }

/** @returns {object} */
function defaultOperationsStore() {
  return { deployments: { pending: [], history: [] }, policies: [], logs: [], updatedAt: toIsoNow() };
}

/** @param {object[]} list @returns {object[]} */
function sanitizeDeploymentList(list) {
  const input = Array.isArray(list) ? list : [];
  return input.map((entry) => {
    const id = toSafeSlug(entry?.id, 'deploy');
    const title = String(entry?.title || 'Untitled deployment').trim();
    if (!id || !title) return null;
    return {
      id,
      route: String(entry?.route || 'workspace').trim() || 'workspace',
      region: String(entry?.region || 'EU Central').trim() || 'EU Central',
      title,
      risk: String(entry?.risk || 'low').trim().toLowerCase() || 'low',
      description: String(entry?.description || '').trim(),
      targetWindow: String(entry?.targetWindow || 'Immediate').trim() || 'Immediate',
      rollback: String(entry?.rollback || 'Manual rollback').trim() || 'Manual rollback',
      diff: String(entry?.diff || '').trim(),
      requestedBy: String(entry?.requestedBy || 'operator').trim() || 'operator',
      requestedAt: String(entry?.requestedAt || toIsoNow()),
      resolvedBy: String(entry?.resolvedBy || '').trim(),
      resolvedAt: String(entry?.resolvedAt || '').trim(),
      outcome: String(entry?.outcome || '').trim().toLowerCase(),
    };
  }).filter(Boolean);
}

/** @param {object[]} list @returns {object[]} */
function sanitizePolicyList(list) {
  const input = Array.isArray(list) ? list : [];
  return input.map((entry) => {
    const id = toSafeSlug(entry?.id, 'policy');
    if (!id) return null;
    const scope = parsePolicyScopeFromPayload(entry, { route: 'workspace', region: 'global' });
    return {
      id,
      type: String(entry?.type || 'Custom').trim() || 'Custom',
      mode: normalizePolicyMode(entry?.mode),
      route: scope.route,
      region: scope.region,
      applied: String(entry?.applied || stringifyPolicyScope(scope.route, scope.region)).trim() || stringifyPolicyScope(scope.route, scope.region),
      status: normalizePolicyStatus(entry?.status),
      description: String(entry?.description || '').trim(),
      modifiedAt: String(entry?.modifiedAt || entry?.updatedAt || toIsoNow()),
    };
  }).filter(Boolean);
}

/** @param {object[]} logs @returns {object[]} */
function sanitizeOperationLogs(logs) {
  const input = Array.isArray(logs) ? logs : [];
  return input.map((entry) => {
    const message = String(entry?.message || '').trim();
    if (!message) return null;
    return {
      id: String(entry?.id || crypto.randomUUID()),
      level: normalizeOperationLevel(entry?.level),
      region: normalizeOperationRegion(entry?.region),
      message,
      source: String(entry?.source || 'system').trim() || 'system',
      createdAt: String(entry?.createdAt || toIsoNow()),
    };
  }).filter(Boolean).slice(-MAX_OPERATION_LOGS);
}

/** @returns {void} */
function persistOperationsStore() {
  operationsStore.updatedAt = toIsoNow();
  safeWriteJsonFile(OPERATIONS_STORE_FILE, operationsStore);
}

/** @returns {void} */
function loadOperationsStore() {
  const defaults = defaultOperationsStore();
  const persisted = safeReadJsonFile(OPERATIONS_STORE_FILE, null);
  const source = persisted && typeof persisted === 'object' ? persisted : defaults;
  operationsStore.deployments.pending = sanitizeDeploymentList(source?.deployments?.pending);
  operationsStore.deployments.history = sanitizeDeploymentList(source?.deployments?.history);
  operationsStore.policies = sanitizePolicyList(source?.policies);
  operationsStore.logs = sanitizeOperationLogs(source?.logs);
  operationsStore.updatedAt = String(source?.updatedAt || toIsoNow());
  if (!operationsStore.policies.length) operationsStore.policies = defaultOperationPolicies();
  if (!operationsStore.logs.length) {
    operationsStore.logs = [{ id: crypto.randomUUID(), level: 'info', region: 'eu', message: 'Operational data store initialized.', source: 'server', createdAt: toIsoNow() }];
  }
  persistOperationsStore();
}

/**
 * @param {string} level
 * @param {string} message
 * @param {object} [options]
 */
function appendOperationLog(level, message, options = {}) {
  const payload = {
    id: crypto.randomUUID(),
    level: normalizeOperationLevel(level),
    region: normalizeOperationRegion(options.region),
    message: String(message || '').trim(),
    source: String(options.source || 'system').trim() || 'system',
    createdAt: toIsoNow(),
  };
  if (!payload.message) return;
  operationsStore.logs.push(payload);
  if (operationsStore.logs.length > MAX_OPERATION_LOGS) {
    operationsStore.logs = operationsStore.logs.slice(-MAX_OPERATION_LOGS);
  }
  persistOperationsStore();
}

/** @param {string} name @returns {string} */
function inferRegionFromRouteName(name) {
  const normalized = String(name || '').toLowerCase();
  if (normalized.includes('ap')) return 'ap';
  if (normalized.includes('us')) return 'us';
  return 'eu';
}

/** @returns {object} */
function snapshotOperationsPayload() {
  return {
    ok: true,
    deployments: operationsStore.deployments,
    pending: operationsStore.deployments.pending,
    history: operationsStore.deployments.history,
    policies: operationsStore.policies,
    logs: operationsStore.logs.slice(-300),
    updatedAt: operationsStore.updatedAt,
  };
}

/** @returns {object} */
function serializeLocalWorkspaceState() {
  return {
    folderName: localAssistantWorkspace.folderName,
    rootPath: localAssistantWorkspace.rootPath,
    workspaceId: localAssistantWorkspace.workspaceId,
    sessionId: localAssistantWorkspace.sessionId,
    sourceKind: normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind),
    fileCountTotal: localAssistantWorkspace.fileCountTotal,
    fileCountCompleted: localAssistantWorkspace.fileCountCompleted,
    fileCountFailed: localAssistantWorkspace.fileCountFailed,
    fileCountPending: localAssistantWorkspace.fileCountPending,
    status: localAssistantWorkspace.status,
    indexedAt: localAssistantWorkspace.indexedAt,
    files: [...localAssistantWorkspace.files.values()].map((meta) => serializeWorkspaceFileRecord(meta)),
  };
}

/** @returns {void} */
function persistLocalWorkspaceState() {
  safeWriteJsonFile(LOCAL_WORKSPACE_CACHE_FILE, serializeLocalWorkspaceState());
}

let _persistDebounceTimer = null;
function debouncedPersistLocalWorkspaceState() {
  if (_persistDebounceTimer) clearTimeout(_persistDebounceTimer);
  _persistDebounceTimer = setTimeout(() => {
    _persistDebounceTimer = null;
    persistLocalWorkspaceState();
  }, 200);
}

/** @returns {void} */
function restoreLocalWorkspaceState() {
  const persisted = safeReadJsonFile(LOCAL_WORKSPACE_CACHE_FILE, null);
  if (!persisted || typeof persisted !== 'object') return;
  const restoredFiles = new Map();
  const files = Array.isArray(persisted.files) ? persisted.files : [];
  for (const file of files) {
    const pathValue = toSafePath(file?.path);
    if (!pathValue) continue;
    restoredFiles.set(pathValue, { ...file, path: pathValue });
  }
  localAssistantWorkspace.folderName         = String(persisted.folderName || '') || null;
  localAssistantWorkspace.rootPath           = String(persisted.rootPath || '') || null;
  localAssistantWorkspace.workspaceId        = String(persisted.workspaceId || '') || null;
  localAssistantWorkspace.sessionId          = String(persisted.sessionId || '') || null;
  localAssistantWorkspace.sourceKind         = normalizeWorkspaceSourceKind(persisted.sourceKind);
  localAssistantWorkspace.fileCountTotal     = Number(persisted.fileCountTotal || restoredFiles.size || 0);
  localAssistantWorkspace.fileCountCompleted = Number(persisted.fileCountCompleted || restoredFiles.size || 0);
  localAssistantWorkspace.fileCountFailed    = Number(persisted.fileCountFailed || 0);
  localAssistantWorkspace.fileCountPending   = Number(persisted.fileCountPending || 0);
  localAssistantWorkspace.status             = String(persisted.status || '') || '';
  localAssistantWorkspace.indexedAt          = String(persisted.indexedAt || '') || null;
  localAssistantWorkspace.files              = restoredFiles;
}

/** @param {object} meta @returns {boolean} */
function workspaceRecordIndexed(meta) {
  return Boolean(meta?.capsuleCache && meta?.transportEnvelope && (meta?.rawStorage || meta?.compressedBase64));
}

/**
 * @param {object} meta
 * @param {string} [pathHint]
 * @returns {Promise<object>}
 */
async function ensureLocalWorkspaceMeta(meta, pathHint = '') {
  return ensureWorkspaceFileRecord(meta, {
    path: pathHint || meta?.path || '',
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
  });
}

/**
 * @param {object} meta
 * @param {string} [requestedPath]
 * @returns {Promise<string>}
 */
async function loadLocalWorkspaceRecordText(meta, requestedPath = '') {
  const record = await ensureLocalWorkspaceMeta(meta, requestedPath || meta?.path || '');
  if (record?.storage?.provider === 's3') {
    const blobText = await readWorkspaceBlobText(record.storage, record.originalSize);
    return blobText.content;
  }
  return decodeRawStorage(record.rawStorage);
}

/** @param {object} meta @returns {object} */
function buildWorkspaceFileListingEntry(meta) {
  const rawBytes = Number(meta?.rawStorage?.rawBytes || meta?.originalSize || 0);
  const capsuleBytes = Number(meta?.capsuleCache?.capsule?.capsuleBytes || 0);
  const compressionRatio = rawBytes > 0 ? Math.max(0, 1 - capsuleBytes / rawBytes) : 0;
  return {
    path: meta.path,
    originalSize: Number(meta.originalSize || 0),
    compressedSize: Number(meta.compressedSize || 0),
    indexed: workspaceRecordIndexed(meta),
    kind: meta?.kind || (workspaceRecordIndexed(meta) ? 'source' : 'pending'),
    fileType: String(meta?.fileType || ''),
    parserFamily: String(meta?.parserFamily || ''),
    parseOk: Boolean(meta?.parseOk),
    capsuleMode: String(meta?.capsuleMode || ''),
    status: String(meta?.status || (workspaceRecordIndexed(meta) ? 'completed' : 'pending')),
    error: String(meta?.error || ''),
    compressionRatio,
    capsuleBytes,
    rawBytes,
    transportBytes: Number(meta?.rawStorage?.transportBytes || 0),
  };
}

/** @returns {void} */
function clearLocalWorkspaceFiles() {
  localAssistantWorkspace.files.clear();
  localAssistantWorkspace.fileCountTotal     = 0;
  localAssistantWorkspace.fileCountCompleted = 0;
  localAssistantWorkspace.fileCountPending   = 0;
  localAssistantWorkspace.fileCountFailed    = 0;
  localAssistantWorkspace.rootPath           = null;
  localAssistantWorkspace.folderName         = null;
  localAssistantWorkspace.status             = 'cleared';
}

/**
 * @param {string} folderName
 * @param {string} userId
 * @returns {string}
 */
function canonicalWorkspaceId(folderName, userId) {
  const folder = String(folderName || 'workspace').trim() || 'workspace';
  const user   = String(userId || '').trim();
  return user ? `${folder}-${user}` : folder;
}

const { enqueueLocalWorkspaceEnrichment } = wo;

/**
 * @param {object} param0
 * @returns {Promise<object>}
 */
async function syncWorkspaceFiles({ workspaceId = '', folderName, files, deletedPaths, mode, scanEpoch, complete, userId = '' }) {
  const normalizedFolderName = String(folderName || localAssistantWorkspace.folderName || 'workspace').trim() || 'workspace';
  const clientWorkspaceId = String(workspaceId || '').trim();
  const normalizedWorkspaceId = clientWorkspaceId
    || String(localAssistantWorkspace.workspaceId || '').trim()
    || canonicalWorkspaceId(normalizedFolderName, userId);
  const syncMode = String(mode || 'background').trim().toLowerCase() || 'background';
  const perf = createWorkspacePerfTracker('server-sync', {
    folderName: normalizedFolderName,
    mode: syncMode,
    scanEpoch: Number(scanEpoch || 0),
  });

  if (normalizedFolderName && localAssistantWorkspace.folderName !== normalizedFolderName) {
    clearLocalWorkspaceFiles();
    localAssistantWorkspace.folderName = normalizedFolderName;
  }

  const removedPaths = Array.isArray(deletedPaths)
    ? deletedPaths.map((entry) => toSafePath(entry)).filter((filePath) => isWorkspaceIndexablePath(filePath))
    : [];
  for (const filePath of removedPaths) localAssistantWorkspace.files.delete(filePath);
  perf.mark('deletes-applied', { deleted: removedPaths.length });

  const incomingFiles = Array.isArray(files) ? files : [];
  const normalizedFiles = incomingFiles
    .map((file) => {
      const filePath = toSafePath(file?.path || file?.name || '');
      if (!filePath || !isWorkspaceIndexablePath(filePath)) return null;
      return { path: filePath, content: typeof file?.content === 'string' ? file.content : String(file?.content || '') };
    })
    .filter(Boolean);
  const workspaceFilePaths = Array.from(new Set([
    ...Array.from(localAssistantWorkspace.files.keys()).filter((filePath) => isWorkspaceIndexablePath(filePath)),
    ...normalizedFiles.map((file) => file.path),
  ]));

  const filesToBuild = syncMode === 'single-file'
    ? normalizedFiles.filter((file) => {
      const existing = localAssistantWorkspace.files.get(file.path);
      if (!existing?.rawStorage?.digest) return true;
      const incomingDigest = crypto.createHash('sha256').update(file.content).digest('hex');
      return incomingDigest !== existing.rawStorage.digest;
    })
    : normalizedFiles;

  const packedEntries = await mapWithConcurrency(filesToBuild, MESH_WORKSPACE_BUILD_CONCURRENCY, async (file) => {
    const record = await buildWorkspaceFileRecord(file.path, file.content, {
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
      workspaceFilePaths,
      recordMode: syncMode === 'single-file' ? 'full' : 'initial',
    });
    return { path: file.path, record };
  });
  perf.mark('records-built', { changed: packedEntries.length, skipped: normalizedFiles.length - filesToBuild.length });

  for (const entry of packedEntries) {
    localAssistantWorkspace.files.set(entry.path, { ...entry.record, path: entry.path, kind: 'source' });
  }

  localAssistantWorkspace.folderName         = normalizedFolderName;
  localAssistantWorkspace.workspaceId        = normalizedWorkspaceId;
  localAssistantWorkspace.rootPath           = '';
  localAssistantWorkspace.sourceKind         = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.fileCountTotal     = localAssistantWorkspace.files.size;
  localAssistantWorkspace.fileCountCompleted = [...localAssistantWorkspace.files.values()].filter((meta) => workspaceRecordIndexed(meta)).length;
  localAssistantWorkspace.fileCountPending   = Math.max(0, localAssistantWorkspace.files.size - localAssistantWorkspace.fileCountCompleted);
  localAssistantWorkspace.fileCountFailed    = 0;
  localAssistantWorkspace.status             = complete === true ? 'background-complete' : (syncMode === 'initial' ? 'initial-ready' : 'processing');
  localAssistantWorkspace.indexedAt          = toIsoNow();
  debouncedPersistLocalWorkspaceState();

  if (syncMode !== 'single-file') {
    enqueueLocalWorkspaceEnrichment({ workspaceId: normalizedWorkspaceId, folderName: normalizedFolderName });
  }
  perf.flush({ discovered: normalizedFiles.length, deleted: removedPaths.length, total: localAssistantWorkspace.files.size });

  const compressionStats = packedEntries.map(({ path: p, record }) => {
    const raw = Number(record.rawStorage?.rawBytes || record.originalSize || 0);
    const capsule = Number(record.capsuleCache?.capsule?.capsuleBytes || 0);
    return { path: p, rawBytes: raw, capsuleBytes: capsule };
  }).filter((e) => e.rawBytes > 0);

  if (complete === true) {
    appendOperationLog('ok', `Workspace indexed: ${normalizedFolderName} (${localAssistantWorkspace.files.size} files)`, {
      region: config.MESH_REGION || 'local',
      source: 'workspace',
    });
  }

  return {
    ok: true,
    folderName: localAssistantWorkspace.folderName,
    workspaceId: normalizedWorkspaceId,
    mode: syncMode,
    count: localAssistantWorkspace.files.size,
    fileCount: localAssistantWorkspace.files.size,
    indexedCount: localAssistantWorkspace.fileCountCompleted,
    pendingCount: localAssistantWorkspace.fileCountPending,
    deletedCount: removedPaths.length,
    status: localAssistantWorkspace.status,
    compressionStats,
  };
}

// ── Startup initialization ───────────────────────────────────────────────────
(async () => { await auth.loadAuthStore(); })();
restoreLocalWorkspaceState();
loadOperationsStore();
appendOperationLog('info', 'Mesh server started', {
  region: config.MESH_REGION || 'local',
  source: 'system',
});

// ── Exports ──────────────────────────────────────────────────────────────────
module.exports = {
  // Node/infra shortcuts
  secureDb,
  brotliCompress,
  brotliDecompress,
  execFileAsync,
  clampBrotliQuality,
  parseBooleanFlag,
  parseIntegerInRange,
  trimTrailingSlashes,
  normalizeSasToken,

  // Config constants
  MESH_CORE_URL,
  LOCAL_WORKSPACE_CACHE_FILE,
  OPERATIONS_STORE_FILE,
  WORKSPACE_BROTLI_QUALITY,
  WORKSPACE_INITIAL_BROTLI_QUALITY,
  MESH_TUNNEL_BROTLI_QUALITY,
  MESH_WORKSPACE_INDEX_PARALLELISM,
  MESH_WORKSPACE_READ_CONCURRENCY,
  MESH_WORKSPACE_BUILD_CONCURRENCY,
  MESH_WORKSPACE_ENRICH_CONCURRENCY,
  MESH_WORKSPACE_PERF_LOG,
  WORKSPACE_SELECT_ASYNC_MODE,
  WORKSPACE_SELECT_ASYNC_ENABLED,
  WORKSPACE_SELECT_JOB_TTL_MS,
  WORKSPACE_SELECT_MAX_JOB_HISTORY,
  WORKSPACE_SELECT_MAX_PENDING,
  WORKSPACE_SOURCE_UPLOAD,
  WORKSPACE_SOURCE_LOCAL_PATH,
  LOCAL_WORKSPACE_SKIP_EXTENSIONS,
  LOCAL_WORKSPACE_SKIP_DIRS,
  LOCAL_WORKSPACE_MAX_FILE_CHARS,
  MAX_OPERATION_LOGS,

  // Shared state
  localAssistantWorkspace,
  workspaceMetadataStore,
  operationsStore,
  assistantRuns,
  assistantTerminalSessions,
  workspaceSelectJobs,
  workspaceSelectJobOrder,
  workspaceSelectChains,
  lastAuthStoreErrorLogAt,

  // Wiring utilities
  toIsoNow,
  toSafeSlug,
  normalizeWorkspaceSourceKind,
  sanitizeBlobContainerName,
  safeReadJsonFile,
  safeWriteJsonFile,
  normalizeOperationLevel,
  normalizeOperationRegion,
  defaultOperationPolicies,
  defaultOperationsStore,
  sanitizeDeploymentList,
  sanitizePolicyList,
  sanitizeOperationLogs,
  persistOperationsStore,
  loadOperationsStore,
  appendOperationLog,
  inferRegionFromRouteName,
  snapshotOperationsPayload,
  serializeLocalWorkspaceState,
  persistLocalWorkspaceState,
  debouncedPersistLocalWorkspaceState,
  restoreLocalWorkspaceState,
  workspaceRecordIndexed,
  ensureLocalWorkspaceMeta,
  loadLocalWorkspaceRecordText,
  buildWorkspaceFileListingEntry,
  clearLocalWorkspaceFiles,
  canonicalWorkspaceId,
  syncWorkspaceFiles,

  // Domain modules — spread so callers get a flat namespace
  ...auth,
  ...mp,
  ...ar,
  ...wi,
  ...wc,
  ...wo,
  ...dep,
};

// Inject shared runtime state into the global namespace so sub-modules
// (workspace-ops, workspace-context, assistant-runs, etc.) can access it
// without creating circular imports.
Object.assign(global, module.exports);
