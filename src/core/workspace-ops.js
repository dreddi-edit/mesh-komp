'use strict';
/**
 * MESH — Workspace Operations Layer
 * File CRUD, workspace selection, search/grep, git operations, AI reply
 * routing, context assembly, and reference resolution.
 *
 * All functions reference globals (populated by server.js at startup) at
 * call-time. No Node.js built-ins are needed directly.
 */

let localWorkspaceEnrichmentRunning = false;
const localWorkspaceEnrichmentPending = [];

function enqueueLocalWorkspaceEnrichment(ctx = {}) {
  const key = ctx.workspaceId || ctx.rootPath || localAssistantWorkspace.folderName || "local";
  const existing = localWorkspaceEnrichmentPending.findIndex((job) => (job.workspaceId || job.rootPath || job.folderName || "local") === key);
  if (existing !== -1) localWorkspaceEnrichmentPending.splice(existing, 1);
  localWorkspaceEnrichmentPending.push(ctx);
  if (!localWorkspaceEnrichmentRunning) drainLocalWorkspaceEnrichmentQueue();
}

async function drainLocalWorkspaceEnrichmentQueue() {
  localWorkspaceEnrichmentRunning = true;
  while (localWorkspaceEnrichmentPending.length > 0) {
    const ctx = localWorkspaceEnrichmentPending.shift();
    try {
      await enrichLocalWorkspaceRecords(ctx);
    } catch (error) {
      console.error("[mesh] local enrichment failed:", error?.message || error);
    }
  }
  localWorkspaceEnrichmentRunning = false;
}

async function enrichLocalWorkspaceRecords(ctx = {}) {
  const workspaceId = String(ctx.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const folderName = String(ctx.folderName || localAssistantWorkspace.folderName || "workspace");
  const rootPath = String(ctx.rootPath || localAssistantWorkspace.rootPath || "");
  const perf = createWorkspacePerfTracker("local-enrich", { workspaceId, folderName });

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState() && workspaceId) {
    const files = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    const candidates = files.filter((meta) => meta?.path && isWorkspaceIndexablePath(meta.path) && String(meta?.recordMode || "").toLowerCase() !== "full");
    const workspaceFilePaths = files.filter((meta) => meta?.path && isWorkspaceIndexablePath(meta.path)).map((meta) => meta.path);
    await mapWithConcurrency(candidates, MESH_WORKSPACE_ENRICH_CONCURRENCY, async (meta) => {
      let content = "";
      let truncated = false;
      let originalSize = Number(meta?.originalSize || 0);
      if (meta?.storage?.provider === "azure-blob") {
        const blob = await readWorkspaceBlobText(meta.storage, originalSize);
        content = blob.content;
        truncated = Boolean(blob.truncated);
        originalSize = Number(blob.byteLength || originalSize);
      } else {
        content = await loadLocalWorkspaceRecordText(meta, meta.path);
        originalSize = Buffer.byteLength(String(content || ""), "utf8");
      }
      const packed = await buildWorkspaceFileRecord(meta.path, content, {
        legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
        initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
        originalSizeOverride: originalSize,
        storage: meta?.storage?.provider === "azure-blob" ? meta.storage : undefined,
        truncated,
        persistRawContent: meta?.storage?.provider === "azure-blob" ? false : undefined,
        persistTransportChunks: meta?.storage?.provider === "azure-blob" ? false : undefined,
        workspaceFilePaths,
        recordMode: "full",
      });
      await workspaceMetadataStore.upsertWorkspaceFileRecord({
        workspaceId,
        sessionId: localAssistantWorkspace.sessionId,
        folderName,
        rootPath: "",
        sourceKind: WORKSPACE_SOURCE_UPLOAD,
        path: meta.path,
        record: packed,
        status: "completed",
      });
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName,
      sessionId: localAssistantWorkspace.sessionId,
    });
    perf.flush({ enriched: candidates.length });
    return;
  }

  const files = [...localAssistantWorkspace.files.values()];
  const candidates = files.filter((meta) => meta?.path && isWorkspaceIndexablePath(meta.path) && String(meta?.recordMode || "").toLowerCase() !== "full");
  const workspaceFilePaths = files.filter((meta) => meta?.path && isWorkspaceIndexablePath(meta.path)).map((meta) => meta.path);
  await mapWithConcurrency(candidates, MESH_WORKSPACE_ENRICH_CONCURRENCY, async (meta) => {
    let content = "";
    if (rootPath) {
      const relativePath = toWorkspaceRelativePath(meta.path, folderName);
      const absolutePath = path.resolve(rootPath, relativePath);
      content = await readLocalWorkspaceFileText(absolutePath);
    } else {
      content = await loadLocalWorkspaceRecordText(meta, meta.path);
    }
    const packed = await buildWorkspaceFileRecord(meta.path, content, {
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
      originalSizeOverride: Buffer.byteLength(String(content || ""), "utf8"),
      workspaceFilePaths,
      recordMode: "full",
    });
    localAssistantWorkspace.files.set(meta.path, {
      ...packed,
      path: meta.path,
      kind: "source",
    });
  });
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();
  perf.flush({ enriched: candidates.length });
}

