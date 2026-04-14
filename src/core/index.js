/**
 * MESH — Dev server
 * Serves static files, proxies Anthropic AI, and provides WebSocket terminal via node-pty.
 *
 * Start: node server.js
 * Needs: ANTHROPIC_API_KEY env var for AI (optional — falls back to mock)
 */

const express = require("express");
const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const crypto  = require("crypto");
const zlib    = require("zlib");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { WebSocketServer } = require("ws");
const config = require('../config');
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

// ── Extracted domain modules ──
const auth = require('./auth');
const mp   = require('./model-providers');
const ar   = require('./assistant-runs');
const wi   = require('./workspace-infrastructure');
const wc   = require('./workspace-context');
const wo   = require('./workspace-ops');
const dep  = require('./deployments');

// Bring auth exports into scope (for use by remaining code + module.exports)
const {
  AUTH_STORE_FILE, AUTH_SESSION_TTL_MS, AUTH_SESSION_TOUCH_INTERVAL_MS,
  AUTH_COOKIE_NAME, AUTH_COOKIE_PATH, AUTH_COOKIE_SAME_SITE, AUTH_COOKIE_SECURE,
  DEMO_USER_EMAIL, DEMO_USER_EMAIL_ALIASES, DEMO_USER_PASSWORD,
  USER_STORE_ALLOWED_KEYS, USER_STORE_MAX_JSON_BYTES,
  normalizeEmail, hashPassword, verifyPassword, sanitizeAuthUser, reportAuthStoreError,
  buildDemoUserSeed, ensureDemoUserRecord, loadAuthStore, issueAuthSession,
  parseCookiesFromHeader, decodeCookieValue, readAuthCookieToken, normalizeSameSiteValue,
  createCookieHeader, setAuthCookie, clearAuthCookie, readAuthTokenFromRequest,
  resolveAuthUserFromRequest, requireAuth, pruneExpiredSessions,
  normalizeUserStoreKey, normalizeRequestedStoreKeys, normalizeStoredByokProviders,
  getStoredCredentialsForUser, mergeChatCredentials,
} = auth;
let lastAuthStoreErrorLogAt = 0; // retained for global export; internal tracking is in auth.js

// Bring model-provider + codec exports into scope
const {
  Anthropic,
  STATIC_MODELS, MESH_DEFAULT_MODEL, ALL_STATIC_MODELS,
  DEFAULT_BYOK_BASE_URLS, DEFAULT_AZURE_API_VERSION,
  MESH_MODEL_CODEC_VERSION, MESH_MODEL_CODEC_CONTEXT_MARKER,
  MESH_MODEL_CODEC_RESPONSE_OPEN, MESH_MODEL_CODEC_RESPONSE_CLOSE,
  MESH_MODEL_CODEC_PAYLOAD_PREFIX, MESH_MODEL_CODEC_PAYLOAD_SUFFIX,
  MESH_MODEL_CODEC_TERMS, MESH_MODEL_CODEC_ESCAPE_PREFIX, MESH_MODEL_CODEC_ESCAPE_REPLACEMENT,
  MESH_MODEL_CODEC_NEWLINE_TOKEN, MESH_MODEL_CODEC_TAB_TOKEN,
  MESH_MODEL_CODEC_TABLE, MESH_MODEL_CODEC_ENCODE_TABLE, MESH_MODEL_CODEC_DECODE_TABLE,
  meshCodecSessionState, injectMeshSystemPrompt,
  stripModelPrefix, readMessageText, normalizeMessages, toOpenAiMessages, toAnthropicMessages,
  toGeminiContents, trimTrailingSlash, joinPath, isAzureProvider, normalizeAzureBaseUrl,
  modelDisplayLabel, parseProviderError, normalizeProviderUsage, readJsonResponse,
  buildOpenAIChatCompletionBody, providerWantsMaxCompletionTokens, textFromMaybeContent,
  extractAssistantTextFromChatPayload, callOpenAIResponsesEndpoint, callOpenAICompatibleChat,
  callAzureOpenAIChat, callByokProviderChat, callAnthropicChatWithMeta, callAnthropicChat,
  callGeminiChat, BEDROCK_MODEL_MAP, resolveBedrockModelId, createBedrockClient, callBedrockDirect,
  normalizeByokProviders, resolveProviderForModel, runModelChat,
  fetchAnthropicModels, fetchOpenAICompatibleModels, fetchGeminiModels,
  dedupeModelIds, staticModelMatch, normalizeImportedModels, normalizeRequestedModelIds,
  validateProviderKey, extractActiveFilePathFromMessages, replaceLiteralAll, escapeRegexLiteral,
  rot47Transform, textCompositionStats, containsCodecSignals, isLikelyUnframedRot47,
  decodedReadabilityScore, pickMostReadableDecoded, decodeCodecTokens, codecTokenShouldReplace,
  encodeMeshModelCodec, decodeMeshModelCodec, buildMeshCodecContextDocument, hasCodecContextMarker,
  normalizeChatSessionId, pruneCodecSessionStateIfNeeded, markCodecContextInitialized,
  isCodecContextInitializedForSession, injectCodecContextIntoMessages,
  extractCompressedModelPayload, decodeCompressedModelResponse, escapeTagAttribute, dedupePaths,
} = mp;

