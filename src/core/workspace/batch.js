'use strict';

/**
 * Workspace batch mutations, S3 offload ingestion, and local assistant reply routing.
 * Stateful functions use globals injected by core/index.js at boot.
 */

const fs = require('fs');
const path = require('path');
const { localWorkspaceSave, localWorkspaceCreate } = require('./files');
const { localResolveReferencedFiles } = require('./search');

/**
 * @param {string} fromPathInput
 * @param {string} toPathInput
 * @param {{ overwrite?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function localWorkspaceRename(fromPathInput, toPathInput, options = {}) {
  const fromPath = ensureWorkspaceOwnedPath(fromPathInput, localAssistantWorkspace.folderName);
  const toPath = ensureWorkspaceOwnedPath(toPathInput, localAssistantWorkspace.folderName);
  const overwrite = Boolean(options.overwrite);

  if (!fromPath || !toPath || fromPath.endsWith('/') || toPath.endsWith('/')) {
    return { ok: false, error: 'Invalid rename path.' };
  }
  if (fromPath === toPath) {
    return { ok: false, error: 'Source and target paths are identical.' };
  }

  const source = localAssistantWorkspace.files.get(fromPath);
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || '').trim();
    const sourceDoc = await workspaceMetadataStore.getWorkspaceFile(workspaceId, fromPath);
    if (!sourceDoc) return { ok: false, error: 'Source file not found.' };
    const targetDoc = await workspaceMetadataStore.getWorkspaceFile(workspaceId, toPath);
    if (targetDoc && !overwrite) return { ok: false, error: 'Target file already exists.' };
    const targetStorage = localWorkspaceUploadBlobStorageForPath(toPath);
    if (!targetStorage) return { ok: false, error: 'Target blob path is invalid.' };
    if (targetDoc?.storage?.provider === 's3' && overwrite) {
      await deleteWorkspaceBlob(targetDoc.storage);
    }
    await copyWorkspaceBlob(sourceDoc.storage, targetStorage);
    await deleteWorkspaceBlob(sourceDoc.storage);
    await workspaceMetadataStore.upsertWorkspaceFileRecord({
      workspaceId,
      sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
      folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || 'workspace',
      rootPath: '',
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      path: toPath,
      record: { ...sourceDoc, path: toPath, storage: targetStorage },
      status: String(sourceDoc.status || 'completed').toLowerCase() === 'completed' ? 'completed' : 'pending',
    });
    // Delete the old record and refresh the workspace summary in parallel —
    // neither depends on the other's result.
    await Promise.all([
      workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, fromPath, {
        folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || 'workspace',
        rootPath: '',
        sourceKind: WORKSPACE_SOURCE_UPLOAD,
        sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
      }),
      syncLocalUploadWorkspaceSummary(workspaceId, {
        folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || 'workspace',
        sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
      }),
    ]);
    return { ok: true, mode: 'local-fallback', fromPath, toPath, overwritten: overwrite, updatedAt: localAssistantWorkspace.indexedAt };
  }

  if (!source) return { ok: false, error: 'Source file not found.' };
  if (localAssistantWorkspace.files.has(toPath) && !overwrite) {
    return { ok: false, error: 'Target file already exists.' };
  }

  if (isLocalPathWorkspaceState()) {
    const sourceInfo = resolveLocalWorkspaceAbsolutePath(fromPath);
    const targetInfo = resolveLocalWorkspaceAbsolutePath(toPath);
    if (!overwrite) {
      try {
        await fs.promises.access(targetInfo.absolutePath, fs.constants.F_OK);
        return { ok: false, error: 'Target file already exists.' };
      } catch {
        // Target absent.
      }
    }
    await fs.promises.mkdir(path.dirname(targetInfo.absolutePath), { recursive: true });
    await fs.promises.rename(sourceInfo.absolutePath, targetInfo.absolutePath);
  } else if (source?.storage?.provider === 's3') {
    const targetStorage = localWorkspaceUploadBlobStorageForPath(toPath);
    if (!targetStorage) return { ok: false, error: 'Target blob path is invalid.' };
    if (localAssistantWorkspace.files.has(toPath) && overwrite) {
      const existingTarget = localAssistantWorkspace.files.get(toPath);
      if (existingTarget?.storage?.provider === 's3') {
        await deleteWorkspaceBlob(existingTarget.storage);
      }
    }
    await copyWorkspaceBlob(source.storage, targetStorage);
    await deleteWorkspaceBlob(source.storage);
    source.storage = targetStorage;
  }

  localAssistantWorkspace.files.delete(fromPath);
  localAssistantWorkspace.files.set(toPath, { ...source, path: toPath });
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return { ok: true, mode: 'local-fallback', fromPath, toPath, overwritten: overwrite, updatedAt: localAssistantWorkspace.indexedAt };
}

/**
 * @param {string} pathInput
 * @returns {Promise<object>}
 */