async function localWorkspaceSelect(data) {
  const shouldClear = Boolean(data?.clear);
  if (shouldClear) {
    clearLocalWorkspaceState();
    persistLocalWorkspaceState();

    return {
      ok: true,
      mode: "local-fallback",
      cleared: true,
      folderName: null,
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      append: false,
      chunkFileCount: 0,
      fileCount: 0,
      originalBytes: 0,
      compressedBytes: 0,
      ratio: null,
    };
  }

  const folderName = String(data?.folderName || "workspace");
  const workspaceId = String(data?.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const sessionId = String(data?.sessionId || localAssistantWorkspace.sessionId || "").trim();
  const manifestEntries = Array.isArray(data?.manifest) ? data.manifest : [];
  const incomingFiles = Array.isArray(data?.files) ? data.files : [];
  const deletedPaths = Array.isArray(data?.deletedPaths) ? data.deletedPaths.map((entry) => toSafePath(entry)).filter(Boolean) : [];
  const syncMode = String(data?.mode || "background").trim().toLowerCase() || "background";
  const candidateEntries = (manifestEntries.length ? manifestEntries : incomingFiles)
    .filter((entry) => isWorkspaceIndexablePath(entry?.path || entry?.name || ""));
  const append = Boolean(data?.append);

  if (workspaceMetadataStore.enabled && workspaceId) {
    const seededFiles = candidateEntries.map((entry) => {
      const filePath = toSafePath(entry?.path || entry?.name);
      if (!filePath) return null;
      return {
        path: filePath,
        sizeBytes: Number(entry?.sizeBytes ?? entry?.size ?? 0),
        storage: normalizeWorkspaceBlobStorage(entry?.storage, filePath),
      };
    }).filter(Boolean);
    if (deletedPaths.length > 0) {
      await Promise.all(deletedPaths.map((filePath) => workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, filePath, {
        folderName,
        rootPath: "",
        sourceKind: WORKSPACE_SOURCE_UPLOAD,
        sessionId,
      })));
    }
    await workspaceMetadataStore.seedWorkspaceManifest({
      workspaceId,
      folderName,
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      sessionId,
      files: seededFiles,
    });
    const summary = await syncLocalUploadWorkspaceSummary(workspaceId, { folderName, sessionId });
    enqueueLocalWorkspaceEnrichment({ workspaceId, folderName });
    return {
      ok: true,
      mode: "local-fallback",
      folderName: localAssistantWorkspace.folderName || folderName,
      rootPath: "",
      workspaceId,
      sessionId,
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      status: String(summary?.status || localAssistantWorkspace.status || "processing"),
      append,
      mode: syncMode,
      manifestCount: candidateEntries.length,
      chunkFileCount: incomingFiles.length,
      fileCount: Number(summary?.fileCountTotal || localAssistantWorkspace.fileCountTotal || seededFiles.length),
      indexedCount: Number(summary?.fileCountCompleted || localAssistantWorkspace.fileCountCompleted || 0),
      pendingCount: Number(summary?.fileCountPending || localAssistantWorkspace.fileCountPending || 0),
      failedCount: Number(summary?.fileCountFailed || localAssistantWorkspace.fileCountFailed || 0),
      originalBytes: 0,
      compressedBytes: 0,
      capsuleBytes: 0,
      transportBytes: 0,
      ratio: null,
    };
  }

  const canAppend = append
    && localAssistantWorkspace.folderName === folderName
    && normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_UPLOAD;

  let next;
  if (canAppend) {
    next = localAssistantWorkspace.files;
  } else {
    next = new Map();
    localAssistantWorkspace.folderName = folderName;
    localAssistantWorkspace.rootPath = null;
    localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
    localAssistantWorkspace.files = next;
  }

  let originalBytes = 0;
  let compressedBytes = 0;
  let capsuleBytes = 0;
  let transportBytes = 0;
  for (const filePath of deletedPaths) {
    next.delete(filePath);
  }

  for (const entry of candidateEntries) {
    const filePath = toSafePath(entry?.path || entry?.name);
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;

    const known = next.get(filePath);
    const declaredSize = Number(entry?.sizeBytes ?? entry?.size ?? known?.originalSize ?? 0);
    const normalizedSize = Number.isFinite(declaredSize) && declaredSize >= 0 ? declaredSize : Number(known?.originalSize || 0);
    const storage = normalizeWorkspaceBlobStorage(entry?.storage, filePath);

    if (workspaceRecordIndexed(known)) {
      next.set(filePath, {
        ...known,
        originalSize: normalizedSize,
        ...(storage ? { storage } : {}),
        kind: "source",
      });
      continue;
    }

    next.set(filePath, {
      path: filePath,
      compressedBase64: "",
      originalSize: normalizedSize,
      compressedSize: 0,
      formatVersion: WORKSPACE_RECORD_VERSION,
      ...(storage ? {
        storage,
        rawStorage: {
          encoding: "external-azure-blob",
          rawBytes: normalizedSize,
        },
      } : {}),
      kind: "pending",
    });
  }

  const compressedEntries = await compressLocalWorkspaceChunkFiles(incomingFiles, {
    recordMode: syncMode === "single-file" ? "full" : "initial",
  });
  for (const entry of compressedEntries) {
    const packed = await ensureLocalWorkspaceMeta(entry.packed, entry.filePath);
    originalBytes += Number(packed.originalSize || 0);
    compressedBytes += Number(packed.compressedSize || 0);
    capsuleBytes += Number(packed.compressionStats?.capsuleBytes || 0);
    transportBytes += Number(packed.compressionStats?.transportBytes || 0);
    next.set(entry.filePath, {
      ...packed,
      path: entry.filePath,
      kind: "source",
    });
  }

  localAssistantWorkspace.folderName = folderName;
  localAssistantWorkspace.workspaceId = workspaceId;
  localAssistantWorkspace.sessionId = sessionId;
  localAssistantWorkspace.fileCountTotal = next.size;
  localAssistantWorkspace.fileCountCompleted = [...next.values()].filter((meta) => workspaceRecordIndexed(meta)).length;
  localAssistantWorkspace.fileCountPending = Math.max(0, next.size - localAssistantWorkspace.fileCountCompleted);
  localAssistantWorkspace.fileCountFailed = 0;
  localAssistantWorkspace.status = syncMode === "initial" ? "initial-ready" : "processing";
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  const indexedCount = localAssistantWorkspace.fileCountCompleted;
  if (syncMode !== "single-file") {
    enqueueLocalWorkspaceEnrichment({ folderName });
  }

  return {
    ok: true,
    mode: "local-fallback",
    folderName,
    rootPath: "",
    sourceKind: WORKSPACE_SOURCE_UPLOAD,
    append: canAppend,
    mode: syncMode,
    manifestCount: candidateEntries.length,
    chunkFileCount: incomingFiles.length,
    fileCount: next.size,
    indexedCount,
    pendingCount: Math.max(0, next.size - indexedCount),
    originalBytes,
    compressedBytes,
    capsuleBytes,
    transportBytes,
    ratio: compressedBytes > 0 ? Number((originalBytes / compressedBytes).toFixed(2)) : null,
  };
}