// Bring assistant-run exports into scope
const {
  cloneJsonValue, normalizeRunActionState, touchRunEntity, createAssistantRunRecord,
  assistantRunSnapshot, extractExplicitPathReferences, ensureRunWorkspacePath,
  extractExplicitCommandFromPrompt, hasEditIntent, hasSearchIntent, hasReadIntent, hasOpsIntent,
  buildOpsContextSnippet, resolveAssistantCandidatePaths, buildHeuristicAssistantRunPlan,
  planAssistantRunWithModel, planAssistantRun, normalizeDiffText, computeProposalLineDelta,
  buildProposalDiff, extractFirstFencedCodeBlock, extractDirectProposalContent,
  buildFallbackTemplateForTarget, extractProposalTargetPaths, generateAssistantWriteProposal,
  generateAssistantWriteBatch, resolveRunBatch, resolveRunProposal, syncBatchStatusFromProposals,
  ensureApplyBatchActionForRun, ensureApplyProposalActionsForBatch, buildActionResultSummary,
  buildFallbackAssistantRunReply, summarizeAssistantRun, executeAssistantRunAction,
  continueAssistantRun, createAssistantRun, applyAssistantRunDecision,
} = ar;

// Bring workspace-infrastructure exports into scope
const {
  meshTunnelRequest,
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
  localWorkspaceSummary,
  clearLocalWorkspaceState,
  isLocalPathWorkspaceState,
  isUploadWorkspaceState,
  syncLocalUploadWorkspaceSummary,
  toWorkspacePath,
  toWorkspaceRelativePath,
  normalizeAbsoluteRootPath,
  resolveLocalWorkspaceAbsolutePath,
  gitPathFromWorkspacePath,
  workspacePathFromGitPath,
  createWorkspacePerfTracker,
  mapWithConcurrency,
  isWorkspaceIndexablePath,
  generateMeshWorkspaceTree,
  generateMeshWorkspaceTreeFromManifest,
  provisionMeshWorkspaceMetadata,
  readLocalWorkspaceFileText,
  scanLocalWorkspaceFiles,
  packLocalWorkspaceContent,
  localWorkspaceUploadBlobStorageForPath,
  packLocalBlobBackedWorkspaceRecord,
  writeLocalWorkspaceFileToDisk,
  normalizeGitError,
  getLocalGitCwd,
  runLocalGit,
  isMeshWorkerUnavailableError,
  countPendingWorkspaceSelectJobs,
  pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload,
  workspaceSelectScopeKey,
  computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob,
  buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback,
  enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload,
  getWorkspaceSelectJobForUser,
  sortedLocalPaths,
  buildAzureBlobAbsoluteUrl,
  buildAzureBlobCanonicalUrl,
  normalizeWorkspaceBlobStorage,
  buildWorkspaceBlobReadUrl,
  createWorkspaceOffloadConfig,
  workspaceOffloadConfig,
  workspaceOffloadClientConfig,
  compressLocalWorkspaceText,
  decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile,
  readWorkspaceBlobText,
  writeWorkspaceBlobText,
  copyWorkspaceBlob,
  deleteWorkspaceBlob,
} = wi;

// Bring workspace-context exports into scope
const {
  compressLocalWorkspaceChunkFiles,
  openWorkspaceFileWithFallback,
  recoverWorkspaceWithFallback,
  searchWorkspaceWithFallback,
  grepWorkspaceWithFallback,
  renameWorkspaceFileWithFallback,
  deleteWorkspaceFileWithFallback,
  applyWorkspaceBatchWithFallback,
  openLocalWorkspaceWithFallback,
  runGitWithFallback,
  sanitizeTerminalChunk,
  makeAssistantTerminalEntry,
  getAssistantTerminalSession,
  createAssistantTerminalSession,
  listAssistantTerminalOutput,
  writeAssistantTerminalInput,
  destroyAssistantTerminalSession,
  createCompressedContextExcerpt,
  normalizeContextExcerptText,
  normalizeExcerptFocusTerms,
  collectFocusedCharRanges,
  mergeCharRanges,
  buildExcerptFromCharRanges,
  loadCompressedContextEntries,
  loadPlainContextEntries,
  buildPlainContextBlock,
  buildCompressedContextBlock,
  shouldPrefetchRecoveryForPrompt,
  loadCapsuleContextEntries,
  loadRecoveredSpanEntries,
  buildCapsuleContextBlock,
  injectCompressedContextIntoMessages,
  buildModelResponseTransport,
  buildServerCodecRecovery,
  polishDecompressedAssistantText,
  looksLikeCodecProtocolRefusal,
} = wc;

// Bring workspace-ops exports into scope
const {
  enqueueLocalWorkspaceEnrichment,
  drainLocalWorkspaceEnrichmentQueue,
  enrichLocalWorkspaceRecords,
  localWorkspaceSelect,
  localWorkspaceOpenLocal,
  localWorkspaceFiles,
  localWorkspaceGraph,
  localWorkspaceFile,
  localWorkspaceSave,
  localWorkspaceCreate,
  buildWorkspaceQueryContext,
  localWorkspaceSearch,
  findMatchesInText,
  localWorkspaceGrep,
  localWorkspaceRename,
  localWorkspaceDelete,
  localWorkspaceBatch,
  localGitStatus,
  ingestWorkspaceChunkFromOffload,
  localResolveReferencedFiles,
  QUERY_EXTENSION_HINTS,
  SINGLE_FILE_LOOKUP_RE,
  MULTI_FILE_LOOKUP_RE,
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  BROAD_CHANGE_INTENT_RE,
  resolveAdaptiveCompressedContextBudget,
  FILE_QUERY_STOP_WORDS,
  extractSearchTokens,
  compactAlphaNumeric,
  scorePathForQuery,
  rankWorkspacePathsForQuery,
  inferReferencedFilesFromWorkspace,
  localAssistantReply,
} = wo;

