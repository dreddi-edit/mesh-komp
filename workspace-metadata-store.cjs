'use strict';

const DEFAULT_WORKSPACE_STATUS = 'processing';
const DEFAULT_FILE_STATUS = 'pending';

function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\.\.(\/|$)/g, '')
    .trim();
}

function normalizeWorkspaceId(value, fallback = '') {
  return String(value || fallback || '').trim();
}

function fileDocumentId(workspaceId, pathValue) {
  return `${normalizeWorkspaceId(workspaceId)}:${normalizePath(pathValue)}`;
}

function workspaceDocumentId(workspaceId) {
  return normalizeWorkspaceId(workspaceId);
}

function createWorkspaceMetadataStore() {
  return {
    enabled: false,
    databaseId: '',
    filesContainerId: '',
    workspacesContainerId: '',
    fileDocumentId,
    workspaceDocumentId,
    normalizePath,
    normalizeWorkspaceId,
    init: async () => { throw new Error('Workspace metadata store is not configured.'); },
    getWorkspaceSummary: async () => null,
    getWorkspaceFile: async () => null,
    listWorkspaceFiles: async () => [],
    upsertWorkspaceSummary: async () => null,
    recomputeWorkspaceSummary: async () => null,
    seedWorkspaceManifest: async () => null,
    upsertWorkspaceFileRecord: async () => null,
    markWorkspaceFileFailed: async () => null,
    deleteWorkspaceFileRecord: async () => false,
    purgeWorkspace: async () => false,
    reconcileWorkspace: async () => false,
    listWorkspaceProgress: async () => null,
  };
}

module.exports = {
  DEFAULT_FILE_STATUS,
  DEFAULT_WORKSPACE_STATUS,
  createWorkspaceMetadataStore,
  fileDocumentId,
  workspaceDocumentId,
  normalizePath,
  normalizeWorkspaceId,
};