async function localWorkspaceOpenLocal(rootPathInput, options = {}) {
  const rootPath = normalizeAbsoluteRootPath(rootPathInput);
  if (!rootPath) {
    return { ok: false, error: "Workspace root path required." };
  }

  let stats;
  try {
    stats = await fs.promises.stat(rootPath);
  } catch {
    return { ok: false, error: "Workspace root not found." };
  }

  if (!stats.isDirectory()) {
    return { ok: false, error: "Workspace root must be a directory." };
  }

  const folderName = String(options.folderName || path.basename(rootPath) || "workspace").trim() || "workspace";
  const perf = createWorkspacePerfTracker("local-open-local", { folderName });
  const files = (await scanLocalWorkspaceFiles(rootPath, folderName))
    .filter((entry) => isWorkspaceIndexablePath(entry.workspacePath));
  perf.mark("scan-complete", { files: files.length });
  const next = new Map();
  let originalBytes = 0;
  let compressedBytes = 0;
  let capsuleBytes = 0;
  let transportBytes = 0;
  const workspaceFilePaths = files.map((entry) => entry.workspacePath);
  const packedEntries = await mapWithConcurrency(files, MESH_WORKSPACE_BUILD_CONCURRENCY, async (entry) => {
    const content = await readLocalWorkspaceFileText(entry.absolutePath);
    const packed = await packLocalWorkspaceContent(entry.workspacePath, content, {
      recordMode: "initial",
      workspaceFilePaths,
    });
    return { ...entry, packed };
  });
  perf.mark("initial-records-ready");

  for (const entry of packedEntries) {
    next.set(entry.workspacePath, {
      path: entry.workspacePath,
      ...entry.packed,
      kind: "source",
    });
    originalBytes += Number(entry.packed.originalSize || 0);
    compressedBytes += Number(entry.packed.compressedSize || 0);
    capsuleBytes += Number(entry.packed.compressionStats?.capsuleBytes || 0);
    transportBytes += Number(entry.packed.compressionStats?.transportBytes || 0);
  }

  localAssistantWorkspace.folderName = folderName;
  localAssistantWorkspace.rootPath = rootPath;
  localAssistantWorkspace.workspaceId = "";
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_LOCAL_PATH;
  localAssistantWorkspace.files = next;
  localAssistantWorkspace.fileCountTotal = next.size;
  localAssistantWorkspace.fileCountCompleted = next.size;
  localAssistantWorkspace.fileCountPending = 0;
  localAssistantWorkspace.fileCountFailed = 0;
  localAssistantWorkspace.status = "initial-ready";
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();
  enqueueLocalWorkspaceEnrichment({ rootPath, folderName });
  perf.flush({ discovered: files.length, indexed: next.size });

  return {
    ok: true,
    mode: "local-fallback",
    folderName,
    rootPath,
    sourceKind: WORKSPACE_SOURCE_LOCAL_PATH,
    append: false,
    manifestCount: 0,
    chunkFileCount: files.length,
    fileCount: next.size,
    indexedCount: next.size,
    pendingCount: 0,
    originalBytes,
    compressedBytes,
    capsuleBytes,
    transportBytes,
    ratio: compressedBytes > 0 ? Number((originalBytes / compressedBytes).toFixed(2)) : null,
  };
}

async function localWorkspaceFiles(options = {}) {
  const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const sessionId = String(options.sessionId || localAssistantWorkspace.sessionId || "").trim();
  const folderName = String(options.folderName || localAssistantWorkspace.folderName || "").trim();

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState() && workspaceId) {
    const summary = await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: folderName || localAssistantWorkspace.folderName,
      sessionId: sessionId || localAssistantWorkspace.sessionId,
    });
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return {
      ok: true,
      mode: "local-fallback",
      ...localWorkspaceSummary(),
      workspaceId: workspaceId || localAssistantWorkspace.workspaceId || "",
      sessionId: sessionId || localAssistantWorkspace.sessionId || "",
      folderName: folderName || summary?.folderName || localAssistantWorkspace.folderName || "",
      fileCount: Number(summary?.fileCountTotal || localAssistantWorkspace.fileCountTotal || docs.length),
      files: docs.map((doc) => buildWorkspaceFileListingEntry(doc)),
    };
  }
  return {
    ok: true,
    mode: "local-fallback",
    ...localWorkspaceSummary(),
    files: sortedLocalPaths().map((path) => buildWorkspaceFileListingEntry(localAssistantWorkspace.files.get(path))),
  };
}

async function localWorkspaceGraph(options = {}) {
  const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const hasWorkspace = Boolean(localAssistantWorkspace.folderName || localAssistantWorkspace.workspaceId || localAssistantWorkspace.rootPath);
  let files = [];
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState() && workspaceId) {
    files = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    // Fall back to RAM if the store returned nothing but we have local data.
    if (files.length === 0 && localAssistantWorkspace.files.size > 0) {
      files = [...localAssistantWorkspace.files.values()];
    }
  } else if (hasWorkspace) {
    files = [...localAssistantWorkspace.files.values()];
  }

  const nodes = [];
  const edges = [];
  const pathToId = new Map();
  for (const file of files) {
    const filePath = toSafePath(file?.path || "");
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;
    const id = file.id || filePath;
    pathToId.set(filePath, id);
    nodes.push({
      id,
      path: filePath,
      name: basename(filePath),
      fileType: file.fileType || "unknown",
      size: Number(file.originalSize || 0),
    });
  }

  for (const file of files) {
    const filePath = toSafePath(file?.path || "");
    const fromId = pathToId.get(filePath);
    if (!fromId || !Array.isArray(file?.dependencies)) continue;
    for (const depPath of file.dependencies) {
      const toId = pathToId.get(depPath);
      if (toId) edges.push({ from: fromId, to: toId });
    }
  }

  return {
    ok: true,
    workspaceId,
    // Signal whether a workspace is open at all — lets the frontend show
    // "indexing" vs "open a folder" for the empty-node case.
    hasWorkspace,
    nodes,
    edges,
  };
}

async function localWorkspaceFile(pathInput, viewMode = "original", viewOptions = {}) {
  const requested = toSafePath(pathInput);
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(viewOptions.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
    const meta = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (!meta) {
      return { ok: false, error: "File not found in selected workspace" };
    }
    if (String(meta.status || "").toLowerCase() !== "completed") {
      return { ok: false, error: "File is still indexing. Please retry in a moment.", indexing: true };
    }
    const opened = await buildWorkspaceFileView(meta, viewMode, {
      path: requested,
      tier: viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || "",
      query: viewOptions.query || viewOptions.focus || "",
      focus: viewOptions.focus || viewOptions.query || "",
      readUrl: meta?.storage?.provider === "azure-blob" ? buildWorkspaceBlobReadUrl(meta.storage) : "",
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: meta.folderName || localAssistantWorkspace.folderName,
      sessionId: meta.sessionId || localAssistantWorkspace.sessionId,
    });
    return {
      ...opened,
      mode: "local-fallback",
    };
  }
  const meta = localAssistantWorkspace.files.get(requested);
  if (!meta) {
    return { ok: false, error: "File not found in selected workspace" };
  }

  if (!workspaceRecordIndexed(meta)) {
    return { ok: false, error: "File is still indexing. Please retry in a moment.", indexing: true };
  }

  const opened = await buildWorkspaceFileView(meta, viewMode, {
    path: requested,
    tier: viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || "",
    query: viewOptions.query || viewOptions.focus || "",
    focus: viewOptions.focus || viewOptions.query || "",
    readUrl: meta?.storage?.provider === "azure-blob" ? buildWorkspaceBlobReadUrl(meta.storage) : "",
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
  });
  return {
    ...opened,
    mode: "local-fallback",
  };
}