async function localWorkspaceDelete(pathInput) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith('/')) return { ok: false, error: 'Invalid file path.' };

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || '').trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (!existing) return { ok: false, error: 'File not found.' };
    if (existing.storage?.provider === 's3') {
      await deleteWorkspaceBlob(existing.storage);
    }
    // Delete the record and refresh workspace summary in parallel —
    // neither depends on the other's result.
    await Promise.all([
      workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, requested, {
        folderName: existing.folderName || localAssistantWorkspace.folderName || 'workspace',
        rootPath: '',
        sourceKind: WORKSPACE_SOURCE_UPLOAD,
        sessionId: existing.sessionId || localAssistantWorkspace.sessionId,
      }),
      syncLocalUploadWorkspaceSummary(workspaceId, {
        folderName: existing.folderName || localAssistantWorkspace.folderName || 'workspace',
        sessionId: existing.sessionId || localAssistantWorkspace.sessionId,
      }),
    ]);
    return { ok: true, mode: 'local-fallback', path: requested, deleted: true, updatedAt: localAssistantWorkspace.indexedAt };
  }

  if (!localAssistantWorkspace.files.has(requested)) return { ok: false, error: 'File not found.' };

  if (isLocalPathWorkspaceState()) {
    const { absolutePath } = resolveLocalWorkspaceAbsolutePath(requested);
    await fs.promises.rm(absolutePath, { force: false });
  } else {
    const existing = localAssistantWorkspace.files.get(requested);
    if (existing?.storage?.provider === 's3') {
      await deleteWorkspaceBlob(existing.storage);
    }
  }

  localAssistantWorkspace.files.delete(requested);
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return { ok: true, mode: 'local-fallback', path: requested, deleted: true, updatedAt: localAssistantWorkspace.indexedAt };
}

/**
 * @param {Array<{ type: string, path?: string, content?: string, fromPath?: string, toPath?: string, overwrite?: boolean }>} operations
 * @param {{ stopOnError?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function localWorkspaceBatch(operations = [], options = {}) {
  const safeOperations = Array.isArray(operations) ? operations : [];
  const results = [];
  const stopOnError = options.stopOnError !== false;

  for (const operation of safeOperations) {
    const type = String(operation?.type || '').trim().toLowerCase();
    let result;

    if (type === 'write' || type === 'save') {
      result = await localWorkspaceSave(operation.path, operation.content);
    } else if (type === 'create') {
      result = await localWorkspaceCreate(operation.path, operation.content, { overwrite: Boolean(operation.overwrite) });
    } else if (type === 'rename') {
      result = await localWorkspaceRename(operation.fromPath, operation.toPath, { overwrite: Boolean(operation.overwrite) });
    } else if (type === 'delete') {
      result = await localWorkspaceDelete(operation.path);
    } else {
      result = { ok: false, error: `Unsupported batch operation "${type}".` };
    }

    results.push({ type, ok: result?.ok !== false, ...result });
    if (result?.ok === false && stopOnError) break;
  }

  return {
    ok: !results.some((entry) => entry.ok === false),
    mode: 'local-fallback',
    results,
    appliedCount: results.filter((entry) => entry.ok !== false).length,
    failedCount: results.filter((entry) => entry.ok === false).length,
  };
}

/**
 * @param {{ blobPath?: string, files?: object[], folderName?: string, workspaceId?: string, sessionId?: string, append?: boolean, sync?: boolean }} payload
 * @param {{ userId?: string }} [context]
 * @returns {Promise<object>}
 */
