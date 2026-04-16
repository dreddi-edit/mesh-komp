'use strict';

/**
 * Workspace service — coordinates workspace core operations.
 * Routes call this service rather than core directly.
 */

/**
 * @typedef {object} WorkspaceServiceDeps
 * @property {object} core  Full core exports (workspace ops, infrastructure, context)
 * @property {object} config  Application config
 * @property {object} logger  Logger instance
 */

/**
 * @typedef {object} WorkspaceService
 * @property {Function} getStatus
 * @property {Function} selectWorkspace
 * @property {Function} readFile
 * @property {Function} writeFile
 * @property {Function} searchFiles
 * @property {Function} batchOps
 * @property {Function} reindex
 * @property {Function} syncFiles
 * @property {Function} getFiles
 * @property {Function} getGraph
 */

/**
 * Creates a workspace service instance with injected dependencies.
 *
 * @param {WorkspaceServiceDeps} deps
 * @returns {WorkspaceService}
 */
function createWorkspaceService({ core, config, logger }) {
  /**
   * Returns current workspace status for the authenticated user.
   *
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function getStatus(requestId) {
    const {
      meshTunnelRequest,
      localAssistantWorkspace,
      normalizeWorkspaceSourceKind,
    } = core;
    try {
      return await meshTunnelRequest('status', {}, requestId);
    } catch (error) {
      return {
        ok: true,
        mode: 'local-fallback',
        workspaceSelected: Boolean(localAssistantWorkspace.folderName || localAssistantWorkspace.workspaceId),
        workspaceFileCount: Number(localAssistantWorkspace.fileCountTotal || localAssistantWorkspace.files.size || 0),
        rootPath: localAssistantWorkspace.rootPath || '',
        workspaceId: localAssistantWorkspace.workspaceId || '',
        sessionId: localAssistantWorkspace.sessionId || '',
        sourceKind: normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind),
        workspaceStatus: String(localAssistantWorkspace.status || ''),
        fileCountCompleted: Number(localAssistantWorkspace.fileCountCompleted || 0),
        fileCountPending: Number(localAssistantWorkspace.fileCountPending || 0),
        fileCountFailed: Number(localAssistantWorkspace.fileCountFailed || 0),
        warning: `Mesh worker unavailable: ${error.message || 'offline'}`,
      };
    }
  }

  /**
   * Selects and provisions a workspace for the user.
   *
   * @param {object} payload
   * @param {string} userId
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function selectWorkspace(payload, userId, requestId) {
    const {
      shouldQueueWorkspaceSelectPayload,
      enqueueWorkspaceSelectJob,
      buildWorkspaceSelectAcceptedResponse,
      executeWorkspaceSelectWithFallback,
    } = core;
    if (shouldQueueWorkspaceSelectPayload(payload)) {
      const job = await enqueueWorkspaceSelectJob(payload, userId, requestId);
      return buildWorkspaceSelectAcceptedResponse(job);
    }
    return executeWorkspaceSelectWithFallback(payload, userId, requestId);
  }

  /**
   * Opens a workspace file, with fallback to local cache.
   *
   * @param {string} filePath
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function readFile(filePath, requestId) {
    return core.openWorkspaceFileWithFallback(filePath, requestId);
  }

  /**
   * Writes content to a workspace file.
   *
   * @param {string} filePath
   * @param {string} content
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function writeFile(filePath, content, requestId) {
    return core.localWorkspaceSave(filePath, content, requestId);
  }

  /**
   * Searches workspace files with query string.
   *
   * @param {string} query
   * @param {object} [options]
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function searchFiles(query, options = {}, requestId) {
    return core.searchWorkspaceWithFallback(query, options, requestId);
  }

  /**
   * Applies a batch of file operations atomically.
   *
   * @param {object[]} operations
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function batchOps(operations, requestId) {
    return core.applyWorkspaceBatchWithFallback(operations, requestId);
  }

  /**
   * Triggers workspace reindex.
   *
   * @param {string} workspaceId
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function reindex(workspaceId, requestId) {
    return core.provisionMeshWorkspaceMetadata({ workspaceId }, requestId);
  }

  /**
   * Syncs workspace files from client.
   *
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async function syncFiles(payload) {
    return core.syncWorkspaceFiles(payload);
  }

  /**
   * Returns the workspace file listing.
   *
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function getFiles(requestId) {
    return core.localWorkspaceFiles(requestId);
  }

  /**
   * Returns the workspace dependency graph.
   *
   * @param {string} requestId
   * @returns {Promise<object>}
   */
  async function getGraph(requestId) {
    return core.localWorkspaceGraph(requestId);
  }

  return {
    getStatus,
    selectWorkspace,
    readFile,
    writeFile,
    searchFiles,
    batchOps,
    reindex,
    syncFiles,
    getFiles,
    getGraph,
  };
}

module.exports = { createWorkspaceService };
