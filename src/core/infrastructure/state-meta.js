'use strict';

/**
 * Local workspace state accessors, path translators, and summary helpers.
 * All functions reference globals injected by core/index.js at boot.
 */

const path = require('path');
const { toSafePath, ensureWorkspaceOwnedPath } = require('./path-utils');

/** @returns {object} */
function localWorkspaceSummary() {
  return {
    folderName: localAssistantWorkspace.folderName,
    rootPath: localAssistantWorkspace.rootPath || '',
    workspaceId: localAssistantWorkspace.workspaceId || '',
    sessionId: localAssistantWorkspace.sessionId || '',
    sourceKind: normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind),
    fileCountTotal: Number(localAssistantWorkspace.fileCountTotal || localAssistantWorkspace.files.size || 0),
    fileCountCompleted: Number(localAssistantWorkspace.fileCountCompleted || 0),
    fileCountPending: Number(localAssistantWorkspace.fileCountPending || 0),
    fileCountFailed: Number(localAssistantWorkspace.fileCountFailed || 0),
    status: String(localAssistantWorkspace.status || ''),
    indexedAt: localAssistantWorkspace.indexedAt,
  };
}

/** @returns {void} */
function clearLocalWorkspaceState() {
  localAssistantWorkspace.folderName = null;
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.workspaceId = null;
  localAssistantWorkspace.sessionId = null;
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.files = new Map();
  localAssistantWorkspace.fileCountTotal = 0;
  localAssistantWorkspace.fileCountCompleted = 0;
  localAssistantWorkspace.fileCountPending = 0;
  localAssistantWorkspace.fileCountFailed = 0;
  localAssistantWorkspace.status = '';
  localAssistantWorkspace.indexedAt = null;
}

/** @returns {boolean} */
function isLocalPathWorkspaceState() {
  return normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_LOCAL_PATH
    && Boolean(localAssistantWorkspace.rootPath);
}

/** @returns {boolean} */
function isUploadWorkspaceState() {
  return normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_UPLOAD
    && Boolean(localAssistantWorkspace.workspaceId);
}

/**
 * @param {string} workspaceId
 * @param {object} [fallback]
 * @returns {Promise<object|null>}
 */
async function syncLocalUploadWorkspaceSummary(workspaceId, fallback = {}) {
  if (!workspaceMetadataStore.enabled || !workspaceId) return null;
  const summary = await workspaceMetadataStore.getWorkspaceSummary(workspaceId);
  if (!summary) return null;
  localAssistantWorkspace.folderName = String(summary.folderName || fallback.folderName || localAssistantWorkspace.folderName || 'workspace') || 'workspace';
  localAssistantWorkspace.rootPath = '';
  localAssistantWorkspace.workspaceId = String(summary.workspaceId || workspaceId);
  localAssistantWorkspace.sessionId = String(summary.sessionId || fallback.sessionId || localAssistantWorkspace.sessionId || '');
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.fileCountTotal = Number(summary.fileCountTotal || 0);
  localAssistantWorkspace.fileCountCompleted = Number(summary.fileCountCompleted || 0);
  localAssistantWorkspace.fileCountFailed = Number(summary.fileCountFailed || 0);
  localAssistantWorkspace.fileCountPending = Number(summary.fileCountPending || 0);
  localAssistantWorkspace.status = String(summary.status || '');
  localAssistantWorkspace.indexedAt = String(summary.indexedAt || summary.updatedAt || '') || null;
  localAssistantWorkspace.files = new Map();
  persistLocalWorkspaceState();
  return summary;
}

/**
 * @param {string} folderName
 * @param {string} [relativePath]
 * @returns {string}
 */
function toWorkspacePath(folderName, relativePath = '') {
  const root = toSafePath(folderName);
  const relative = toSafePath(relativePath);
  if (!root) return relative;
  return relative ? `${root}/${relative}` : root;
}

/**
 * @param {string} pathInput
 * @param {string} [folderName]
 * @returns {string}
 */
function toWorkspaceRelativePath(pathInput, folderName = localAssistantWorkspace.folderName) {
  const requested = toSafePath(pathInput);
  if (!requested) return '';
  const root = toSafePath(folderName);
  if (!root) return requested;
  if (requested === root) return '';
  if (requested.startsWith(`${root}/`)) return requested.slice(root.length + 1);
  return requested;
}

/**
 * @param {string} rootPath
 * @returns {string}
 */
function normalizeAbsoluteRootPath(rootPath) {
  const input = String(rootPath || '').trim();
  if (!input) return '';
  return path.resolve(input);
}

/**
 * @param {string} pathInput
 * @returns {{ requested: string, relativePath: string, absolutePath: string }}
 */
function resolveLocalWorkspaceAbsolutePath(pathInput) {
  if (!isLocalPathWorkspaceState()) {
    throw new Error('No local workspace root configured.');
  }

  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith('/')) {
    throw new Error('Invalid file path');
  }

  const relativePath = toWorkspaceRelativePath(requested, localAssistantWorkspace.folderName);
  if (!relativePath) {
    throw new Error('Invalid file path');
  }

  const absolutePath = path.resolve(localAssistantWorkspace.rootPath, relativePath);
  if (absolutePath !== localAssistantWorkspace.rootPath && !absolutePath.startsWith(`${localAssistantWorkspace.rootPath}${path.sep}`)) {
    throw new Error('Path escapes workspace root.');
  }

  return { requested, relativePath, absolutePath };
}

/** @param {string} pathInput @returns {string} */
function gitPathFromWorkspacePath(pathInput) {
  return toSafePath(toWorkspaceRelativePath(pathInput, localAssistantWorkspace.folderName));
}

/** @param {string} pathInput @returns {string} */
function workspacePathFromGitPath(pathInput) {
  return toWorkspacePath(localAssistantWorkspace.folderName || '', pathInput);
}

/** @returns {string[]} */
function sortedLocalPaths() {
  return [...localAssistantWorkspace.files.keys()].sort((a, b) => a.localeCompare(b));
}

module.exports = {
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
  sortedLocalPaths,
};
