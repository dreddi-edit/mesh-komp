'use strict';

/**
 * Workspace file access helpers and tunnel fallback operations.
 * Explicit imports for compression-core and infrastructure utilities;
 * all other runtime state is injected as globals by core/index.js.
 */

const { mapWithConcurrency, isWorkspaceIndexablePath } = require('../workspace-infrastructure');
const {
  buildWorkspaceFileRecord,
  ensureWorkspaceFileRecord,
} = require('../../../mesh-core/src/compression-core.cjs');

/**
 * @param {object[]} incomingFiles
 * @param {object} [options]
 * @returns {Promise<object[]>}
 */
async function compressLocalWorkspaceChunkFiles(incomingFiles, options = {}) {
  const recordMode = String(options.recordMode || 'initial').trim().toLowerCase() === 'full' ? 'full' : 'initial';
  const normalized = [];
  for (const file of incomingFiles) {
    const filePath = toSafePath(file?.path || file?.name);
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;
    const preindexed = normalizeIncomingWorkspacePreindexedFile(file, filePath);
    normalized.push({
      filePath,
      content: typeof file?.content === 'string' ? file.content : '',
      originalSize: Number(file?.sizeBytes ?? file?.size ?? preindexed?.originalSize ?? 0),
      preindexed,
    });
  }

  const workspaceFilePaths = Array.from(new Set([
    ...Array.from(localAssistantWorkspace.files.keys()),
    ...normalized.map((entry) => entry.filePath),
  ]));

  return mapWithConcurrency(normalized, MESH_WORKSPACE_BUILD_CONCURRENCY, async (entry) => ({
    filePath: entry.filePath,
    packed: (entry.preindexed?.rawStorage || entry.preindexed?.transportEnvelope || entry.preindexed?.capsuleCache || entry.preindexed?.compressedBase64)
      ? await ensureWorkspaceFileRecord({
        ...entry.preindexed,
        path: entry.filePath,
      }, {
        path: entry.filePath,
        legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      })
      : entry.preindexed?.storage
        ? await (async () => {
          const indexed = await readWorkspaceBlobText(entry.preindexed.storage, entry.originalSize);
          return buildWorkspaceFileRecord(entry.filePath, indexed.content, {
            legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
            initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
            originalSizeOverride: indexed.byteLength || entry.originalSize,
            storage: entry.preindexed.storage,
            persistRawContent: false,
            persistTransportChunks: false,
            workspaceFilePaths,
            recordMode,
          });
        })()
        : await buildWorkspaceFileRecord(entry.filePath, entry.content, {
          legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
          initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
          workspaceFilePaths,
          recordMode,
        }),
  }));
}

/**
 * @param {string} pathInput
 * @param {string} [viewMode]
 * @param {object} [viewOptions]
 * @returns {Promise<object>}
 */
