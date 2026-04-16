'use strict';

/**
 * Workspace search, grep, and file reference resolution.
 * Stateful functions use globals injected by core/index.js at boot.
 */

const { LRUCache } = require('lru-cache');
const config = require('../../config');
const { decodeRawStorage } = require('../../../mesh-core/src/compression-core.cjs');
const {
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  rankWorkspacePathsForQuery,
  buildWorkspaceQueryContext,
  findMatchesInText,
} = require('./utils');
const { localWorkspaceFiles } = require('./files');

/**
 * @param {string} queryInput
 * @param {{ limit?: number, workspaceId?: string }} [options]
 * @returns {Promise<object>}
 */
async function localWorkspaceSearch(queryInput, options = {}) {
  const q = String(queryInput || '').trim();
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 50);
  const extensionHints = extractQueryExtensionHints(q);
  const queryContext = buildWorkspaceQueryContext(q);

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || '').trim();
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    let matches = docs
      .map((meta) => ({
        path: meta.path,
        name: basename(meta.path),
        score: q ? sharedScorePathForQuery(meta.path, queryContext) : 1,
        indexed: workspaceRecordIndexed(meta),
        originalSize: Number(meta?.originalSize || 0),
        compressedSize: Number(meta?.compressedSize || 0),
        kind: meta?.kind || (workspaceRecordIndexed(meta) ? 'source' : 'pending'),
        fileType: String(meta?.fileType || ''),
        parseOk: Boolean(meta?.parseOk),
        parserFamily: String(meta?.parserFamily || ''),
        capsuleMode: String(meta?.capsuleMode || ''),
        status: String(meta?.status || ''),
      }))
      .filter((entry) => !q || entry.score > 0);

    if (extensionHints.size > 0) {
      const filtered = matches.filter((entry) => sharedPathHasExtensionHint(entry.path, extensionHints));
      if (filtered.length > 0) matches = filtered;
    }

    matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
    return { ok: true, mode: 'local-fallback', query: q, limit, matches: matches.slice(0, limit), total: matches.length };
  }

  let matches = sortedLocalPaths()
    .map((p) => {
      const meta = localAssistantWorkspace.files.get(p);
      return {
        path: p,
        name: basename(p),
        score: q ? sharedScorePathForQuery(p, queryContext) : 1,
        indexed: workspaceRecordIndexed(meta),
        originalSize: Number(meta?.originalSize || 0),
        compressedSize: Number(meta?.compressedSize || 0),
        kind: meta?.kind || (workspaceRecordIndexed(meta) ? 'source' : 'pending'),
        fileType: String(meta?.fileType || ''),
        parseOk: Boolean(meta?.parseOk),
        parserFamily: String(meta?.parserFamily || ''),
        capsuleMode: String(meta?.capsuleMode || ''),
      };
    })
    .filter((entry) => !q || entry.score > 0);

  if (extensionHints.size > 0) {
    const filtered = matches.filter((entry) => sharedPathHasExtensionHint(entry.path, extensionHints));
    if (filtered.length > 0) matches = filtered;
  }

  matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));
  return { ok: true, mode: 'local-fallback', query: q, limit, matches: matches.slice(0, limit), total: matches.length };
}