// Bring deployments exports into scope
const {
  normalizeDeploymentRisk,
  normalizePolicyMode,
  normalizePolicyStatus,
  normalizePolicyRegion,
  parsePolicyScopeFromPayload,
  stringifyPolicyScope,
  uniqueDeploymentId,
  queueDeployment,
  settleDeploymentAction,
  uniquePolicyId,
  createPolicy,
  updatePolicy,
} = dep;

let pty;
try { pty = require("node-pty"); } catch { pty = null; }


// Moved server initialization to src/server.js
const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);
const MESH_CORE_URL = config.MESH_CORE_URL;
const LOCAL_WORKSPACE_CACHE_FILE = path.join(__dirname, ".mesh-workspace-cache.json");
const OPERATIONS_STORE_FILE = path.join(__dirname, ".mesh-operations-store.json");
// NOTE: AUTH_STORE_FILE is imported from ./auth (above)
const WORKSPACE_BROTLI_QUALITY = config.WORKSPACE_BROTLI_QUALITY;
const WORKSPACE_INITIAL_BROTLI_QUALITY = config.WORKSPACE_INITIAL_BROTLI_QUALITY;
const MESH_TUNNEL_BROTLI_QUALITY = config.MESH_TUNNEL_BROTLI_QUALITY;
const MESH_WORKSPACE_INDEX_PARALLELISM = config.MESH_WORKSPACE_INDEX_PARALLELISM;
const MESH_WORKSPACE_READ_CONCURRENCY = config.MESH_WORKSPACE_READ_CONCURRENCY;
const MESH_WORKSPACE_BUILD_CONCURRENCY = config.MESH_WORKSPACE_BUILD_CONCURRENCY;
const MESH_WORKSPACE_ENRICH_CONCURRENCY = config.MESH_WORKSPACE_ENRICH_CONCURRENCY;
const MESH_WORKSPACE_PERF_LOG = config.MESH_WORKSPACE_PERF_LOG;
const WORKSPACE_SELECT_ASYNC_MODE = config.WORKSPACE_SELECT_ASYNC_MODE;
const WORKSPACE_SELECT_ASYNC_ENABLED = config.WORKSPACE_SELECT_ASYNC_ENABLED;
const WORKSPACE_SELECT_JOB_TTL_MS = config.WORKSPACE_SELECT_JOB_TTL_MS;
const WORKSPACE_SELECT_MAX_JOB_HISTORY = config.WORKSPACE_SELECT_MAX_JOB_HISTORY;
const WORKSPACE_SELECT_MAX_PENDING = config.WORKSPACE_SELECT_MAX_PENDING;
const WORKSPACE_SOURCE_UPLOAD = "upload";
const WORKSPACE_SOURCE_LOCAL_PATH = "local-path";
const LOCAL_WORKSPACE_SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|gz|tar|lock)$/i;
const LOCAL_WORKSPACE_SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__)(\/|$)/;
const LOCAL_WORKSPACE_MAX_FILE_CHARS = 1_000_000;

const localAssistantWorkspace = {
  folderName: null,
  rootPath: null,
  workspaceId: null,
  sessionId: null,
  sourceKind: WORKSPACE_SOURCE_UPLOAD,
  files: new Map(),
  fileCountTotal: 0,
  fileCountCompleted: 0,
  fileCountFailed: 0,
  fileCountPending: 0,
  status: "",
  indexedAt: null,
};
const workspaceMetadataStore = createWorkspaceMetadataStore();

const operationsStore = {
  deployments: {
    pending: [],
    history: [],
  },
  policies: [],
  logs: [],
  updatedAt: null,
};

const MAX_OPERATION_LOGS = 600;
const assistantRuns = new Map();
const assistantTerminalSessions = new Map();
const workspaceSelectJobs = new Map();
const workspaceSelectJobOrder = [];
const workspaceSelectChains = new Map();
const execFileAsync = promisify(execFile);

const { clampBrotliQuality, parseBooleanFlag, parseIntegerInRange, trimTrailingSlashes, normalizeSasToken } = require('../config/env-utils');

function sanitizeBlobContainerName(rawValue) {
  return String(rawValue || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function safeReadJsonFile(filePath, fallbackValue) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) return fallbackValue;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallbackValue;
    return parsed;
  } catch {
    return fallbackValue;
  }
}

function safeWriteJsonFile(filePath, value) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
  } catch {
    // Ignore persistence write failures in demo mode.
  }
}

function normalizeWorkspaceSourceKind(rawValue) {
  return String(rawValue || "").trim().toLowerCase() === WORKSPACE_SOURCE_LOCAL_PATH
    ? WORKSPACE_SOURCE_LOCAL_PATH
    : WORKSPACE_SOURCE_UPLOAD;
}

function toIsoNow() {
  return new Date().toISOString();
}

function toSafeSlug(value, fallback = "item") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function normalizeOperationLevel(level) {
  const normalized = String(level || "info").trim().toLowerCase();
  if (["err", "warn", "info", "ok"].includes(normalized)) return normalized;
  return "info";
}