async function localWorkspaceSave(pathInput, nextContent) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) {
    return { ok: false, error: "Invalid file path" };
  }

  const normalized = typeof nextContent === "string" ? nextContent : String(nextContent || "");
  if (isLocalPathWorkspaceState()) {
    return writeLocalWorkspaceFileToDisk(requested, normalized, { overwrite: true });
  }
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    const packed = existing?.storage?.provider === "azure-blob"
      ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
        storage: existing.storage,
        writeToBlob: true,
      })
      : await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
        storage: localWorkspaceUploadBlobStorageForPath(requested),
        writeToBlob: true,
      });
    await workspaceMetadataStore.upsertWorkspaceFileRecord({
      workspaceId,
      sessionId: localAssistantWorkspace.sessionId,
      folderName: localAssistantWorkspace.folderName || "workspace",
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      path: requested,
      record: packed,
      status: "completed",
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: localAssistantWorkspace.folderName || "workspace",
      sessionId: localAssistantWorkspace.sessionId,
    });
    return {
      ok: true,
      mode: "local-fallback",
      path: requested,
      originalSize: Number(packed.originalSize || 0),
      compressedSize: Number(packed.compressedSize || 0),
      capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0),
      transportBytes: Number(packed.compressionStats?.transportBytes || 0),
      updatedAt: localAssistantWorkspace.indexedAt,
    };
  }

  const existing = localAssistantWorkspace.files.get(requested);
  const packed = existing?.storage?.provider === "azure-blob"
    ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
      storage: existing.storage,
      writeToBlob: true,
    })
    : await packLocalWorkspaceContent(requested, normalized);

  localAssistantWorkspace.files.set(requested, {
    path: requested,
    ...packed,
    kind: "source",
  });

  if (!localAssistantWorkspace.folderName) {
    localAssistantWorkspace.folderName = "workspace";
  }
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return {
    ok: true,
    mode: "local-fallback",
    path: requested,
    originalSize: Number(packed.originalSize || 0),
    compressedSize: Number(packed.compressedSize || 0),
    capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0),
    transportBytes: Number(packed.compressionStats?.transportBytes || 0),
    updatedAt: localAssistantWorkspace.indexedAt,
  };
}

async function localWorkspaceCreate(pathInput, nextContent, options = {}) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) {
    return { ok: false, error: "Invalid file path" };
  }

  const overwrite = Boolean(options?.overwrite);
  const existed = localAssistantWorkspace.files.has(requested);
  if (existed && !overwrite) {
    return { ok: false, error: "File already exists" };
  }

  const normalized = typeof nextContent === "string" ? nextContent : String(nextContent || "");
  if (isLocalPathWorkspaceState()) {
    const result = await writeLocalWorkspaceFileToDisk(requested, normalized, { overwrite });
    if (result.ok === false) return result;
    return {
      ...result,
      created: !existed,
      overwritten: existed,
    };
  }
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (existing && !overwrite) {
      return { ok: false, error: "File already exists" };
    }
    const packed = existing?.storage?.provider === "azure-blob"
      ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
        storage: existing.storage,
        writeToBlob: true,
      })
      : await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
        storage: localWorkspaceUploadBlobStorageForPath(requested),
        writeToBlob: true,
      });
    await workspaceMetadataStore.upsertWorkspaceFileRecord({
      workspaceId,
      sessionId: localAssistantWorkspace.sessionId,
      folderName: localAssistantWorkspace.folderName || "workspace",
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      path: requested,
      record: packed,
      status: "completed",
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: localAssistantWorkspace.folderName || "workspace",
      sessionId: localAssistantWorkspace.sessionId,
    });
    return {
      ok: true,
      mode: "local-fallback",
      path: requested,
      created: !existing,
      overwritten: Boolean(existing),
      originalSize: Number(packed.originalSize || 0),
      compressedSize: Number(packed.compressedSize || 0),
      capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0),
      transportBytes: Number(packed.compressionStats?.transportBytes || 0),
      updatedAt: localAssistantWorkspace.indexedAt,
    };
  }

  const existing = localAssistantWorkspace.files.get(requested);
  const packed = existing?.storage?.provider === "azure-blob"
    ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
      storage: existing.storage,
      writeToBlob: true,
    })
    : await packLocalBlobBackedWorkspaceRecord(requested, normalized, {
      storage: localWorkspaceUploadBlobStorageForPath(requested),
      writeToBlob: true,
    });

  localAssistantWorkspace.files.set(requested, {
    path: requested,
    ...packed,
    kind: "source",
  });

  if (!localAssistantWorkspace.folderName) {
    localAssistantWorkspace.folderName = "workspace";
  }
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return {
    ok: true,
    mode: "local-fallback",
    path: requested,
    created: !existed,
    overwritten: existed,
    originalSize: Number(packed.originalSize || 0),
    compressedSize: Number(packed.compressedSize || 0),
    capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0),
    transportBytes: Number(packed.compressionStats?.transportBytes || 0),
    updatedAt: localAssistantWorkspace.indexedAt,
  };
}

function buildWorkspaceQueryContext(rawQuery) {
  const rawText = String(rawQuery || "").toLowerCase();
  return {
    rawText,
    compactText: compactAlphaNumeric(rawText),
    tokens: extractSearchTokens(rawText),
  };
}

async function localWorkspaceSearch(queryInput, options = {}) {
  const q = String(queryInput || "").trim();
  const limit = Math.min(Math.max(Number(options.limit) || 12, 1), 50);
  const extensionHints = extractQueryExtensionHints(q);
  const queryContext = buildWorkspaceQueryContext(q);

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    let matches = docs
      .map((meta) => ({
        path: meta.path,
        name: basename(meta.path),
        score: q ? sharedScorePathForQuery(meta.path, queryContext) : 1,
        indexed: workspaceRecordIndexed(meta),
        originalSize: Number(meta?.originalSize || 0),
        compressedSize: Number(meta?.compressedSize || 0),
        kind: meta?.kind || (workspaceRecordIndexed(meta) ? "source" : "pending"),
        fileType: String(meta?.fileType || ""),
        parseOk: Boolean(meta?.parseOk),
        parserFamily: String(meta?.parserFamily || ""),
        capsuleMode: String(meta?.capsuleMode || ""),
        status: String(meta?.status || ""),
      }))
      .filter((entry) => !q || entry.score > 0);

    if (extensionHints.size > 0) {
      const filtered = matches.filter((entry) => sharedPathHasExtensionHint(entry.path, extensionHints));
      if (filtered.length > 0) matches = filtered;
    }

    matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));

    return {
      ok: true,
      mode: "local-fallback",
      query: q,
      limit,
      matches: matches.slice(0, limit),
      total: matches.length,
    };
  }

  let matches = sortedLocalPaths()
    .map((path) => {
      const meta = localAssistantWorkspace.files.get(path);
      return {
        path,
        name: basename(path),
        score: q ? sharedScorePathForQuery(path, queryContext) : 1,
        indexed: workspaceRecordIndexed(meta),
        originalSize: Number(meta?.originalSize || 0),
        compressedSize: Number(meta?.compressedSize || 0),
        kind: meta?.kind || (workspaceRecordIndexed(meta) ? "source" : "pending"),
        fileType: String(meta?.fileType || ""),
        parseOk: Boolean(meta?.parseOk),
        parserFamily: String(meta?.parserFamily || ""),
        capsuleMode: String(meta?.capsuleMode || ""),
      };
    })
    .filter((entry) => !q || entry.score > 0);

  if (extensionHints.size > 0) {
    const filtered = matches.filter((entry) => sharedPathHasExtensionHint(entry.path, extensionHints));
    if (filtered.length > 0) matches = filtered;
  }

  matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path));

  return {
    ok: true,
    mode: "local-fallback",
    query: q,
    limit,
    matches: matches.slice(0, limit),
    total: matches.length,
  };
}