async function openWorkspaceFileWithFallback(pathInput, viewMode = 'original', viewOptions = {}) {
  const requested = toSafePath(pathInput);
  if (!requested) throw new Error('Invalid file path');

  try {
    const normalizedView = String(viewMode || 'original').toLowerCase();
    const action = normalizedView === 'capsule'
      ? 'workspace.capsule.open'
      : normalizedView === 'transport'
        ? 'workspace.transport.open'
        : 'workspace.file.open';
    const workspaceId = String(viewOptions.workspaceId || localAssistantWorkspace.workspaceId || '').trim();
    const sessionId = String(viewOptions.sessionId || localAssistantWorkspace.sessionId || '').trim();
    const result = await meshTunnelRequest(action, {
      path: requested,
      view: viewMode,
      workspaceId,
      sessionId,
      tier: String(viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || '').trim(),
      query: String(viewOptions.query || viewOptions.focus || '').trim(),
      focus: String(viewOptions.focus || viewOptions.query || '').trim(),
    }, viewOptions.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace file open failed');
    return result;
  } catch {
    const local = await localWorkspaceFile(requested, viewMode, viewOptions);
    if (!local?.ok) throw new Error(local?.error || 'Workspace file open failed');
    return local;
  }
}

/**
 * @param {string} pathInput
 * @param {object} [request]
 * @returns {Promise<object>}
 */
async function recoverWorkspaceWithFallback(pathInput, request = {}) {
  const requested = toSafePath(pathInput);
  if (!requested) throw new Error('Invalid file path');

  const payload = {
    path: requested,
    workspaceId: String(request.workspaceId || localAssistantWorkspace.workspaceId || '').trim(),
    sessionId: String(request.sessionId || localAssistantWorkspace.sessionId || '').trim(),
    query: String(request.query || '').trim(),
    spanIds: Array.isArray(request.spanIds) ? request.spanIds : [],
    ranges: Array.isArray(request.ranges) ? request.ranges : [],
  };

  try {
    const result = await meshTunnelRequest('workspace.recovery.fetch', payload, request.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace recovery failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const meta = localAssistantWorkspace.files.get(requested);
      if (!meta) throw error;
      const ensured = await ensureLocalWorkspaceMeta(meta, requested);
      const suggested = payload.spanIds.length
        ? payload.spanIds
        : (payload.query ? suggestRecoverySpanIds(ensured, payload.query, 4) : []);
      const local = await recoverWorkspaceFileRecord(ensured, { spanIds: suggested, ranges: payload.ranges }, {
        path: requested,
        legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      });
      return { ...local, mode: 'local-fallback', suggestedSpanIds: suggested };
    }
    const meta = localAssistantWorkspace.files.get(requested);
    if (!meta) throw error;
    const ensured = await ensureLocalWorkspaceMeta(meta, requested);
    const suggested = payload.spanIds.length
      ? payload.spanIds
      : (payload.query ? suggestRecoverySpanIds(ensured, payload.query, 4) : []);
    const local = await recoverWorkspaceFileRecord(ensured, { spanIds: suggested, ranges: payload.ranges }, {
      path: requested,
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    });
    return { ...local, mode: 'local-fallback', suggestedSpanIds: suggested };
  }
}

/**
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function searchWorkspaceWithFallback(query, options = {}) {
  const payload = {
    q: String(query || ''),
    scope: String(options.scope || 'all'),
    limit: Number(options.limit) || 12,
  };

  try {
    const result = await meshTunnelRequest('workspace.search', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace search failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceSearch(payload.q, payload);
      if (!local?.ok) throw new Error(local?.error || 'Workspace search failed');
      return local;
    }
    const local = await localWorkspaceSearch(payload.q, payload);
    if (!local?.ok) throw new Error(local?.error || 'Workspace search failed');
    return local;
  }
}

/**
 * @param {string} query
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function grepWorkspaceWithFallback(query, options = {}) {
  const payload = {
    q: String(query || ''),
    scope: String(options.scope || 'all'),
    limit: Number(options.limit) || 40,
    caseSensitive: options.caseSensitive === true,
  };

  try {
    const result = await meshTunnelRequest('workspace.grep', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace grep failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceGrep(payload.q, payload);
      if (!local?.ok) throw new Error(local?.error || 'Workspace grep failed');
      return local;
    }
    const local = await localWorkspaceGrep(payload.q, payload);
    if (!local?.ok) throw new Error(local?.error || 'Workspace grep failed');
    return local;
  }
}

/**
 * @param {string} fromPath
 * @param {string} toPath
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function renameWorkspaceFileWithFallback(fromPath, toPath, options = {}) {
  const payload = {
    fromPath,
    toPath,
    overwrite: Boolean(options.overwrite),
    workspaceId: String(options.workspaceId || '').trim(),
    sessionId: String(options.sessionId || '').trim(),
  };

  try {
    const result = await meshTunnelRequest('workspace.file.rename', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace rename failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceRename(fromPath, toPath, options);
      if (!local?.ok) throw new Error(local?.error || 'Workspace rename failed');
      return local;
    }
    const local = await localWorkspaceRename(fromPath, toPath, options);
    if (!local?.ok) throw new Error(local?.error || 'Workspace rename failed');
    return local;
  }
}

/**
 * @param {string} pathInput
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function deleteWorkspaceFileWithFallback(pathInput, options = {}) {
  const payload = {
    path: pathInput,
    workspaceId: String(options.workspaceId || '').trim(),
    sessionId: String(options.sessionId || '').trim(),
  };

  try {
    const result = await meshTunnelRequest('workspace.file.delete', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace delete failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceDelete(pathInput);
      if (!local?.ok) throw new Error(local?.error || 'Workspace delete failed');
      return local;
    }
    const local = await localWorkspaceDelete(pathInput);
    if (!local?.ok) throw new Error(local?.error || 'Workspace delete failed');
    return local;
  }
}

/**
 * @param {object[]} operations
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function applyWorkspaceBatchWithFallback(operations, options = {}) {
  const payload = {
    operations: Array.isArray(operations) ? operations : [],
    stopOnError: options.stopOnError !== false,
  };

  try {
    const result = await meshTunnelRequest('workspace.batch', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Workspace batch failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceBatch(payload.operations, payload);
      if (!local?.ok) throw new Error(local?.error || 'Workspace batch failed');
      return local;
    }
    const local = await localWorkspaceBatch(payload.operations, payload);
    if (!local?.ok) throw new Error(local?.error || 'Workspace batch failed');
    return local;
  }
}

/**
 * @param {string} rootPath
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function openLocalWorkspaceWithFallback(rootPath, options = {}) {
  const payload = {
    rootPath: String(rootPath || '').trim(),
    folderName: String(options.folderName || '').trim(),
  };

  try {
    const result = await meshTunnelRequest('workspace.open-local', payload, options.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Open local workspace failed');
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) throw error;
    const local = await localWorkspaceOpenLocal(payload.rootPath, { folderName: payload.folderName });
    if (!local?.ok) throw new Error(local?.error || 'Open local workspace failed');
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || 'offline'}`,
    };
  }
}

/**
 * @param {string} action
 * @param {object} data
 * @param {Function} fallback
 * @returns {Promise<object>}
 */
async function runGitWithFallback(action, data, fallback) {
  try {
    const result = await meshTunnelRequest(action, data || {}, data?.requestId);
    if (!result?.ok) throw new Error(result?.error || 'Git request failed');
    return result;
  } catch (error) {
    const canUseLocalState = isLocalPathWorkspaceState()
      && String(error?.message || '').toLowerCase().includes('no local workspace root configured');
    if (!isMeshWorkerUnavailableError(error) && !canUseLocalState) throw error;
    const local = await fallback();
    if (!local?.ok) throw new Error(local?.error || 'Git request failed');
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || 'offline'}`,
    };
  }
}

/**
 * @returns {(path: string, viewMode: string, options: object) => Promise<object>}
 */
function createFileOpenCache() {
  const inflight = new Map();
  return function cachedOpen(filePath, viewMode, options) {
    const key = `${filePath}::${viewMode}::${options.query || ''}`;
    if (!inflight.has(key)) {
      inflight.set(key, openWorkspaceFileWithFallback(filePath, viewMode, options));
    }
    return inflight.get(key);
  };
}

module.exports = {
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
  createFileOpenCache,
};