function normalizeOperationRegion(region) {
  const normalized = String(region || "eu").trim().toLowerCase();
  if (["eu", "us", "ap"].includes(normalized)) return normalized;
  return "eu";
}

function defaultOperationPolicies() {
  return [];
}

function defaultOperationsStore() {
  return {
    deployments: { pending: [], history: [] },
    policies: [],
    logs: [],
    updatedAt: toIsoNow(),
  };
}

function sanitizeDeploymentList(list) {
  const input = Array.isArray(list) ? list : [];
  return input
    .map((entry) => {
      const id = toSafeSlug(entry?.id, "deploy");
      const title = String(entry?.title || "Untitled deployment").trim();
      if (!id || !title) return null;
      return {
        id,
        route: String(entry?.route || "workspace").trim() || "workspace",
        region: String(entry?.region || "EU Central").trim() || "EU Central",
        title,
        risk: String(entry?.risk || "low").trim().toLowerCase() || "low",
        description: String(entry?.description || "").trim(),
        targetWindow: String(entry?.targetWindow || "Immediate").trim() || "Immediate",
        rollback: String(entry?.rollback || "Manual rollback").trim() || "Manual rollback",
        diff: String(entry?.diff || "").trim(),
        requestedBy: String(entry?.requestedBy || "operator").trim() || "operator",
        requestedAt: String(entry?.requestedAt || toIsoNow()),
        resolvedBy: String(entry?.resolvedBy || "").trim(),
        resolvedAt: String(entry?.resolvedAt || "").trim(),
        outcome: String(entry?.outcome || "").trim().toLowerCase(),
      };
    })
    .filter(Boolean);
}

function sanitizePolicyList(list) {
  const input = Array.isArray(list) ? list : [];
  return input
    .map((entry) => {
      const id = toSafeSlug(entry?.id, "policy");
      if (!id) return null;

      const scope = parsePolicyScopeFromPayload(entry, {
        route: "workspace",
        region: "global",
      });

      return {
        id,
        type: String(entry?.type || "Custom").trim() || "Custom",
        mode: normalizePolicyMode(entry?.mode),
        route: scope.route,
        region: scope.region,
        applied: String(entry?.applied || stringifyPolicyScope(scope.route, scope.region)).trim() || stringifyPolicyScope(scope.route, scope.region),
        status: normalizePolicyStatus(entry?.status),
        description: String(entry?.description || "").trim(),
        modifiedAt: String(entry?.modifiedAt || entry?.updatedAt || toIsoNow()),
      };
    })
    .filter(Boolean);
}

function sanitizeOperationLogs(logs) {
  const input = Array.isArray(logs) ? logs : [];
  return input
    .map((entry) => {
      const message = String(entry?.message || "").trim();
      if (!message) return null;
      return {
        id: String(entry?.id || crypto.randomUUID()),
        level: normalizeOperationLevel(entry?.level),
        region: normalizeOperationRegion(entry?.region),
        message,
        source: String(entry?.source || "system").trim() || "system",
        createdAt: String(entry?.createdAt || toIsoNow()),
      };
    })
    .filter(Boolean)
    .slice(-MAX_OPERATION_LOGS);
}

function persistOperationsStore() {
  operationsStore.updatedAt = toIsoNow();
  safeWriteJsonFile(OPERATIONS_STORE_FILE, operationsStore);
}

function loadOperationsStore() {
  const defaults = defaultOperationsStore();
  const persisted = safeReadJsonFile(OPERATIONS_STORE_FILE, null);
  const source = persisted && typeof persisted === "object" ? persisted : defaults;

  operationsStore.deployments.pending = sanitizeDeploymentList(source?.deployments?.pending);
  operationsStore.deployments.history = sanitizeDeploymentList(source?.deployments?.history);
  operationsStore.policies = sanitizePolicyList(source?.policies);
  operationsStore.logs = sanitizeOperationLogs(source?.logs);
  operationsStore.updatedAt = String(source?.updatedAt || toIsoNow());

  if (!operationsStore.policies.length) {
    operationsStore.policies = defaultOperationPolicies();
  }

  if (!operationsStore.logs.length) {
    operationsStore.logs = [
      {
        id: crypto.randomUUID(),
        level: "info",
        region: "eu",
        message: "Operational data store initialized.",
        source: "server",
        createdAt: toIsoNow(),
      },
    ];
  }

  persistOperationsStore();
}

function appendOperationLog(level, message, options = {}) {
  const payload = {
    id: crypto.randomUUID(),
    level: normalizeOperationLevel(level),
    region: normalizeOperationRegion(options.region),
    message: String(message || "").trim(),
    source: String(options.source || "system").trim() || "system",
    createdAt: toIsoNow(),
  };
  if (!payload.message) return;

  operationsStore.logs.push(payload);
  if (operationsStore.logs.length > MAX_OPERATION_LOGS) {
    operationsStore.logs = operationsStore.logs.slice(-MAX_OPERATION_LOGS);
  }
  persistOperationsStore();
}

function inferRegionFromRouteName(name) {
  const normalized = String(name || "").toLowerCase();
  if (normalized.includes("ap")) return "ap";
  if (normalized.includes("us")) return "us";
  return "eu";
}