function findMatchesInText(content, query, options = {}) {
  const text = String(content || "");
  const needle = String(query || "");
  if (!text || !needle) return [];

  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const caseSensitive = options.caseSensitive === true;
  const normalizedNeedle = caseSensitive ? needle : needle.toLowerCase();
  const hits = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = String(lines[i] || "");
    const haystack = caseSensitive ? line : line.toLowerCase();
    let searchIndex = 0;

    while (searchIndex <= haystack.length) {
      const hit = haystack.indexOf(normalizedNeedle, searchIndex);
      if (hit < 0) break;
      hits.push({
        lineNumber: i + 1,
        column: hit + 1,
        line,
        preview: line.trim().slice(0, 240),
      });
      searchIndex = hit + Math.max(1, normalizedNeedle.length);
    }
  }

  return hits;
}

async function localWorkspaceGrep(queryInput, options = {}) {
  const q = String(queryInput || "").trim();
  if (!q) {
    return { ok: false, error: "Search query is required." };
  }

  const limit = Math.min(Math.max(Number(options.limit) || 40, 1), 200);
  const extensionHints = extractQueryExtensionHints(q);
  let scanned = 0;
  const matches = [];

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);

    for (const meta of docs) {
      const path = toSafePath(meta?.path || "");
      if (!path || !workspaceRecordIndexed(meta)) continue;
      if (extensionHints.size > 0 && !sharedPathHasExtensionHint(path, extensionHints)) continue;

      const decoded = await loadLocalWorkspaceRecordText(meta, path);
      const fileHits = findMatchesInText(decoded, q, options);
      scanned += 1;

      for (const hit of fileHits) {
        matches.push({ path, ...hit });
        if (matches.length >= limit) {
          return {
            ok: true,
            mode: "local-fallback",
            query: q,
            limit,
            scannedFiles: scanned,
            matches,
            truncated: true,
          };
        }
      }
    }

    return {
      ok: true,
      mode: "local-fallback",
      query: q,
      limit,
      scannedFiles: scanned,
      matches,
      truncated: false,
    };
  }

  for (const path of sortedLocalPaths()) {
    const meta = localAssistantWorkspace.files.get(path);
    if (!workspaceRecordIndexed(meta)) continue;
    if (extensionHints.size > 0 && !sharedPathHasExtensionHint(path, extensionHints)) continue;

    const ensured = await ensureLocalWorkspaceMeta(meta, path);
    const decoded = decodeRawStorage(ensured.rawStorage);
    const fileHits = findMatchesInText(decoded, q, options);
    scanned += 1;

    for (const hit of fileHits) {
      matches.push({ path, ...hit });
      if (matches.length >= limit) {
        return {
          ok: true,
          mode: "local-fallback",
          query: q,
          limit,
          scannedFiles: scanned,
          matches,
          truncated: true,
        };
      }
    }
  }

  return {
    ok: true,
    mode: "local-fallback",
    query: q,
    limit,
    scannedFiles: scanned,
    matches,
    truncated: false,
  };
}

async function localWorkspaceRename(fromPathInput, toPathInput, options = {}) {
  const fromPath = ensureWorkspaceOwnedPath(fromPathInput, localAssistantWorkspace.folderName);
  const toPath = ensureWorkspaceOwnedPath(toPathInput, localAssistantWorkspace.folderName);
  const overwrite = Boolean(options.overwrite);

  if (!fromPath || !toPath || fromPath.endsWith("/") || toPath.endsWith("/")) {
    return { ok: false, error: "Invalid rename path." };
  }
  if (fromPath === toPath) {
    return { ok: false, error: "Source and target paths are identical." };
  }

  const source = localAssistantWorkspace.files.get(fromPath);
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const sourceDoc = await workspaceMetadataStore.getWorkspaceFile(workspaceId, fromPath);
    if (!sourceDoc) return { ok: false, error: "Source file not found." };
    const targetDoc = await workspaceMetadataStore.getWorkspaceFile(workspaceId, toPath);
    if (targetDoc && !overwrite) return { ok: false, error: "Target file already exists." };
    const targetStorage = localWorkspaceUploadBlobStorageForPath(toPath);
    if (!targetStorage) return { ok: false, error: "Target blob path is invalid." };
    if (targetDoc?.storage?.provider === "azure-blob" && overwrite) {
      await deleteWorkspaceBlob(targetDoc.storage);
    }
    await copyWorkspaceBlob(sourceDoc.storage, targetStorage);
    await deleteWorkspaceBlob(sourceDoc.storage);
    await workspaceMetadataStore.upsertWorkspaceFileRecord({
      workspaceId,
      sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
      folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || "workspace",
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      path: toPath,
      record: {
        ...sourceDoc,
        path: toPath,
        storage: targetStorage,
      },
      status: String(sourceDoc.status || "completed").toLowerCase() === "completed" ? "completed" : "pending",
    });
    await workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, fromPath, {
      folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || "workspace",
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: sourceDoc.folderName || localAssistantWorkspace.folderName || "workspace",
      sessionId: sourceDoc.sessionId || localAssistantWorkspace.sessionId,
    });
    return {
      ok: true,
      mode: "local-fallback",
      fromPath,
      toPath,
      overwritten: overwrite,
      updatedAt: localAssistantWorkspace.indexedAt,
    };
  }
  if (!source) {
    return { ok: false, error: "Source file not found." };
  }
  if (localAssistantWorkspace.files.has(toPath) && !overwrite) {
    return { ok: false, error: "Target file already exists." };
  }

  if (isLocalPathWorkspaceState()) {
    const sourceInfo = resolveLocalWorkspaceAbsolutePath(fromPath);
    const targetInfo = resolveLocalWorkspaceAbsolutePath(toPath);
    if (!overwrite) {
      try {
        await fs.promises.access(targetInfo.absolutePath, fs.constants.F_OK);
        return { ok: false, error: "Target file already exists." };
      } catch {
        // Target absent.
      }
    }
    await fs.promises.mkdir(path.dirname(targetInfo.absolutePath), { recursive: true });
    await fs.promises.rename(sourceInfo.absolutePath, targetInfo.absolutePath);
  } else if (source?.storage?.provider === "azure-blob") {
    const targetStorage = localWorkspaceUploadBlobStorageForPath(toPath);
    if (!targetStorage) {
      return { ok: false, error: "Target blob path is invalid." };
    }
    if (localAssistantWorkspace.files.has(toPath) && overwrite) {
      const existingTarget = localAssistantWorkspace.files.get(toPath);
      if (existingTarget?.storage?.provider === "azure-blob") {
        await deleteWorkspaceBlob(existingTarget.storage);
      }
    }
    await copyWorkspaceBlob(source.storage, targetStorage);
    await deleteWorkspaceBlob(source.storage);
    source.storage = targetStorage;
  }

  localAssistantWorkspace.files.delete(fromPath);
  localAssistantWorkspace.files.set(toPath, {
    ...source,
    path: toPath,
  });
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return {
    ok: true,
    mode: "local-fallback",
    fromPath,
    toPath,
    overwritten: overwrite,
    updatedAt: localAssistantWorkspace.indexedAt,
  };
}