/**
 * @param {string} queryInput
 * @param {{ limit?: number, workspaceId?: string, caseSensitive?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function localWorkspaceGrep(queryInput, options = {}) {
  const q = String(queryInput || '').trim();
  if (!q) return { ok: false, error: 'Search query is required.' };

  const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 200);
  const extensionHints = extractQueryExtensionHints(q);
  let scanned = 0;
  const matches = [];

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || '').trim();
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);

    for (const meta of docs) {
      const filePath = toSafePath(meta?.path || '');
      if (!filePath || !workspaceRecordIndexed(meta)) continue;
      if (extensionHints.size > 0 && !sharedPathHasExtensionHint(filePath, extensionHints)) continue;

      const decoded = await loadLocalWorkspaceRecordText(meta, filePath);
      const fileHits = findMatchesInText(decoded, q, options);
      scanned += 1;

      for (const hit of fileHits) {
        matches.push({ path: filePath, ...hit });
        if (matches.length >= limit) {
          return { ok: true, mode: 'local-fallback', query: q, limit, scannedFiles: scanned, matches, truncated: true };
        }
      }
    }

    return { ok: true, mode: 'local-fallback', query: q, limit, scannedFiles: scanned, matches, truncated: false };
  }

  for (const filePath of sortedLocalPaths()) {
    const meta = localAssistantWorkspace.files.get(filePath);
    if (!workspaceRecordIndexed(meta)) continue;
    if (extensionHints.size > 0 && !sharedPathHasExtensionHint(filePath, extensionHints)) continue;

    const ensured = await ensureLocalWorkspaceMeta(meta, filePath);
    const decoded = decodeRawStorage(ensured.rawStorage);
    const fileHits = findMatchesInText(decoded, q, options);
    scanned += 1;

    for (const hit of fileHits) {
      matches.push({ path: filePath, ...hit });
      if (matches.length >= limit) {
        return { ok: true, mode: 'local-fallback', query: q, limit, scannedFiles: scanned, matches, truncated: true };
      }
    }
  }

  return { ok: true, mode: 'local-fallback', query: q, limit, scannedFiles: scanned, matches, truncated: false };
}

/**
 * @param {string} lastUserMessage
 * @returns {Promise<string[]>}
 */
async function localResolveReferencedFiles(lastUserMessage) {
  const hasUploadWorkspace = workspaceMetadataStore.enabled && isUploadWorkspaceState();
  if (!hasUploadWorkspace && localAssistantWorkspace.files.size === 0) return [];

  const queryText = String(lastUserMessage || '');
  const extensionHints = extractQueryExtensionHints(queryText);

  let candidatePaths = [];
  if (hasUploadWorkspace) {
    const docs = await workspaceMetadataStore.listWorkspaceFiles(localAssistantWorkspace.workspaceId);
    candidatePaths = docs
      .filter((meta) => workspaceRecordIndexed(meta))
      .map((meta) => toSafePath(meta?.path || ''))
      .filter(Boolean);
  } else {
    candidatePaths = sortedLocalPaths().filter((p) => {
      const meta = localAssistantWorkspace.files.get(p);
      return workspaceRecordIndexed(meta);
    });
  }

  if (extensionHints.size > 0) {
    const filtered = candidatePaths.filter((p) => pathHasExtensionHint(p, extensionHints));
    if (filtered.length > 0) candidatePaths = filtered;
  }

  const maxMatches = selectReferenceMatchLimit(queryText, extensionHints);
  return rankWorkspacePathsForQuery(queryText, candidatePaths, maxMatches);
}

const INFER_FILES_CACHE_TTL_MS = 30_000;
const inferFilesCache = new LRUCache({
  max: config.INFER_FILES_CACHE_MAX,
  ttl: INFER_FILES_CACHE_TTL_MS,
});

/**
 * @param {string} lastUserMessage
 * @param {string|null} [requestId]
 * @returns {Promise<string[]>}
 */
async function inferReferencedFilesFromWorkspace(lastUserMessage, requestId = null) {
  const text = String(lastUserMessage || '').trim();
  if (!text) return [];

  const cached = inferFilesCache.get(text);
  if (cached && Date.now() - cached.ts < INFER_FILES_CACHE_TTL_MS) return cached.result;

  const extensionHints = extractQueryExtensionHints(text);
  const maxMatches = selectReferenceMatchLimit(text, extensionHints);

  let files = [];
  try {
    const result = await meshTunnelRequest('workspace.files', {}, requestId);
    files = Array.isArray(result?.files) ? result.files : [];
  } catch {
    const local = await localWorkspaceFiles();
    files = Array.isArray(local?.files) ? local.files : [];
  }

  let indexedPaths = files
    .filter((entry) => entry?.indexed !== false)
    .map((entry) => toSafePath(entry?.path || entry?.name || ''))
    .filter(Boolean);

  if (extensionHints.size > 0) {
    const filtered = indexedPaths.filter((p) => pathHasExtensionHint(p, extensionHints));
    if (filtered.length > 0) indexedPaths = filtered;
  }

  const result = rankWorkspacePathsForQuery(text, indexedPaths, maxMatches);
  inferFilesCache.set(text, { result, ts: Date.now() });
  return result;
}

module.exports = {
  localWorkspaceSearch,
  localWorkspaceGrep,
  localResolveReferencedFiles,
  inferReferencedFilesFromWorkspace,
};