function snapshotOperationsPayload() {
  const pending = operationsStore.deployments.pending;
  const history = operationsStore.deployments.history;

  return {
    ok: true,
    deployments: {
      pending,
      history,
    },
    pending,
    history,
    policies: operationsStore.policies,
    logs: operationsStore.logs.slice(-300),
    updatedAt: operationsStore.updatedAt,
  };
}

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

function persistLocalWorkspaceState() {
  safeWriteJsonFile(LOCAL_WORKSPACE_CACHE_FILE, serializeLocalWorkspaceState());
}

// Debounced variant — coalesces rapid consecutive syncs into a single disk write.
// The in-memory state is always current; only the flush to disk is deferred.
let _persistDebounceTimer = null;
function debouncedPersistLocalWorkspaceState() {
  if (_persistDebounceTimer) clearTimeout(_persistDebounceTimer);
  _persistDebounceTimer = setTimeout(() => {
    _persistDebounceTimer = null;
    persistLocalWorkspaceState();
  }, 200);
}

function restoreLocalWorkspaceState() {
  const persisted = safeReadJsonFile(LOCAL_WORKSPACE_CACHE_FILE, null);
  if (!persisted || typeof persisted !== "object") return;

  const restoredFiles = new Map();
  const files = Array.isArray(persisted.files) ? persisted.files : [];
  for (const file of files) {
    const pathValue = toSafePath(file?.path);
    if (!pathValue) continue;
    restoredFiles.set(pathValue, {
      ...file,
      path: pathValue,
    });
  }

  localAssistantWorkspace.folderName = String(persisted.folderName || "") || null;
  localAssistantWorkspace.rootPath = String(persisted.rootPath || "") || null;
  localAssistantWorkspace.workspaceId = String(persisted.workspaceId || "") || null;
  localAssistantWorkspace.sessionId = String(persisted.sessionId || "") || null;
  localAssistantWorkspace.sourceKind = normalizeWorkspaceSourceKind(persisted.sourceKind);
  localAssistantWorkspace.fileCountTotal = Number(persisted.fileCountTotal || restoredFiles.size || 0);
  localAssistantWorkspace.fileCountCompleted = Number(persisted.fileCountCompleted || restoredFiles.size || 0);
  localAssistantWorkspace.fileCountFailed = Number(persisted.fileCountFailed || 0);
  localAssistantWorkspace.fileCountPending = Number(persisted.fileCountPending || 0);
  localAssistantWorkspace.status = String(persisted.status || "") || "";
  localAssistantWorkspace.indexedAt = String(persisted.indexedAt || "") || null;
  localAssistantWorkspace.files = restoredFiles;
}

function workspaceRecordIndexed(meta) {
  return Boolean(
    meta?.capsuleCache
    && meta?.transportEnvelope
    && (meta?.rawStorage || meta?.compressedBase64)
  );
}

async function ensureLocalWorkspaceMeta(meta, pathHint = "") {
  return ensureWorkspaceFileRecord(meta, {
    path: pathHint || meta?.path || "",
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
  });
}

async function loadLocalWorkspaceRecordText(meta, requestedPath = "") {
  const record = await ensureLocalWorkspaceMeta(meta, requestedPath || meta?.path || "");
  if (record?.storage?.provider === "azure-blob") {
    const blobText = await readWorkspaceBlobText(record.storage, record.originalSize);
    return blobText.content;
  }
  return decodeRawStorage(record.rawStorage);
}

function buildWorkspaceFileListingEntry(meta) {
  const stats = meta?.compressionStats || {};
  return {
    path: meta.path,
    originalSize: Number(meta.originalSize || 0),
    compressedSize: Number(meta.compressedSize || 0),
    indexed: workspaceRecordIndexed(meta),
    kind: meta?.kind || (workspaceRecordIndexed(meta) ? "source" : "pending"),
    fileType: String(meta?.fileType || ""),
    parserFamily: String(meta?.parserFamily || ""),
    parseOk: Boolean(meta?.parseOk),
    capsuleMode: String(meta?.capsuleMode || ""),
    status: String(meta?.status || (workspaceRecordIndexed(meta) ? "completed" : "pending")),
    error: String(meta?.error || ""),
    compressionRatio: Number(stats.compressionRatio || 0),
    capsuleBytes: Number(stats.capsuleBytes || 0),
    rawBytes: Number(stats.rawBytes || meta?.originalSize || 0),
    transportBytes: Number(stats.transportBytes || 0),
  };
}

(async () => {
  await loadAuthStore();
})();
restoreLocalWorkspaceState();
loadOperationsStore();

function clearLocalWorkspaceFiles() {
  localAssistantWorkspace.files.clear();
  localAssistantWorkspace.fileCountTotal = 0;
  localAssistantWorkspace.fileCountCompleted = 0;
  localAssistantWorkspace.fileCountPending = 0;
  localAssistantWorkspace.fileCountFailed = 0;
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.folderName = null;
  localAssistantWorkspace.status = "cleared";
}

function canonicalWorkspaceId(folderName, userId) {
  const folder = String(folderName || "workspace").trim() || "workspace";
  const user = String(userId || "").trim();
  return user ? `${folder}-${user}` : folder;
}