async function localWorkspaceDelete(pathInput) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) {
    return { ok: false, error: "Invalid file path." };
  }
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (!existing) return { ok: false, error: "File not found." };
    if (existing.storage?.provider === "azure-blob") {
      await deleteWorkspaceBlob(existing.storage);
    }
    await workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, requested, {
      folderName: existing.folderName || localAssistantWorkspace.folderName || "workspace",
      rootPath: "",
      sourceKind: WORKSPACE_SOURCE_UPLOAD,
      sessionId: existing.sessionId || localAssistantWorkspace.sessionId,
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, {
      folderName: existing.folderName || localAssistantWorkspace.folderName || "workspace",
      sessionId: existing.sessionId || localAssistantWorkspace.sessionId,
    });
    return {
      ok: true,
      mode: "local-fallback",
      path: requested,
      deleted: true,
      updatedAt: localAssistantWorkspace.indexedAt,
    };
  }
  if (!localAssistantWorkspace.files.has(requested)) {
    return { ok: false, error: "File not found." };
  }

  if (isLocalPathWorkspaceState()) {
    const { absolutePath } = resolveLocalWorkspaceAbsolutePath(requested);
    await fs.promises.rm(absolutePath, { force: false });
  } else {
    const existing = localAssistantWorkspace.files.get(requested);
    if (existing?.storage?.provider === "azure-blob") {
      await deleteWorkspaceBlob(existing.storage);
    }
  }

  localAssistantWorkspace.files.delete(requested);
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return {
    ok: true,
    mode: "local-fallback",
    path: requested,
    deleted: true,
    updatedAt: localAssistantWorkspace.indexedAt,
  };
}

async function localWorkspaceBatch(operations = [], options = {}) {
  const safeOperations = Array.isArray(operations) ? operations : [];
  const results = [];
  const stopOnError = options.stopOnError !== false;

  for (const operation of safeOperations) {
    const type = String(operation?.type || "").trim().toLowerCase();
    let result;

    if (type === "write" || type === "save") {
      result = await localWorkspaceSave(operation.path, operation.content);
    } else if (type === "create") {
      result = await localWorkspaceCreate(operation.path, operation.content, { overwrite: Boolean(operation.overwrite) });
    } else if (type === "rename") {
      result = await localWorkspaceRename(operation.fromPath, operation.toPath, { overwrite: Boolean(operation.overwrite) });
    } else if (type === "delete") {
      result = await localWorkspaceDelete(operation.path);
    } else {
      result = { ok: false, error: `Unsupported batch operation "${type}".` };
    }

    results.push({
      type,
      ok: result?.ok !== false,
      ...result,
    });

    if (result?.ok === false && stopOnError) break;
  }

  return {
    ok: !results.some((entry) => entry.ok === false),
    mode: "local-fallback",
    results,
    appliedCount: results.filter((entry) => entry.ok !== false).length,
    failedCount: results.filter((entry) => entry.ok === false).length,
  };
}

async function localGitStatus() {
  const branch = (await runLocalGit(["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
  const statusRaw = (await runLocalGit(["status", "--porcelain=v1"])).stdout;
  const lines = statusRaw ? statusRaw.split("\n") : [];
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const file = workspacePathFromGitPath(line.slice(3).split(" -> ").pop());
    if (!file) continue;

    if (x === "?" && y === "?") {
      untracked.push(file);
      continue;
    }
    if (x !== " " && x !== "?") staged.push({ file, status: x });
    if (y !== " " && y !== "?") unstaged.push({ file, status: y });
  }

  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await runLocalGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])).stdout;
    const parts = counts.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  } catch {
    // Upstream not configured.
  }

  return { ok: true, branch, staged, unstaged, untracked, ahead, behind };
}