async function ingestWorkspaceChunkFromOffload(payload = {}, context = {}) {
  const s3Config = workspaceOffloadConfig.s3 || {};
  if (!s3Config.enabled) throw new Error('S3 workspace offload is not configured on this gateway.');

  const folderName = String(payload?.folderName || 'workspace').trim() || 'workspace';
  const workspaceId = String(payload?.workspaceId || '').trim();
  const sessionId = String(payload?.sessionId || '').trim();
  const append = Boolean(payload?.append);
  const providedFiles = Array.isArray(payload?.files) ? payload.files : [];

  if (providedFiles.length) {
    const files = [];
    for (const candidate of providedFiles) {
      const filePath = toSafePath(candidate?.path || candidate?.name || '');
      if (!filePath) continue;
      const storage = normalizeWorkspaceBlobStorage(candidate?.storage, filePath);
      if (!storage) continue;
      files.push({
        path: filePath,
        sizeBytes: Number(candidate?.sizeBytes ?? candidate?.size ?? 0),
        lastModified: Number(candidate?.lastModified || 0),
        storage,
      });
    }

    if (!files.length) throw new Error('S3 offload manifest has no usable files.');

    const selectPayload = {
      folderName,
      workspaceId,
      sessionId,
      manifest: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, lastModified: f.lastModified, storage: f.storage })),
      files: files.map((f) => ({ path: f.path, sizeBytes: f.sizeBytes, lastModified: f.lastModified, storage: f.storage })),
      append,
      sync: payload?.sync === true,
    };

    if (shouldQueueWorkspaceSelectPayload(selectPayload)) {
      const queuedJob = enqueueWorkspaceSelectJob(selectPayload, { userId: context?.userId });
      return { ...buildWorkspaceSelectAcceptedResponse(queuedJob), offload: true, chunkFileCount: files.length, blobManifest: true };
    }

    const result = await executeWorkspaceSelectWithFallback(selectPayload);
    return { ...result, offload: true, chunkFileCount: files.length, blobManifest: true };
  }

  const blobPath = toSafePath(payload?.blobPath || payload?.path || '');
  if (!blobPath) throw new Error('blobPath is required.');

  const chunkText = await readWorkspaceBlobText({ provider: 's3', blobPath });
  if (!chunkText.content) throw new Error(`S3 offload download failed: empty response for key ${blobPath}.`);

  let chunkPayload;
  try {
    chunkPayload = JSON.parse(chunkText.content);
  } catch {
    throw new Error('S3 offload payload is not valid JSON.');
  }

  const candidateFiles = Array.isArray(chunkPayload?.files) ? chunkPayload.files : [];
  const files = [];
  for (const candidate of candidateFiles) {
    const filePath = toSafePath(candidate?.path || candidate?.name || '');
    if (!filePath) continue;
    const normalized = normalizeIncomingWorkspacePreindexedFile(candidate, filePath);
    if (normalized?.rawStorage || normalized?.transportEnvelope || normalized?.capsuleCache || normalized?.compressedBase64) {
      files.push(normalized);
      continue;
    }
    const content = typeof candidate?.content === 'string' ? candidate.content : String(candidate?.content || '');
    files.push({ path: filePath, content });
  }

  if (!files.length) throw new Error('S3 offload chunk has no usable files.');

  const selectPayload = {
    folderName: String(chunkPayload?.folderName || folderName),
    workspaceId: String(chunkPayload?.workspaceId || workspaceId),
    sessionId: String(chunkPayload?.sessionId || sessionId),
    files,
    append: Boolean(chunkPayload?.append ?? append),
    sync: payload?.sync === true || chunkPayload?.sync === true,
  };

  if (shouldQueueWorkspaceSelectPayload(selectPayload)) {
    const queuedJob = enqueueWorkspaceSelectJob(selectPayload, { userId: context?.userId });
    return { ...buildWorkspaceSelectAcceptedResponse(queuedJob), offload: true, blobPath, chunkFileCount: files.length };
  }

  const result = await executeWorkspaceSelectWithFallback(selectPayload);
  return { ...result, offload: true, blobPath, chunkFileCount: files.length, blobManifest: false };
}

/**
 * @param {string} model
 * @param {object[]} messages
 * @returns {Promise<{ content: string, referencedFiles: string[], model: string, mode: string }>}
 */
async function localAssistantReply(model, messages) {
  const lastUserMessage = messages.filter((m) => m?.role === 'user').at(-1)?.content || '';
  const referencedFiles = await localResolveReferencedFiles(lastUserMessage);
  const hasUploadWorkspace = workspaceMetadataStore.enabled && isUploadWorkspaceState();
  const totalFiles = hasUploadWorkspace
    ? Number(localAssistantWorkspace.fileCountTotal || localAssistantWorkspace.files.size || 0)
    : localAssistantWorkspace.files.size;
  const indexedFiles = hasUploadWorkspace
    ? Number(localAssistantWorkspace.fileCountCompleted || 0)
    : [...localAssistantWorkspace.files.values()].filter((meta) => workspaceRecordIndexed(meta)).length;

  if (referencedFiles.length > 0) {
    return {
      content: `I loaded these workspace files from local fallback mode: ${referencedFiles.join(', ')}. I can now review or explain them.`,
      referencedFiles,
      model,
      mode: 'local-fallback',
    };
  }

  if (totalFiles > 0) {
    if (indexedFiles === 0) {
      return {
        content: `Local workspace "${localAssistantWorkspace.folderName}" is connected. File tree is ready and content indexing is running in the background (0/${totalFiles} files ready).`,
        referencedFiles: [],
        model,
        mode: 'local-fallback',
      };
    }
    return {
      content: `Local workspace "${localAssistantWorkspace.folderName}" is indexing in the background (${indexedFiles}/${totalFiles} files ready). Mention a filename and I will inspect it.`,
      referencedFiles: [],
      model,
      mode: 'local-fallback',
    };
  }

  return { content: mockReply(lastUserMessage), referencedFiles: [], model, mode: 'local-fallback' };
}

module.exports = {
  localWorkspaceRename,
  localWorkspaceDelete,
  localWorkspaceBatch,
  ingestWorkspaceChunkFromOffload,
  localAssistantReply,
};