async function syncWorkspaceFiles({ workspaceId = "", folderName, files, deletedPaths, mode, scanEpoch, complete, userId = "" }) {
  const normalizedFolderName = String(folderName || localAssistantWorkspace.folderName || "workspace").trim() || "workspace";
  const clientWorkspaceId = String(workspaceId || "").trim();
  const normalizedWorkspaceId = clientWorkspaceId
    || String(localAssistantWorkspace.workspaceId || "").trim()
    || canonicalWorkspaceId(normalizedFolderName, userId);
  const syncMode = String(mode || "background").trim().toLowerCase() || "background";
  const perf = createWorkspacePerfTracker("server-sync", {
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
  for (const filePath of removedPaths) {
    localAssistantWorkspace.files.delete(filePath);
  }
  perf.mark("deletes-applied", { deleted: removedPaths.length });

  const incomingFiles = Array.isArray(files) ? files : [];
  const normalizedFiles = incomingFiles
    .map((file) => {
      const filePath = toSafePath(file?.path || file?.name || "");
      if (!filePath || !isWorkspaceIndexablePath(filePath)) return null;
      return {
        path: filePath,
        content: typeof file?.content === "string" ? file.content : String(file?.content || ""),
      };
    })
    .filter(Boolean);
  const workspaceFilePaths = Array.from(new Set([
    ...Array.from(localAssistantWorkspace.files.keys()).filter((filePath) => isWorkspaceIndexablePath(filePath)),
    ...normalizedFiles.map((file) => file.path),
  ]));
  // Skip Gate: for single-file saves, skip re-encoding if the content is identical
  // to what's already stored. SHA-256 is ~0.1ms vs Brotli compression at ~2-10ms.
  // Only applies to single-file mode — initial syncs always rebuild all records.
  const filesToBuild = syncMode === "single-file"
    ? normalizedFiles.filter((file) => {
        const existing = localAssistantWorkspace.files.get(file.path);
        if (!existing?.rawStorage?.digest) return true;
        const incomingDigest = crypto.createHash("sha256").update(file.content).digest("hex");
        return incomingDigest !== existing.rawStorage.digest;
      })
    : normalizedFiles;

  const packedEntries = await mapWithConcurrency(filesToBuild, MESH_WORKSPACE_BUILD_CONCURRENCY, async (file) => {
    const record = await buildWorkspaceFileRecord(file.path, file.content, {
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
      workspaceFilePaths,
      recordMode: syncMode === "single-file" ? "full" : "initial",
    });
    return { path: file.path, record };
  });
  perf.mark("records-built", { changed: packedEntries.length, skipped: normalizedFiles.length - filesToBuild.length });

  for (const entry of packedEntries) {
    localAssistantWorkspace.files.set(entry.path, {
      ...entry.record,
      path: entry.path,
      kind: "source",
    });
  }

  localAssistantWorkspace.folderName = normalizedFolderName;
  localAssistantWorkspace.workspaceId = normalizedWorkspaceId;
  localAssistantWorkspace.rootPath = "";
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.fileCountTotal = localAssistantWorkspace.files.size;
  localAssistantWorkspace.fileCountCompleted = [...localAssistantWorkspace.files.values()].filter((meta) => workspaceRecordIndexed(meta)).length;
  localAssistantWorkspace.fileCountPending = Math.max(0, localAssistantWorkspace.files.size - localAssistantWorkspace.fileCountCompleted);
  localAssistantWorkspace.fileCountFailed = 0;
  localAssistantWorkspace.status = complete === true
    ? "background-complete"
    : (syncMode === "initial" ? "initial-ready" : "processing");
  localAssistantWorkspace.indexedAt = toIsoNow();
  debouncedPersistLocalWorkspaceState();

  if (syncMode !== "single-file") {
    enqueueLocalWorkspaceEnrichment({
      workspaceId: normalizedWorkspaceId,
      folderName: normalizedFolderName,
    });
  }
  perf.flush({
    discovered: normalizedFiles.length,
    deleted: removedPaths.length,
    total: localAssistantWorkspace.files.size,
  });

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
  };
}








// --- EXPORTS ---
module.exports = {
  secureDb,
  brotliCompress,
  brotliDecompress,
  MESH_CORE_URL,
  LOCAL_WORKSPACE_CACHE_FILE,
  OPERATIONS_STORE_FILE,
  AUTH_STORE_FILE,
  AUTH_SESSION_TTL_MS,
  AUTH_SESSION_TOUCH_INTERVAL_MS,
  AUTH_COOKIE_NAME,
  AUTH_COOKIE_PATH,
  AUTH_COOKIE_SAME_SITE,
  AUTH_COOKIE_SECURE,
  DEMO_USER_EMAIL,
  DEMO_USER_EMAIL_ALIASES,
  DEMO_USER_PASSWORD,
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
  USER_STORE_ALLOWED_KEYS,
  USER_STORE_MAX_JSON_BYTES,
  localAssistantWorkspace,
  workspaceMetadataStore,
  operationsStore,
  MAX_OPERATION_LOGS,
  assistantRuns,
  assistantTerminalSessions,
  workspaceSelectJobs,
  workspaceSelectJobOrder,
  workspaceSelectChains,
  lastAuthStoreErrorLogAt,
  execFileAsync,
  clampBrotliQuality,
  parseBooleanFlag,
  parseIntegerInRange,
  trimTrailingSlashes,
  normalizeSasToken,
  sanitizeBlobContainerName,
  safeReadJsonFile,
  safeWriteJsonFile,
  normalizeWorkspaceSourceKind,
  toIsoNow,
  toSafeSlug,
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
  normalizeEmail,
  hashPassword,
  verifyPassword,
  sanitizeAuthUser,
  reportAuthStoreError,
  buildDemoUserSeed,
  ensureDemoUserRecord,
  loadAuthStore,
  issueAuthSession,
  parseCookiesFromHeader,
  decodeCookieValue,
  readAuthCookieToken,
  normalizeSameSiteValue,
  createCookieHeader,
  setAuthCookie,
  clearAuthCookie,
  readAuthTokenFromRequest,
  resolveAuthUserFromRequest,
  requireAuth,
  pruneExpiredSessions,
  normalizeUserStoreKey,
  normalizeRequestedStoreKeys,
  normalizeStoredByokProviders,
  getStoredCredentialsForUser,
  mergeChatCredentials,
  serializeLocalWorkspaceState,
  persistLocalWorkspaceState,
  restoreLocalWorkspaceState,
  workspaceRecordIndexed,
  ensureLocalWorkspaceMeta,
  loadLocalWorkspaceRecordText,
  buildWorkspaceFileListingEntry,
  meshTunnelRequest,
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
  localWorkspaceSummary,
  clearLocalWorkspaceState,
  isLocalPathWorkspaceState,
  isUploadWorkspaceState,
  syncLocalUploadWorkspaceSummary,
  toWorkspacePath,
  toWorkspaceRelativePath,
  syncWorkspaceFiles,
  canonicalWorkspaceId,
  clearLocalWorkspaceFiles,
  normalizeAbsoluteRootPath,
  resolveLocalWorkspaceAbsolutePath,
  gitPathFromWorkspacePath,
  workspacePathFromGitPath,
  readLocalWorkspaceFileText,
  scanLocalWorkspaceFiles,
  packLocalWorkspaceContent,
  localWorkspaceUploadBlobStorageForPath,
  packLocalBlobBackedWorkspaceRecord,
  writeLocalWorkspaceFileToDisk,
  normalizeGitError,
  getLocalGitCwd,
  runLocalGit,
  isMeshWorkerUnavailableError,
  countPendingWorkspaceSelectJobs,
  pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload,
  workspaceSelectScopeKey,
  computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob,
  buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback,
  enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload,
  getWorkspaceSelectJobForUser,
  sortedLocalPaths,
  buildAzureBlobAbsoluteUrl,
  buildAzureBlobCanonicalUrl,
  normalizeWorkspaceBlobStorage,
  buildWorkspaceBlobReadUrl,
  createWorkspaceOffloadConfig,
  workspaceOffloadConfig,
  workspaceOffloadClientConfig,
  STATIC_MODELS,
  ALL_STATIC_MODELS,
  MESH_DEFAULT_MODEL,
  DEFAULT_BYOK_BASE_URLS,
  DEFAULT_AZURE_API_VERSION,
  MESH_MODEL_CODEC_VERSION,
  MESH_MODEL_CODEC_CONTEXT_MARKER,
  MESH_MODEL_CODEC_RESPONSE_OPEN,
  MESH_MODEL_CODEC_RESPONSE_CLOSE,
  MESH_MODEL_CODEC_PAYLOAD_PREFIX,
  MESH_MODEL_CODEC_PAYLOAD_SUFFIX,
  MESH_MODEL_CODEC_TERMS,
  MESH_MODEL_CODEC_ESCAPE_PREFIX,
  MESH_MODEL_CODEC_ESCAPE_REPLACEMENT,
  MESH_MODEL_CODEC_NEWLINE_TOKEN,
  MESH_MODEL_CODEC_TAB_TOKEN,
  MESH_MODEL_CODEC_TABLE,
  MESH_MODEL_CODEC_ENCODE_TABLE,
  MESH_MODEL_CODEC_DECODE_TABLE,
  meshCodecSessionState,
  injectMeshSystemPrompt,
  stripModelPrefix,
  readMessageText,
  normalizeMessages,
  toOpenAiMessages,
  toAnthropicMessages,
  toGeminiContents,
  trimTrailingSlash,
  joinPath,
  isAzureProvider,
  normalizeAzureBaseUrl,
  modelDisplayLabel,
  parseProviderError,
  normalizeProviderUsage,
  readJsonResponse,
  buildOpenAIChatCompletionBody,
  providerWantsMaxCompletionTokens,
  textFromMaybeContent,
  extractAssistantTextFromChatPayload,
  callOpenAIResponsesEndpoint,
  callOpenAICompatibleChat,
  callAzureOpenAIChat,
  callByokProviderChat,
  callAnthropicChatWithMeta,
  callAnthropicChat,
  callGeminiChat,
  BEDROCK_MODEL_MAP,
  resolveBedrockModelId,
  createBedrockClient,
  callBedrockDirect,
  normalizeByokProviders,
  resolveProviderForModel,
  runModelChat,
  fetchAnthropicModels,
  fetchOpenAICompatibleModels,
  fetchGeminiModels,
  dedupeModelIds,
  staticModelMatch,
  normalizeImportedModels,
  normalizeRequestedModelIds,
  validateProviderKey,
  compressLocalWorkspaceText,
  decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile,
  readWorkspaceBlobText,
  writeWorkspaceBlobText,
  copyWorkspaceBlob,
  deleteWorkspaceBlob,
  compressLocalWorkspaceChunkFiles,
  extractActiveFilePathFromMessages,
  replaceLiteralAll,
  escapeRegexLiteral,
  rot47Transform,
  textCompositionStats,
  containsCodecSignals,
  isLikelyUnframedRot47,
  decodedReadabilityScore,
  pickMostReadableDecoded,
  decodeCodecTokens,
  codecTokenShouldReplace,
  encodeMeshModelCodec,
  decodeMeshModelCodec,
  buildMeshCodecContextDocument,
  hasCodecContextMarker,
  normalizeChatSessionId,
  pruneCodecSessionStateIfNeeded,
  markCodecContextInitialized,
  isCodecContextInitializedForSession,
  injectCodecContextIntoMessages,
  extractCompressedModelPayload,
  decodeCompressedModelResponse,
  escapeTagAttribute,
  dedupePaths,
  openWorkspaceFileWithFallback,
  recoverWorkspaceWithFallback,
  searchWorkspaceWithFallback,
  grepWorkspaceWithFallback,
  renameWorkspaceFileWithFallback,
  deleteWorkspaceFileWithFallback,
  applyWorkspaceBatchWithFallback,
  openLocalWorkspaceWithFallback,
  runGitWithFallback,
  sanitizeTerminalChunk,
  makeAssistantTerminalEntry,
  getAssistantTerminalSession,
  createAssistantTerminalSession,
  listAssistantTerminalOutput,
  writeAssistantTerminalInput,
  destroyAssistantTerminalSession,
  createCompressedContextExcerpt,
  normalizeContextExcerptText,
  normalizeExcerptFocusTerms,
  collectFocusedCharRanges,
  mergeCharRanges,
  buildExcerptFromCharRanges,
  loadCompressedContextEntries,
  loadPlainContextEntries,
  buildPlainContextBlock,
  buildCompressedContextBlock,
  shouldPrefetchRecoveryForPrompt,
  loadCapsuleContextEntries,
  loadRecoveredSpanEntries,
  buildCapsuleContextBlock,
  injectCompressedContextIntoMessages,
  buildModelResponseTransport,
  buildServerCodecRecovery,
  polishDecompressedAssistantText,
  looksLikeCodecProtocolRefusal,
  enqueueLocalWorkspaceEnrichment,
  drainLocalWorkspaceEnrichmentQueue,
  enrichLocalWorkspaceRecords,
  localWorkspaceSelect,
  localWorkspaceOpenLocal,
  localWorkspaceFiles,
  localWorkspaceGraph,
  localWorkspaceFile,
  localWorkspaceSave,
  localWorkspaceCreate,
  buildWorkspaceQueryContext,
  localWorkspaceSearch,
  findMatchesInText,
  localWorkspaceGrep,
  localWorkspaceRename,
  localWorkspaceDelete,
  localWorkspaceBatch,
  localGitStatus,
  ingestWorkspaceChunkFromOffload,
  localResolveReferencedFiles,
  QUERY_EXTENSION_HINTS,
  SINGLE_FILE_LOOKUP_RE,
  MULTI_FILE_LOOKUP_RE,
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  BROAD_CHANGE_INTENT_RE,
  resolveAdaptiveCompressedContextBudget,
  FILE_QUERY_STOP_WORDS,
  extractSearchTokens,
  compactAlphaNumeric,
  scorePathForQuery,
  rankWorkspacePathsForQuery,
  inferReferencedFilesFromWorkspace,
  localAssistantReply,
  normalizeDeploymentRisk,
  normalizePolicyMode,
  normalizePolicyStatus,
  normalizePolicyRegion,
  parsePolicyScopeFromPayload,
  stringifyPolicyScope,
  uniqueDeploymentId,
  queueDeployment,
  settleDeploymentAction,
  uniquePolicyId,
  createPolicy,
  updatePolicy,
  cloneJsonValue,
  normalizeRunActionState,
  touchRunEntity,
  createAssistantRunRecord,
  assistantRunSnapshot,
  extractExplicitPathReferences,
  ensureRunWorkspacePath,
  extractExplicitCommandFromPrompt,
  hasEditIntent,
  hasSearchIntent,
  hasReadIntent,
  hasOpsIntent,
  buildOpsContextSnippet,
  resolveAssistantCandidatePaths,
  buildHeuristicAssistantRunPlan,
  planAssistantRunWithModel,
  planAssistantRun,
  normalizeDiffText,
  computeProposalLineDelta,
  buildProposalDiff,
  extractFirstFencedCodeBlock,
  extractDirectProposalContent,
  buildFallbackTemplateForTarget,
  extractProposalTargetPaths,
  generateAssistantWriteProposal,
  generateAssistantWriteBatch,
  resolveRunBatch,
  resolveRunProposal,
  syncBatchStatusFromProposals,
  ensureApplyBatchActionForRun,
  ensureApplyProposalActionsForBatch,
  buildActionResultSummary,
  buildFallbackAssistantRunReply,
  summarizeAssistantRun,
  executeAssistantRunAction,
  continueAssistantRun,
  createAssistantRun,
  applyAssistantRunDecision
};

Object.assign(global, module.exports, {
  isWorkspaceIndexablePath, WORKSPACE_RECORD_VERSION,
  mapWithConcurrency, createWorkspacePerfTracker,
  buildWorkspaceFileRecord, ensureWorkspaceFileRecord,
  decodeRawStorage, buildWorkspaceFileView,
});
