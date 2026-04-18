'use strict';

/**
 * Workspace file CRUD operations — select, open, read, save, create.
 * Stateful functions use globals injected by core/index.js at boot.
 */

const logger = require('../../logger');
const {
  mapWithConcurrency,
  createWorkspacePerfTracker,
  isWorkspaceIndexablePath,
} = require('../workspace-infrastructure');
const {
  WORKSPACE_RECORD_VERSION,
  buildWorkspaceFileRecord,
  buildWorkspaceFileView,
  ensureWorkspaceFileRecord,
} = require('../../../mesh-core/src/compression-core.cjs');

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
      logger.error('Local enrichment failed', { scope: 'workspace-ops', error: String(error?.message || error) });
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
      if (meta?.storage?.provider === "s3") {
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
        storage: meta?.storage?.provider === "s3" ? meta.storage : undefined,
        truncated,
        persistRawContent: meta?.storage?.provider === "s3" ? false : undefined,
        persistTransportChunks: meta?.storage?.provider === "s3" ? false : undefined,
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
    await syncLocalUploadWorkspaceSummary(workspaceId, { folderName, sessionId: localAssistantWorkspace.sessionId });
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
    localAssistantWorkspace.files.set(meta.path, { ...packed, path: meta.path, kind: "source" });
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
    return { ok: true, mode: "local-fallback", cleared: true, folderName: null, rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD, append: false, chunkFileCount: 0, fileCount: 0, originalBytes: 0, compressedBytes: 0, ratio: null };
  }

  const folderName = String(data?.folderName || "workspace");
  const workspaceId = String(data?.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const sessionId = String(data?.sessionId || localAssistantWorkspace.sessionId || "").trim();
  const manifestEntries = Array.isArray(data?.manifest) ? data.manifest : [];
  const incomingFiles = Array.isArray(data?.files) ? data.files : [];
  const deletedPaths = Array.isArray(data?.deletedPaths) ? data.deletedPaths.map((entry) => toSafePath(entry)).filter(Boolean) : [];
  const syncMode = String(data?.mode || "background").trim().toLowerCase() || "background";
  const candidateEntries = (manifestEntries.length ? manifestEntries : incomingFiles).filter((entry) => isWorkspaceIndexablePath(entry?.path || entry?.name || ""));
  const append = Boolean(data?.append);

  if (workspaceMetadataStore.enabled && workspaceId) {
    const seededFiles = candidateEntries.map((entry) => {
      const filePath = toSafePath(entry?.path || entry?.name);
      if (!filePath) return null;
      return { path: filePath, sizeBytes: Number(entry?.sizeBytes ?? entry?.size ?? 0), storage: normalizeWorkspaceBlobStorage(entry?.storage, filePath) };
    }).filter(Boolean);
    if (deletedPaths.length > 0) {
      await Promise.all(deletedPaths.map((filePath) => workspaceMetadataStore.deleteWorkspaceFileRecord(workspaceId, filePath, { folderName, rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD, sessionId })));
    }
    await workspaceMetadataStore.seedWorkspaceManifest({ workspaceId, folderName, rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD, sessionId, files: seededFiles });
    const summary = await syncLocalUploadWorkspaceSummary(workspaceId, { folderName, sessionId });
    enqueueLocalWorkspaceEnrichment({ workspaceId, folderName });
    return {
      ok: true, mode: "local-fallback",
      folderName: localAssistantWorkspace.folderName || folderName, rootPath: "", workspaceId, sessionId,
      sourceKind: WORKSPACE_SOURCE_UPLOAD, status: String(summary?.status || localAssistantWorkspace.status || "processing"),
      append, manifestCount: candidateEntries.length, chunkFileCount: incomingFiles.length,
      fileCount: Number(summary?.fileCountTotal || localAssistantWorkspace.fileCountTotal || seededFiles.length),
      indexedCount: Number(summary?.fileCountCompleted || localAssistantWorkspace.fileCountCompleted || 0),
      pendingCount: Number(summary?.fileCountPending || localAssistantWorkspace.fileCountPending || 0),
      failedCount: Number(summary?.fileCountFailed || localAssistantWorkspace.fileCountFailed || 0),
      originalBytes: 0, compressedBytes: 0, capsuleBytes: 0, transportBytes: 0, ratio: null,
    };
  }

  const canAppend = append && localAssistantWorkspace.folderName === folderName && normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_UPLOAD;

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

  let originalBytes = 0, compressedBytes = 0, capsuleBytes = 0, transportBytes = 0;
  for (const filePath of deletedPaths) { next.delete(filePath); }

  for (const entry of candidateEntries) {
    const filePath = toSafePath(entry?.path || entry?.name);
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;
    const known = next.get(filePath);
    const declaredSize = Number(entry?.sizeBytes ?? entry?.size ?? known?.originalSize ?? 0);
    const normalizedSize = Number.isFinite(declaredSize) && declaredSize >= 0 ? declaredSize : Number(known?.originalSize || 0);
    const storage = normalizeWorkspaceBlobStorage(entry?.storage, filePath);
    if (workspaceRecordIndexed(known)) {
      next.set(filePath, { ...known, originalSize: normalizedSize, ...(storage ? { storage } : {}), kind: "source" });
      continue;
    }
    next.set(filePath, { path: filePath, compressedBase64: "", originalSize: normalizedSize, compressedSize: 0, formatVersion: WORKSPACE_RECORD_VERSION, ...(storage ? { storage, rawStorage: { encoding: "external-s3", rawBytes: normalizedSize } } : {}), kind: "pending" });
  }

  const compressedEntries = await compressLocalWorkspaceChunkFiles(incomingFiles, { recordMode: syncMode === "single-file" ? "full" : "initial" });
  const ensuredEntries = await mapWithConcurrency(compressedEntries, MESH_WORKSPACE_BUILD_CONCURRENCY, async (entry) => {
    const packed = await ensureLocalWorkspaceMeta(entry.packed, entry.filePath);
    return { filePath: entry.filePath, packed };
  });
  for (const { filePath, packed } of ensuredEntries) {
    originalBytes += Number(packed.originalSize || 0);
    compressedBytes += Number(packed.compressedSize || 0);
    capsuleBytes += Number(packed.compressionStats?.capsuleBytes || 0);
    transportBytes += Number(packed.compressionStats?.transportBytes || 0);
    next.set(filePath, { ...packed, path: filePath, kind: "source" });
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
  if (syncMode !== "single-file") enqueueLocalWorkspaceEnrichment({ folderName });

  return {
    ok: true, mode: "local-fallback", folderName, rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD,
    append: canAppend, manifestCount: candidateEntries.length, chunkFileCount: incomingFiles.length,
    fileCount: next.size, indexedCount, pendingCount: Math.max(0, next.size - indexedCount),
    originalBytes, compressedBytes, capsuleBytes, transportBytes,
    ratio: compressedBytes > 0 ? Number((originalBytes / compressedBytes).toFixed(2)) : null,
  };
}

async function localWorkspaceOpenLocal(rootPathInput, options = {}) {
  const rootPath = normalizeAbsoluteRootPath(rootPathInput);
  if (!rootPath) return { ok: false, error: "Workspace root path required." };

  let stats;
  try { stats = await fs.promises.stat(rootPath); } catch { return { ok: false, error: "Workspace root not found." }; }
  if (!stats.isDirectory()) return { ok: false, error: "Workspace root must be a directory." };

  const folderName = String(options.folderName || path.basename(rootPath) || "workspace").trim() || "workspace";
  const perf = createWorkspacePerfTracker("local-open-local", { folderName });
  const files = (await scanLocalWorkspaceFiles(rootPath, folderName)).filter((entry) => isWorkspaceIndexablePath(entry.workspacePath));
  perf.mark("scan-complete", { files: files.length });
  const next = new Map();
  let originalBytes = 0, compressedBytes = 0, capsuleBytes = 0, transportBytes = 0;
  const workspaceFilePaths = files.map((entry) => entry.workspacePath);
  const packedEntries = await mapWithConcurrency(files, MESH_WORKSPACE_BUILD_CONCURRENCY, async (entry) => {
    const content = await readLocalWorkspaceFileText(entry.absolutePath);
    const packed = await packLocalWorkspaceContent(entry.workspacePath, content, { recordMode: "initial", workspaceFilePaths });
    return { ...entry, packed };
  });
  perf.mark("initial-records-ready");

  for (const entry of packedEntries) {
    next.set(entry.workspacePath, { path: entry.workspacePath, ...entry.packed, kind: "source" });
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
    ok: true, mode: "local-fallback", folderName, rootPath, sourceKind: WORKSPACE_SOURCE_LOCAL_PATH,
    append: false, manifestCount: 0, chunkFileCount: files.length, fileCount: next.size, indexedCount: next.size, pendingCount: 0,
    originalBytes, compressedBytes, capsuleBytes, transportBytes,
    ratio: compressedBytes > 0 ? Number((originalBytes / compressedBytes).toFixed(2)) : null,
  };
}

async function localWorkspaceFiles(options = {}) {
  const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const sessionId = String(options.sessionId || localAssistantWorkspace.sessionId || "").trim();
  const folderName = String(options.folderName || localAssistantWorkspace.folderName || "").trim();

  if (workspaceMetadataStore.enabled && isUploadWorkspaceState() && workspaceId) {
    const summary = await syncLocalUploadWorkspaceSummary(workspaceId, { folderName: folderName || localAssistantWorkspace.folderName, sessionId: sessionId || localAssistantWorkspace.sessionId });
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return {
      ok: true, mode: "local-fallback", ...localWorkspaceSummary(),
      workspaceId: workspaceId || localAssistantWorkspace.workspaceId || "",
      sessionId: sessionId || localAssistantWorkspace.sessionId || "",
      folderName: folderName || summary?.folderName || localAssistantWorkspace.folderName || "",
      fileCount: Number(summary?.fileCountTotal || localAssistantWorkspace.fileCountTotal || docs.length),
      files: docs.map((doc) => buildWorkspaceFileListingEntry(doc)),
    };
  }
  return {
    ok: true, mode: "local-fallback", ...localWorkspaceSummary(),
    files: sortedLocalPaths().map((path) => buildWorkspaceFileListingEntry(localAssistantWorkspace.files.get(path))),
  };
}

async function localWorkspaceGraph(options = {}) {
  const workspaceId = String(options.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
  const hasWorkspace = Boolean(localAssistantWorkspace.folderName || localAssistantWorkspace.workspaceId || localAssistantWorkspace.rootPath);
  let files = [];
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState() && workspaceId) {
    files = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    if (files.length === 0 && localAssistantWorkspace.files.size > 0) files = [...localAssistantWorkspace.files.values()];
  } else if (hasWorkspace) {
    files = [...localAssistantWorkspace.files.values()];
  }

  const nodes = [], edges = [];
  const pathToId = new Map();
  for (const file of files) {
    const filePath = toSafePath(file?.path || "");
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;
    const id = file.id || filePath;
    pathToId.set(filePath, id);
    nodes.push({ id, path: filePath, name: basename(filePath), fileType: file.fileType || "unknown", size: Number(file.originalSize || 0) });
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

  return { ok: true, workspaceId, hasWorkspace, nodes, edges };
}

async function localWorkspaceFile(pathInput, viewMode = "original", viewOptions = {}) {
  const requested = toSafePath(pathInput);
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(viewOptions.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
    const meta = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (!meta) return { ok: false, error: "File not found in selected workspace" };
    if (String(meta.status || "").toLowerCase() !== "completed") return { ok: false, error: "File is still indexing. Please retry in a moment.", indexing: true };
    const opened = await buildWorkspaceFileView(meta, viewMode, {
      path: requested, tier: viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || "",
      query: viewOptions.query || viewOptions.focus || "", focus: viewOptions.focus || viewOptions.query || "",
      readUrl: "", legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    });
    await syncLocalUploadWorkspaceSummary(workspaceId, { folderName: meta.folderName || localAssistantWorkspace.folderName, sessionId: meta.sessionId || localAssistantWorkspace.sessionId });
    return { ...opened, mode: "local-fallback" };
  }
  const meta = localAssistantWorkspace.files.get(requested);
  if (!meta) return { ok: false, error: "File not found in selected workspace" };
  if (!workspaceRecordIndexed(meta)) return { ok: false, error: "File is still indexing. Please retry in a moment.", indexing: true };
  const opened = await buildWorkspaceFileView(meta, viewMode, {
    path: requested, tier: viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || "",
    query: viewOptions.query || viewOptions.focus || "", focus: viewOptions.focus || viewOptions.query || "",
    readUrl: "", legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
  });
  return { ...opened, mode: "local-fallback" };
}

async function localWorkspaceSave(pathInput, nextContent) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) return { ok: false, error: "Invalid file path" };

  const normalized = typeof nextContent === "string" ? nextContent : String(nextContent || "");
  if (isLocalPathWorkspaceState()) return writeLocalWorkspaceFileToDisk(requested, normalized, { overwrite: true });
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    const packed = existing?.storage?.provider === "s3"
      ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: existing.storage, writeToBlob: true })
      : await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: localWorkspaceUploadBlobStorageForPath(requested), writeToBlob: true });
    await workspaceMetadataStore.upsertWorkspaceFileRecord({ workspaceId, sessionId: localAssistantWorkspace.sessionId, folderName: localAssistantWorkspace.folderName || "workspace", rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD, path: requested, record: packed, status: "completed" });
    await syncLocalUploadWorkspaceSummary(workspaceId, { folderName: localAssistantWorkspace.folderName || "workspace", sessionId: localAssistantWorkspace.sessionId });
    return { ok: true, mode: "local-fallback", path: requested, originalSize: Number(packed.originalSize || 0), compressedSize: Number(packed.compressedSize || 0), capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0), transportBytes: Number(packed.compressionStats?.transportBytes || 0), updatedAt: localAssistantWorkspace.indexedAt };
  }

  const existing = localAssistantWorkspace.files.get(requested);
  const packed = existing?.storage?.provider === "s3"
    ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: existing.storage, writeToBlob: true })
    : await packLocalWorkspaceContent(requested, normalized);

  // Update workspace symbolMap incrementally for this file
  if (localAssistantWorkspace.symbolMap instanceof Map) {
    for (const [name, entries] of localAssistantWorkspace.symbolMap) {
      const filtered = entries.filter(e => e.file !== requested);
      if (filtered.length === 0) {
        localAssistantWorkspace.symbolMap.delete(name);
      } else {
        localAssistantWorkspace.symbolMap.set(name, filtered);
      }
    }
    for (const sym of (packed.symbols || [])) {
      if (!sym.name) continue;
      const existing = localAssistantWorkspace.symbolMap.get(sym.name) || [];
      existing.push({ file: requested, lineStart: sym.lineStart, lineEnd: sym.lineEnd, kind: sym.kind });
      localAssistantWorkspace.symbolMap.set(sym.name, existing);
    }
    // Re-resolve callSites for this file using updated symbolMap
    const resolvedSites = [];
    const seen = new Set();
    for (const site of (packed.callSites || [])) {
      const key = `${site.calleeName}:${site.callerLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const candidates = localAssistantWorkspace.symbolMap.get(site.calleeName) || [];
      if (!candidates.length) continue;
      const match = candidates.find(c => c.file === requested) || candidates[0];
      resolvedSites.push({ callerLine: site.callerLine, calleeName: site.calleeName, resolvedFile: match.file, resolvedLine: match.lineStart });
    }
    packed.callSites = resolvedSites;
    localAssistantWorkspace.files.set(requested, { path: requested, ...packed, kind: 'source' });
  } else {
    localAssistantWorkspace.files.set(requested, { path: requested, ...packed, kind: "source" });
  }
  if (!localAssistantWorkspace.folderName) localAssistantWorkspace.folderName = "workspace";
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();
  return { ok: true, mode: "local-fallback", path: requested, originalSize: Number(packed.originalSize || 0), compressedSize: Number(packed.compressedSize || 0), capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0), transportBytes: Number(packed.compressionStats?.transportBytes || 0), updatedAt: localAssistantWorkspace.indexedAt };
}

async function localWorkspaceCreate(pathInput, nextContent, options = {}) {
  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) return { ok: false, error: "Invalid file path" };

  const overwrite = Boolean(options?.overwrite);
  const existed = localAssistantWorkspace.files.has(requested);
  if (existed && !overwrite) return { ok: false, error: "File already exists" };

  const normalized = typeof nextContent === "string" ? nextContent : String(nextContent || "");
  if (isLocalPathWorkspaceState()) {
    const result = await writeLocalWorkspaceFileToDisk(requested, normalized, { overwrite });
    if (result.ok === false) return result;
    return { ...result, created: !existed, overwritten: existed };
  }
  if (workspaceMetadataStore.enabled && isUploadWorkspaceState()) {
    const workspaceId = String(localAssistantWorkspace.workspaceId || "").trim();
    const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, requested);
    if (existing && !overwrite) return { ok: false, error: "File already exists" };
    const packed = existing?.storage?.provider === "s3"
      ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: existing.storage, writeToBlob: true })
      : await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: localWorkspaceUploadBlobStorageForPath(requested), writeToBlob: true });
    await workspaceMetadataStore.upsertWorkspaceFileRecord({ workspaceId, sessionId: localAssistantWorkspace.sessionId, folderName: localAssistantWorkspace.folderName || "workspace", rootPath: "", sourceKind: WORKSPACE_SOURCE_UPLOAD, path: requested, record: packed, status: "completed" });
    await syncLocalUploadWorkspaceSummary(workspaceId, { folderName: localAssistantWorkspace.folderName || "workspace", sessionId: localAssistantWorkspace.sessionId });
    return { ok: true, mode: "local-fallback", path: requested, created: !existing, overwritten: Boolean(existing), originalSize: Number(packed.originalSize || 0), compressedSize: Number(packed.compressedSize || 0), capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0), transportBytes: Number(packed.compressionStats?.transportBytes || 0), updatedAt: localAssistantWorkspace.indexedAt };
  }

  const existing = localAssistantWorkspace.files.get(requested);
  const packed = existing?.storage?.provider === "s3"
    ? await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: existing.storage, writeToBlob: true })
    : await packLocalBlobBackedWorkspaceRecord(requested, normalized, { storage: localWorkspaceUploadBlobStorageForPath(requested), writeToBlob: true });

  localAssistantWorkspace.files.set(requested, { path: requested, ...packed, kind: "source" });
  if (!localAssistantWorkspace.folderName) localAssistantWorkspace.folderName = "workspace";
  localAssistantWorkspace.rootPath = null;
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();
  return { ok: true, mode: "local-fallback", path: requested, created: !existed, overwritten: existed, originalSize: Number(packed.originalSize || 0), compressedSize: Number(packed.compressedSize || 0), capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0), transportBytes: Number(packed.compressionStats?.transportBytes || 0), updatedAt: localAssistantWorkspace.indexedAt };
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
};