async function ingestWorkspaceChunkFromOffload(payload = {}, context = {}) {
  const azureBlob = workspaceOffloadConfig.azureBlob || {};
  if (!azureBlob.enabled) {
    throw new Error("Azure workspace offload is not configured on this gateway.");
  }

  const folderName = String(payload?.folderName || "workspace").trim() || "workspace";
  const workspaceId = String(payload?.workspaceId || "").trim();
  const sessionId = String(payload?.sessionId || "").trim();
  const append = Boolean(payload?.append);
  const providedFiles = Array.isArray(payload?.files) ? payload.files : [];

  if (providedFiles.length) {
    const files = [];
    for (const candidate of providedFiles) {
      const filePath = toSafePath(candidate?.path || candidate?.name || "");
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

    if (!files.length) {
      throw new Error("Azure offload manifest has no usable files.");
    }

    const selectPayload = {
      folderName,
      workspaceId,
      sessionId,
      manifest: files.map((file) => ({
        path: file.path,
        sizeBytes: file.sizeBytes,
        lastModified: file.lastModified,
        storage: file.storage,
      })),
      files: files.map((file) => ({
        path: file.path,
        sizeBytes: file.sizeBytes,
        lastModified: file.lastModified,
        storage: {
          ...file.storage,
          readUrl: buildWorkspaceBlobReadUrl(file.storage),
        },
      })),
      append,
      sync: payload?.sync === true,
    };

    if (shouldQueueWorkspaceSelectPayload(selectPayload)) {
      const queuedJob = enqueueWorkspaceSelectJob(selectPayload, {
        userId: context?.userId,
      });

      return {
        ...buildWorkspaceSelectAcceptedResponse(queuedJob),
        offload: true,
        chunkFileCount: files.length,
        blobManifest: true,
      };
    }

    const result = await executeWorkspaceSelectWithFallback(selectPayload);
    return {
      ...result,
      offload: true,
      chunkFileCount: files.length,
      blobManifest: true,
    };
  }

  const blobPath = toSafePath(payload?.blobPath || payload?.path || "");
  if (!blobPath) {
    throw new Error("blobPath is required.");
  }

  const blobUrl = buildAzureBlobAbsoluteUrl(
    azureBlob.baseUrl,
    azureBlob.container,
    blobPath,
    azureBlob.ingestSasToken,
  );

  const response = await fetch(blobUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Azure offload download failed (${response.status}).`);
  }

  let chunkPayload;
  try {
    chunkPayload = await response.json();
  } catch {
    throw new Error("Azure offload payload is not valid JSON.");
  }

  const candidateFiles = Array.isArray(chunkPayload?.files) ? chunkPayload.files : [];
  const files = [];
  for (const candidate of candidateFiles) {
    const filePath = toSafePath(candidate?.path || candidate?.name || "");
    if (!filePath) continue;
    const normalized = normalizeIncomingWorkspacePreindexedFile(candidate, filePath);
    if (normalized?.rawStorage || normalized?.transportEnvelope || normalized?.capsuleCache || normalized?.compressedBase64) {
      files.push(normalized);
      continue;
    }
    const content = typeof candidate?.content === "string" ? candidate.content : String(candidate?.content || "");
    files.push({ path: filePath, content });
  }

  if (!files.length) {
    throw new Error("Azure offload chunk has no usable files.");
  }

  const selectPayload = {
    folderName: String(chunkPayload?.folderName || folderName),
    workspaceId: String(chunkPayload?.workspaceId || workspaceId),
    sessionId: String(chunkPayload?.sessionId || sessionId),
    files,
    append: Boolean(chunkPayload?.append ?? append),
    sync: payload?.sync === true || chunkPayload?.sync === true,
  };

  if (shouldQueueWorkspaceSelectPayload(selectPayload)) {
    const queuedJob = enqueueWorkspaceSelectJob(selectPayload, {
      userId: context?.userId,
    });

    return {
      ...buildWorkspaceSelectAcceptedResponse(queuedJob),
      offload: true,
      blobPath,
      chunkFileCount: files.length,
    };
  }

  const result = await executeWorkspaceSelectWithFallback(selectPayload);
  return {
    ...result,
    offload: true,
    blobPath,
    chunkFileCount: files.length,
    blobManifest: false,
  };
}

async function localResolveReferencedFiles(lastUserMessage) {
  const hasUploadWorkspace = workspaceMetadataStore.enabled && isUploadWorkspaceState();
  if (!hasUploadWorkspace && localAssistantWorkspace.files.size === 0) return [];

  const queryText = String(lastUserMessage || "");
  const extensionHints = extractQueryExtensionHints(queryText);

  let candidatePaths = [];
  if (hasUploadWorkspace) {
    const docs = await workspaceMetadataStore.listWorkspaceFiles(localAssistantWorkspace.workspaceId);
    candidatePaths = docs
      .filter((meta) => workspaceRecordIndexed(meta))
      .map((meta) => toSafePath(meta?.path || ""))
      .filter(Boolean);
  } else {
    candidatePaths = sortedLocalPaths().filter((path) => {
      const meta = localAssistantWorkspace.files.get(path);
      return workspaceRecordIndexed(meta);
    });
  }

  if (extensionHints.size > 0) {
    const filtered = candidatePaths.filter((path) => pathHasExtensionHint(path, extensionHints));
    if (filtered.length > 0) candidatePaths = filtered;
  }

  const maxMatches = selectReferenceMatchLimit(queryText, extensionHints);
  return rankWorkspacePathsForQuery(queryText, candidatePaths, maxMatches);
}

const QUERY_EXTENSION_HINTS = {
  html: ["html", "htm"],
  htm: ["html", "htm"],
  css: ["css", "scss", "less"],
  scss: ["css", "scss", "less"],
  less: ["css", "scss", "less"],
  js: ["js", "mjs", "cjs"],
  javascript: ["js", "mjs", "cjs"],
  ts: ["ts", "tsx"],
  typescript: ["ts", "tsx"],
  json: ["json"],
  md: ["md", "markdown"],
  markdown: ["md", "markdown"],
  py: ["py"],
  python: ["py"],
  xml: ["xml"],
  yml: ["yml", "yaml"],
  yaml: ["yml", "yaml"],
  txt: ["txt"],
  pdf: ["pdf"],
};

const SINGLE_FILE_LOOKUP_RE = /\b(was\s+ist\s+in|what(?:'s|\s+is)?\s+in|inhalt|contents?|summar(?:y|ize)|überblick|ueberblick|overview|erklär|erklaer|explain|describe|zeige\s+mir)\b/i;
const MULTI_FILE_LOOKUP_RE = /\b(vergleich|compare|all|alle|mehrere|multiple|both|beide|zusammen)\b/i;

function extractQueryExtensionHints(input) {
  const text = String(input || "").toLowerCase();
  const hints = new Set();

  const explicitExtMatches = text.match(/\.[a-z0-9]{2,6}\b/g) || [];
  for (const match of explicitExtMatches) {
    const ext = match.slice(1);
    (QUERY_EXTENSION_HINTS[ext] || [ext]).forEach((value) => hints.add(value));
  }

  for (const [token, mapped] of Object.entries(QUERY_EXTENSION_HINTS)) {
    if (!new RegExp(`\\b${escapeRegexLiteral(token)}\\b`, "i").test(text)) continue;
    mapped.forEach((value) => hints.add(value));
  }

  return hints;
}

function pathHasExtensionHint(pathInput, extensionHints = new Set()) {
  if (!(extensionHints instanceof Set) || extensionHints.size === 0) return true;
  const normalized = toSafePath(pathInput).toLowerCase();
  const dotIdx = normalized.lastIndexOf(".");
  if (dotIdx < 0 || dotIdx === normalized.length - 1) return false;
  const ext = normalized.slice(dotIdx + 1);
  return extensionHints.has(ext);
}

function selectReferenceMatchLimit(lastUserMessage, extensionHints = new Set()) {
  const text = String(lastUserMessage || "");
  if (!text) return 1;
  if (MULTI_FILE_LOOKUP_RE.test(text)) return 3;
  if (extensionHints.size > 0) return 1;
  if (SINGLE_FILE_LOOKUP_RE.test(text)) return 1;
  return 3;
}

const BROAD_CHANGE_INTENT_RE = /\b(refactor|rewrite|rework|update|change|modify|implement|build|add|create|fix|bug|issue|across|project|repository|repo|codebase|architektur|architecture)\b/i;

function resolveAdaptiveCompressedContextBudget({ lastUserMessage, hasActiveFileFocus }) {
  const text = String(lastUserMessage || "");
  const extensionHints = extractQueryExtensionHints(text);
  const multiFileIntent = MULTI_FILE_LOOKUP_RE.test(text);
  const broadChangeIntent = BROAD_CHANGE_INTENT_RE.test(text);
  const singleFileIntent = !multiFileIntent && (hasActiveFileFocus || extensionHints.size > 0 || SINGLE_FILE_LOOKUP_RE.test(text));

  if (singleFileIntent && !broadChangeIntent) {
    return {
      mode: "single-file",
      maxFiles: 1,
      maxModelCompressedChars: 4200,
      firstFileMaxModelCompressedChars: 6500,
      maxDecodedChars: 5600,
      firstFileMaxDecodedChars: 9000,
      maxTotalDecodedChars: 10000,
      disableCodecDictionary: true,
    };
  }

  if (hasActiveFileFocus && !multiFileIntent) {
    return {
      mode: "active-file",
      maxFiles: 2,
      maxModelCompressedChars: 7000,
      firstFileMaxModelCompressedChars: 12000,
      maxDecodedChars: 9000,
      firstFileMaxDecodedChars: 18000,
      maxTotalDecodedChars: 26000,
      disableCodecDictionary: true,
    };
  }

  if (multiFileIntent || broadChangeIntent) {
    return {
      mode: "broad",
      maxFiles: 3,
      maxModelCompressedChars: 18000,
      firstFileMaxModelCompressedChars: 32000,
      maxDecodedChars: 24000,
      firstFileMaxDecodedChars: 42000,
      maxTotalDecodedChars: 90000,
      disableCodecDictionary: false,
    };
  }

  return {
    mode: "balanced",
    maxFiles: 2,
    maxModelCompressedChars: 12000,
    firstFileMaxModelCompressedChars: 22000,
    maxDecodedChars: 16000,
    firstFileMaxDecodedChars: 30000,
    maxTotalDecodedChars: 52000,
    disableCodecDictionary: false,
  };
}

const FILE_QUERY_STOP_WORDS = new Set([
  "a", "an", "and", "are", "bei", "bitte", "das", "datei", "dem", "den", "der", "die", "dir",
  "doch", "ein", "eine", "einer", "es", "file", "files", "for", "gib", "give", "hat", "help",
  "ich", "im", "in", "inhalt", "is", "ist", "it", "kannst", "mir", "mit", "oder", "show",
  "the", "und", "uns", "was", "what", "wie", "wo", "worum", "you", "zu",
]);

function extractSearchTokens(input) {
  const text = String(input || "").toLowerCase();
  const rawTokens = text.split(/[^a-z0-9]+/g).filter(Boolean);
  return rawTokens
    .filter((token) => token.length >= 3)
    .filter((token) => !FILE_QUERY_STOP_WORDS.has(token));
}

function compactAlphaNumeric(input) {
  return String(input || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scorePathForQuery(pathInput, queryContext) {
  const pathValue = toSafePath(pathInput).toLowerCase();
  if (!pathValue) return 0;

  const base = basename(pathValue).toLowerCase();
  const pathCompact = compactAlphaNumeric(pathValue);
  const baseCompact = compactAlphaNumeric(base);
  const pathTokens = pathValue.split(/[^a-z0-9]+/g).filter(Boolean);
  const pathTokenSet = new Set(pathTokens);

  const { rawText, compactText, tokens } = queryContext;
  if (!rawText || (!tokens.length && compactText.length < 4)) return 0;

  let score = 0;
  let matchedTokens = 0;

  if (rawText.includes(base)) score += 120;
  if (rawText.includes(pathValue)) score += 140;
  if (compactText && baseCompact && compactText.includes(baseCompact)) score += 90;
  if (compactText && pathCompact && compactText.includes(pathCompact)) score += 110;
  if (compactText && pathCompact && pathCompact.includes(compactText) && compactText.length >= 4) score += 85;

  for (const token of tokens) {
    if (pathTokenSet.has(token)) {
      score += 28;
      matchedTokens += 1;
      continue;
    }

    if (pathCompact.includes(token)) {
      score += 14;
      matchedTokens += 1;
    }
  }

  if (tokens.length > 0 && matchedTokens === tokens.length) score += 60;
  if (matchedTokens >= 2) score += 30;
  if (matchedTokens === 0 && score < 80) return 0;
  return score;
}

function rankWorkspacePathsForQuery(lastUserMessage, candidatePaths = [], maxMatches = 3) {
  const rawText = String(lastUserMessage || "").toLowerCase();
  if (!rawText) return [];

  const queryContext = {
    rawText,
    compactText: compactAlphaNumeric(rawText),
    tokens: extractSearchTokens(rawText),
  };

  const ranked = [];
  for (const pathValue of Array.isArray(candidatePaths) ? candidatePaths : []) {
    const safePath = toSafePath(pathValue);
    if (!safePath) continue;

    const score = scorePathForQuery(safePath, queryContext);
    if (score <= 0) continue;
    ranked.push({ path: safePath, score });
  }

  return ranked
    .sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
    .slice(0, Math.max(1, Number(maxMatches) || 3))
    .map((item) => item.path);
}

async function inferReferencedFilesFromWorkspace(lastUserMessage) {
  const text = String(lastUserMessage || "").trim();
  if (!text) return [];

  const extensionHints = extractQueryExtensionHints(text);
  const maxMatches = selectReferenceMatchLimit(text, extensionHints);

  let files = [];
  try {
    const result = await meshTunnelRequest("workspace.files", {});
    files = Array.isArray(result?.files) ? result.files : [];
  } catch {
    const local = await localWorkspaceFiles();
    files = Array.isArray(local?.files) ? local.files : [];
  }

  let indexedPaths = files
    .filter((entry) => entry?.indexed !== false)
    .map((entry) => toSafePath(entry?.path || entry?.name || ""))
    .filter(Boolean);

  if (extensionHints.size > 0) {
    const filtered = indexedPaths.filter((path) => pathHasExtensionHint(path, extensionHints));
    if (filtered.length > 0) indexedPaths = filtered;
  }

  return rankWorkspacePathsForQuery(text, indexedPaths, maxMatches);
}

async function localAssistantReply(model, messages) {
  const lastUserMessage = messages.filter((m) => m?.role === "user").at(-1)?.content || "";
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
      content: `I loaded these workspace files from local fallback mode: ${referencedFiles.join(", ")}. I can now review or explain them.`,
      referencedFiles,
      model,
      mode: "local-fallback",
    };
  }

  if (totalFiles > 0) {
    if (indexedFiles === 0) {
      return {
        content: `Local workspace "${localAssistantWorkspace.folderName}" is connected. File tree is ready and content indexing is running in the background (0/${totalFiles} files ready).`,
        referencedFiles: [],
        model,
        mode: "local-fallback",
      };
    }

    return {
      content: `Local workspace \"${localAssistantWorkspace.folderName}\" is indexing in the background (${indexedFiles}/${totalFiles} files ready). Mention a filename and I will inspect it.`,
      referencedFiles: [],
      model,
      mode: "local-fallback",
    };
  }

  return {
    content: mockReply(lastUserMessage),
    referencedFiles: [],
    model,
    mode: "local-fallback",
  };
}

module.exports = {
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
};
