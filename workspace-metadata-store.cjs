const crypto = require("crypto");

let CosmosClientCtor = null;
try {
  ({ CosmosClient: CosmosClientCtor } = require("@azure/cosmos"));
} catch {
  CosmosClientCtor = null;
}

const DEFAULT_WORKSPACE_STATUS = "processing";
const DEFAULT_FILE_STATUS = "pending";

function trim(value) {
  return String(value || "").trim();
}

function toIsoNow() {
  return new Date().toISOString();
}

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.(\/|$)/g, "")
    .trim();
}

function normalizeWorkspaceId(value, fallback = "") {
  return trim(value || fallback);
}

function normalizeStatus(value, fallback) {
  const normalized = trim(value || fallback).toLowerCase();
  if (["pending", "processing", "completed", "failed", "ready", "partial"].includes(normalized)) return normalized;
  return fallback;
}

function fileDocumentId(workspaceId, pathValue) {
  return `${normalizeWorkspaceId(workspaceId)}:${normalizePath(pathValue)}`;
}

function workspaceDocumentId(workspaceId) {
  return normalizeWorkspaceId(workspaceId);
}

function parseBooleanFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") return fallback;
  const normalized = String(rawValue).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isRetryableCosmosCode(code) {
  return [408, 409, 412, 423, 429, 449, 500, 503].includes(Number(code || 0));
}

function retryDelayMs(retryAfterMs, attempt) {
  const hinted = Number(retryAfterMs || 0);
  if (hinted > 0) return hinted;
  return Math.min(4000, 150 * (2 ** Math.max(0, Number(attempt) || 0)));
}

function createWorkspaceMetadataStore(options = {}) {
  const endpoint = trim(options.endpoint || process.env.MESH_COSMOS_ENDPOINT || "");
  const key = trim(options.key || process.env.MESH_COSMOS_KEY || "");
  const databaseId = trim(options.databaseId || process.env.MESH_COSMOS_DATABASE || "mesh-db");
  const filesContainerId = trim(options.filesContainerId || process.env.MESH_COSMOS_WORKSPACE_FILES_CONTAINER || "workspace_files");
  const workspacesContainerId = trim(options.workspacesContainerId || process.env.MESH_COSMOS_WORKSPACES_CONTAINER || "workspace_workspaces");
  const createContainers = parseBooleanFlag(options.createContainers ?? process.env.MESH_COSMOS_CREATE_CONTAINERS, true);
  const enabled = Boolean(endpoint && key && CosmosClientCtor);

  let initPromise = null;

  async function init() {
    if (!enabled) {
      throw new Error("Workspace metadata store is not configured.");
    }
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const client = new CosmosClientCtor({ endpoint, key });
      const { database } = await client.databases.createIfNotExists({ id: databaseId });
      const filesContainer = createContainers
        ? (await database.containers.createIfNotExists({
          id: filesContainerId,
          partitionKey: { paths: ["/workspaceId"] },
        })).container
        : database.container(filesContainerId);
      const workspacesContainer = createContainers
        ? (await database.containers.createIfNotExists({
          id: workspacesContainerId,
          partitionKey: { paths: ["/workspaceId"] },
        })).container
        : database.container(workspacesContainerId);
      return { client, database, filesContainer, workspacesContainer };
    })();
    return initPromise;
  }

  async function queryScalar(container, query, parameters = []) {
    const iterator = container.items.query({ query, parameters }, { enableCrossPartitionQuery: true });
    const { resources } = await iterator.fetchAll();
    return Number(resources?.[0] || 0);
  }

  async function getWorkspaceSummary(workspaceId) {
    const id = workspaceDocumentId(workspaceId);
    if (!enabled || !id) return null;
    const { workspacesContainer } = await init();
    try {
      const { resource } = await workspacesContainer.item(id, id).read();
      return resource || null;
    } catch (error) {
      if (Number(error?.code || error?.statusCode) === 404) return null;
      throw error;
    }
  }

  async function getWorkspaceFile(workspaceId, pathValue) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedPath = normalizePath(pathValue);
    if (!enabled || !normalizedWorkspaceId || !normalizedPath) return null;
    const { filesContainer } = await init();
    // Use SQL query instead of point-read — avoids Cosmos SDK issues with ":" in document IDs
    const iterator = filesContainer.items.query({
      query: "SELECT * FROM c WHERE c.workspaceId = @workspaceId AND c.path = @path",
      parameters: [
        { name: "@workspaceId", value: normalizedWorkspaceId },
        { name: "@path", value: normalizedPath },
      ],
    }, { partitionKey: normalizedWorkspaceId });
    const { resources } = await iterator.fetchAll();
    return resources?.[0] || null;
  }

  async function listWorkspaceFiles(workspaceId) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!enabled || !normalizedWorkspaceId) return [];
    const { filesContainer } = await init();
    const iterator = filesContainer.items.query({
      query: "SELECT * FROM c WHERE c.workspaceId = @workspaceId ORDER BY c.path",
      parameters: [{ name: "@workspaceId", value: normalizedWorkspaceId }],
    }, {
      partitionKey: normalizedWorkspaceId,
      enableCrossPartitionQuery: false,
    });
    const { resources } = await iterator.fetchAll();
    return Array.isArray(resources) ? resources : [];
  }

  async function upsertWorkspaceSummary(doc = {}) {
    const normalizedWorkspaceId = normalizeWorkspaceId(doc.workspaceId || doc.id);
    if (!enabled || !normalizedWorkspaceId) return null;
    const { workspacesContainer } = await init();
    const now = toIsoNow();
    const resource = {
      id: workspaceDocumentId(normalizedWorkspaceId),
      workspaceId: normalizedWorkspaceId,
      folderName: trim(doc.folderName || "workspace") || "workspace",
      rootPath: trim(doc.rootPath || ""),
      sourceKind: trim(doc.sourceKind || "upload") || "upload",
      sessionId: trim(doc.sessionId || ""),
      status: normalizeStatus(doc.status, DEFAULT_WORKSPACE_STATUS),
      fileCountTotal: Number(doc.fileCountTotal || 0),
      fileCountPending: Number(doc.fileCountPending || 0),
      fileCountCompleted: Number(doc.fileCountCompleted || 0),
      fileCountFailed: Number(doc.fileCountFailed || 0),
      indexedAt: trim(doc.indexedAt || ""),
      createdAt: trim(doc.createdAt || now) || now,
      updatedAt: now,
    };
    const { resource: saved } = await workspacesContainer.items.upsert(resource);
    return saved || resource;
  }

  async function recomputeWorkspaceSummary(workspaceId, baseFields = {}) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!enabled || !normalizedWorkspaceId) return null;
    const { filesContainer } = await init();
    const total = await queryScalar(filesContainer, "SELECT VALUE COUNT(1) FROM c WHERE c.workspaceId = @workspaceId", [
      { name: "@workspaceId", value: normalizedWorkspaceId },
    ]);
    const completed = await queryScalar(filesContainer, "SELECT VALUE COUNT(1) FROM c WHERE c.workspaceId = @workspaceId AND c.status = 'completed'", [
      { name: "@workspaceId", value: normalizedWorkspaceId },
    ]);
    const failed = await queryScalar(filesContainer, "SELECT VALUE COUNT(1) FROM c WHERE c.workspaceId = @workspaceId AND c.status = 'failed'", [
      { name: "@workspaceId", value: normalizedWorkspaceId },
    ]);
    const pending = Math.max(0, total - completed - failed);
    let status = DEFAULT_WORKSPACE_STATUS;
    if (total > 0 && completed === total) status = "ready";
    else if (total > 0 && completed + failed === total) status = failed > 0 ? "partial" : "ready";
    else if (total > 0 && failed === total) status = "failed";
    const existing = await getWorkspaceSummary(normalizedWorkspaceId);
    return upsertWorkspaceSummary({
      ...(existing || {}),
      ...baseFields,
      workspaceId: normalizedWorkspaceId,
      status,
      fileCountTotal: total,
      fileCountPending: pending,
      fileCountCompleted: completed,
      fileCountFailed: failed,
      indexedAt: completed > 0 ? toIsoNow() : trim(existing?.indexedAt || baseFields.indexedAt || ""),
    });
  }

  async function seedWorkspaceManifest({ workspaceId, folderName, rootPath = "", sourceKind = "upload", sessionId = "", files = [] } = {}) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!enabled || !normalizedWorkspaceId) return null;
    const safeFiles = Array.isArray(files) ? files : [];
    const { filesContainer } = await init();
    const now = toIsoNow();
    const operations = [];
    for (const entry of safeFiles) {
      const pathValue = normalizePath(entry?.path || entry?.name);
      if (!pathValue) continue;
      operations.push({
        operationType: "Create",
        resourceBody: {
          id: fileDocumentId(normalizedWorkspaceId, pathValue),
          workspaceId: normalizedWorkspaceId,
          folderName: trim(folderName || "workspace") || "workspace",
          rootPath: trim(rootPath || ""),
          sourceKind: trim(sourceKind || "upload") || "upload",
          sessionId: trim(sessionId || ""),
          path: pathValue,
          status: DEFAULT_FILE_STATUS,
          originalSize: Number(entry?.sizeBytes ?? entry?.size ?? 0),
          storage: entry?.storage && typeof entry.storage === "object" ? {
            provider: trim(entry.storage.provider || "azure-blob") || "azure-blob",
            blobPath: normalizePath(entry.storage.blobPath || pathValue),
            azureBlobUrl: trim(entry.storage.azureBlobUrl || ""),
          } : null,
          kind: "pending",
          fileType: "",
          parserFamily: "",
          parseOk: false,
          capsuleMode: "",
          compressionStats: {
            rawBytes: Number(entry?.sizeBytes ?? entry?.size ?? 0),
            capsuleBytes: 0,
            transportBytes: 0,
            rawTokenEstimate: 0,
            capsuleTokenEstimate: 0,
            compressionRatio: 0,
            budgetTokens: 0,
            budgetMet: false,
            recoveryEligible: false,
          },
          indexedAt: "",
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    if (operations.length) {
      const maxAttempts = 10;
      let queue = operations.slice();
      let chunkSize = 12;

      for (let attempt = 0; attempt < maxAttempts && queue.length; attempt += 1) {
        const retryQueue = [];

        for (let index = 0; index < queue.length; index += chunkSize) {
          const slice = queue.slice(index, index + chunkSize);
          let response;
          try {
            response = await filesContainer.items.bulk(slice, { continueOnError: true });
          } catch (error) {
            const code = Number(error?.code || error?.statusCode || 0);
            if (!isRetryableCosmosCode(code)) {
              throw error;
            }
            retryQueue.push(...slice);
            await sleep(retryDelayMs(error?.retryAfterInMs || error?.retryAfterMilliseconds, attempt));
            continue;
          }

          let sawRetryableFailure = false;
          let maxRetryAfterMs = 0;
          for (const item of response || []) {
            const code = Number(item?.statusCode || 0);
            if (!code || code === 201 || code === 409) continue;
            if (isRetryableCosmosCode(code)) {
              sawRetryableFailure = true;
              maxRetryAfterMs = Math.max(
                maxRetryAfterMs,
                Number(item?.retryAfterInMs || item?.retryAfterMilliseconds || item?.resourceBody?.retryAfterInMs || 0),
              );
              if (item?.operation) retryQueue.push(item.operation);
              continue;
            }
            throw new Error(`Workspace manifest seed failed (${code}).`);
          }

          if (sawRetryableFailure) {
            await sleep(retryDelayMs(maxRetryAfterMs, attempt));
          }
        }

        queue = retryQueue;
        chunkSize = Math.max(4, Math.floor(chunkSize / 2));
      }

      if (queue.length) {
        throw new Error("Workspace manifest seed failed (429).");
      }
    }
    return recomputeWorkspaceSummary(normalizedWorkspaceId, {
      workspaceId: normalizedWorkspaceId,
      folderName,
      rootPath,
      sourceKind,
      sessionId,
      status: DEFAULT_WORKSPACE_STATUS,
    });
  }

  async function upsertWorkspaceFileRecord({ workspaceId, folderName, rootPath = "", sourceKind = "upload", sessionId = "", path: pathValue, record, status = "completed", error = "" } = {}) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedPath = normalizePath(pathValue || record?.path || "");
    if (!enabled || !normalizedWorkspaceId || !normalizedPath) return null;
    const { filesContainer } = await init();
    const existing = await getWorkspaceFile(normalizedWorkspaceId, normalizedPath);
    const now = toIsoNow();
    const normalizedStatus = normalizeStatus(status, "completed");
    const baseStorage = record?.storage && typeof record.storage === "object" ? {
      provider: trim(record.storage.provider || "azure-blob") || "azure-blob",
      blobPath: normalizePath(record.storage.blobPath || normalizedPath),
      azureBlobUrl: trim(record.storage.azureBlobUrl || ""),
    } : (existing?.storage || null);
    const resource = {
      ...(existing || {}),
      ...(record && typeof record === "object" ? record : {}),
      id: fileDocumentId(normalizedWorkspaceId, normalizedPath),
      workspaceId: normalizedWorkspaceId,
      folderName: trim(folderName || existing?.folderName || "workspace") || "workspace",
      rootPath: trim(rootPath || existing?.rootPath || ""),
      sourceKind: trim(sourceKind || existing?.sourceKind || "upload") || "upload",
      sessionId: trim(sessionId || existing?.sessionId || ""),
      path: normalizedPath,
      status: normalizedStatus,
      storage: baseStorage,
      originalSize: Number(record?.originalSize ?? existing?.originalSize ?? 0),
      kind: normalizedStatus === "completed" ? "source" : (existing?.kind || "pending"),
      indexedAt: normalizedStatus === "completed" ? now : trim(existing?.indexedAt || ""),
      error: normalizedStatus === "failed" ? trim(error || record?.error || existing?.error || "") : "",
      updatedAt: now,
      createdAt: trim(existing?.createdAt || now) || now,
    };
    const { resource: saved } = await filesContainer.items.upsert(resource);
    await recomputeWorkspaceSummary(normalizedWorkspaceId, {
      workspaceId: normalizedWorkspaceId,
      folderName: resource.folderName,
      rootPath: resource.rootPath,
      sourceKind: resource.sourceKind,
      sessionId: resource.sessionId,
    });
    return saved || resource;
  }

  async function markWorkspaceFileFailed({ workspaceId, folderName, rootPath = "", sourceKind = "upload", sessionId = "", path: pathValue, storage = null, originalSize = 0, error = "" } = {}) {
    return upsertWorkspaceFileRecord({
      workspaceId,
      folderName,
      rootPath,
      sourceKind,
      sessionId,
      path: pathValue,
      record: {
        path: normalizePath(pathValue),
        storage: storage && typeof storage === "object" ? {
          provider: trim(storage.provider || "azure-blob") || "azure-blob",
          blobPath: normalizePath(storage.blobPath || pathValue),
          azureBlobUrl: trim(storage.azureBlobUrl || ""),
        } : null,
        originalSize: Number(originalSize || 0),
      },
      status: "failed",
      error,
    });
  }

  async function deleteWorkspaceFileRecord(workspaceId, pathValue, baseFields = {}) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    const normalizedPath = normalizePath(pathValue);
    if (!enabled || !normalizedWorkspaceId || !normalizedPath) return false;
    const { filesContainer } = await init();
    try {
      await filesContainer.item(fileDocumentId(normalizedWorkspaceId, normalizedPath), normalizedWorkspaceId).delete();
    } catch (error) {
      const code = Number(error?.code || error?.statusCode || 0);
      if (code !== 404) throw error;
    }
    await recomputeWorkspaceSummary(normalizedWorkspaceId, {
      workspaceId: normalizedWorkspaceId,
      ...baseFields,
    });
    return true;
  }

  async function purgeWorkspace(workspaceId) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!enabled || !normalizedWorkspaceId) return false;
    const { filesContainer, workspacesContainer } = await init();

    // 1. Delete all files in bulk
    const files = await listWorkspaceFiles(normalizedWorkspaceId);
    if (files.length > 0) {
      const operations = files.map(file => ({
        operationType: "Delete",
        id: file.id,
        partitionKey: normalizedWorkspaceId
      }));

      // Cosmos bulk delete in chunks
      const chunkSize = 50;
      for (let i = 0; i < operations.length; i += chunkSize) {
        await filesContainer.items.bulk(operations.slice(i, i + chunkSize), { continueOnError: true });
      }
    }

    // 2. Delete the summary
    const summaryId = workspaceDocumentId(normalizedWorkspaceId);
    try {
      await workspacesContainer.item(summaryId, summaryId).delete();
    } catch (error) {
       const code = Number(error?.code || error?.statusCode || 0);
       if (code !== 404) throw error;
    }

    return true;
  }

  async function reconcileWorkspace(workspaceId, currentPaths) {
    const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
    if (!enabled || !normalizedWorkspaceId || !Array.isArray(currentPaths)) return false;

    const indexedFiles = await listWorkspaceFiles(normalizedWorkspaceId);
    const currentPathsSet = new Set(currentPaths.map(p => normalizePath(p)));

    const orphanedIds = indexedFiles
      .filter(file => {
        const norm = normalizePath(file.path);
        const exists = currentPathsSet.has(norm);
        return !exists;
      })
      .map(file => file.id);

    if (orphanedIds.length > 0) {
      console.log(`[recon] Detected ${orphanedIds.length} abandoned files in DB for workspace: ${normalizedWorkspaceId}`);
      const { filesContainer } = await init();
      const operations = orphanedIds.map(id => ({
        operationType: "Delete",
        id,
        partitionKey: normalizedWorkspaceId
      }));

      // In chunks to avoid throughput issues
      const chunkSize = 50;
      for (let i = 0; i < operations.length; i += chunkSize) {
        try {
          await filesContainer.items.bulk(operations.slice(i, i + chunkSize), { continueOnError: true });
        } catch (err) {
          console.error(`[recon] Bulk delete error: ${err.message}`);
        }
      }

      await recomputeWorkspaceSummary(normalizedWorkspaceId);
      console.log(`[recon] Successfully purged ${orphanedIds.length} orphaned records.`);
    }

    return true;
  }

  async function listWorkspaceProgress(workspaceId) {
    return getWorkspaceSummary(workspaceId);
  }

  return {
    enabled,
    databaseId,
    filesContainerId,
    workspacesContainerId,
    fileDocumentId,
    workspaceDocumentId,
    normalizePath,
    normalizeWorkspaceId,
    init,
    getWorkspaceSummary,
    getWorkspaceFile,
    listWorkspaceFiles,
    upsertWorkspaceSummary,
    recomputeWorkspaceSummary,
    seedWorkspaceManifest,
    upsertWorkspaceFileRecord,
    markWorkspaceFileFailed,
    deleteWorkspaceFileRecord,
    purgeWorkspace,
    reconcileWorkspace,
    listWorkspaceProgress,
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
