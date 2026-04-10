'use strict';
/**
 * MESH — Workspace Context Layer
 * File access helpers, terminal session management, context excerpt and
 * compression utilities, codec transport building, and refusal detection.
 *
 * All functions reference globals (populated by server.js at startup) at
 * call-time. Only crypto is required directly for UUID generation.
 */

const crypto = require('crypto');

async function compressLocalWorkspaceChunkFiles(incomingFiles, options = {}) {
  const recordMode = String(options.recordMode || "initial").trim().toLowerCase() === "full" ? "full" : "initial";
  const normalized = [];
  for (const file of incomingFiles) {
    const filePath = toSafePath(file?.path || file?.name);
    if (!filePath || !isWorkspaceIndexablePath(filePath)) continue;
    const preindexed = normalizeIncomingWorkspacePreindexedFile(file, filePath);
    normalized.push({
      filePath,
      content: typeof file?.content === "string" ? file.content : "",
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


async function openWorkspaceFileWithFallback(pathInput, viewMode = "original", viewOptions = {}) {
  const requested = toSafePath(pathInput);
  if (!requested) {
    throw new Error("Invalid file path");
  }

  try {
    const normalizedView = String(viewMode || "original").toLowerCase();
    const action = normalizedView === "capsule"
      ? "workspace.capsule.open"
      : normalizedView === "transport"
        ? "workspace.transport.open"
        : "workspace.file.open";
    // Fall back to localAssistantWorkspace.workspaceId so worker-restart doesn't break file open
    const workspaceId = String(viewOptions.workspaceId || localAssistantWorkspace.workspaceId || "").trim();
    const sessionId = String(viewOptions.sessionId || localAssistantWorkspace.sessionId || "").trim();
    const result = await meshTunnelRequest(action, {
      path: requested,
      view: viewMode,
      workspaceId,
      sessionId,
      tier: String(viewOptions.tier || viewOptions.capsuleTier || viewOptions.variant || "").trim(),
      query: String(viewOptions.query || viewOptions.focus || "").trim(),
      focus: String(viewOptions.focus || viewOptions.query || "").trim(),
    });
    if (!result?.ok) {
      throw new Error(result?.error || "Workspace file open failed");
    }
    return result;
  } catch {
    const local = await localWorkspaceFile(requested, viewMode, viewOptions);
    if (!local?.ok) {
      throw new Error(local?.error || "Workspace file open failed");
    }
    return local;
  }
}

async function recoverWorkspaceWithFallback(pathInput, request = {}) {
  const requested = toSafePath(pathInput);
  if (!requested) {
    throw new Error("Invalid file path");
  }

  const payload = {
    path: requested,
    workspaceId: String(request.workspaceId || localAssistantWorkspace.workspaceId || "").trim(),
    sessionId: String(request.sessionId || localAssistantWorkspace.sessionId || "").trim(),
    query: String(request.query || "").trim(),
    spanIds: Array.isArray(request.spanIds) ? request.spanIds : [],
    ranges: Array.isArray(request.ranges) ? request.ranges : [],
  };

  try {
    const result = await meshTunnelRequest("workspace.recovery.fetch", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace recovery failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const meta = localAssistantWorkspace.files.get(requested);
      if (!meta) throw error;
      const ensured = await ensureLocalWorkspaceMeta(meta, requested);
      const suggested = payload.spanIds.length
        ? payload.spanIds
        : (payload.query ? suggestRecoverySpanIds(ensured, payload.query, 4) : []);
      const local = await recoverWorkspaceFileRecord(ensured, {
        spanIds: suggested,
        ranges: payload.ranges,
      }, {
        path: requested,
        legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
      });
      return {
        ...local,
        mode: "local-fallback",
        suggestedSpanIds: suggested,
      };
    }
    const meta = localAssistantWorkspace.files.get(requested);
    if (!meta) throw error;
    const ensured = await ensureLocalWorkspaceMeta(meta, requested);
    const suggested = payload.spanIds.length
      ? payload.spanIds
      : (payload.query ? suggestRecoverySpanIds(ensured, payload.query, 4) : []);
    const local = await recoverWorkspaceFileRecord(ensured, {
      spanIds: suggested,
      ranges: payload.ranges,
    }, {
      path: requested,
      legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    });
    return {
      ...local,
      mode: "local-fallback",
      suggestedSpanIds: suggested,
    };
  }
}

async function searchWorkspaceWithFallback(query, options = {}) {
  const payload = {
    q: String(query || ""),
    scope: String(options.scope || "all"),
    limit: Number(options.limit) || 12,
  };

  try {
    const result = await meshTunnelRequest("workspace.search", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace search failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceSearch(payload.q, payload);
      if (!local?.ok) throw new Error(local?.error || "Workspace search failed");
      return local;
    }
    const local = await localWorkspaceSearch(payload.q, payload);
    if (!local?.ok) throw new Error(local?.error || "Workspace search failed");
    return local;
  }
}

async function grepWorkspaceWithFallback(query, options = {}) {
  const payload = {
    q: String(query || ""),
    scope: String(options.scope || "all"),
    limit: Number(options.limit) || 40,
    caseSensitive: options.caseSensitive === true,
  };

  try {
    const result = await meshTunnelRequest("workspace.grep", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace grep failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceGrep(payload.q, payload);
      if (!local?.ok) throw new Error(local?.error || "Workspace grep failed");
      return local;
    }
    const local = await localWorkspaceGrep(payload.q, payload);
    if (!local?.ok) throw new Error(local?.error || "Workspace grep failed");
    return local;
  }
}

async function renameWorkspaceFileWithFallback(fromPath, toPath, options = {}) {
  const payload = {
    fromPath,
    toPath,
    overwrite: Boolean(options.overwrite),
    workspaceId: String(options.workspaceId || "").trim(),
    sessionId: String(options.sessionId || "").trim(),
  };

  try {
    const result = await meshTunnelRequest("workspace.file.rename", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace rename failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceRename(fromPath, toPath, options);
      if (!local?.ok) throw new Error(local?.error || "Workspace rename failed");
      return local;
    }
    const local = await localWorkspaceRename(fromPath, toPath, options);
    if (!local?.ok) throw new Error(local?.error || "Workspace rename failed");
    return local;
  }
}

async function deleteWorkspaceFileWithFallback(pathInput, options = {}) {
  const payload = {
    path: pathInput,
    workspaceId: String(options.workspaceId || "").trim(),
    sessionId: String(options.sessionId || "").trim(),
  };

  try {
    const result = await meshTunnelRequest("workspace.file.delete", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace delete failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceDelete(pathInput);
      if (!local?.ok) throw new Error(local?.error || "Workspace delete failed");
      return local;
    }
    const local = await localWorkspaceDelete(pathInput);
    if (!local?.ok) throw new Error(local?.error || "Workspace delete failed");
    return local;
  }
}

async function applyWorkspaceBatchWithFallback(operations, options = {}) {
  const payload = {
    operations: Array.isArray(operations) ? operations : [],
    stopOnError: options.stopOnError !== false,
  };

  try {
    const result = await meshTunnelRequest("workspace.batch", payload);
    if (!result?.ok) throw new Error(result?.error || "Workspace batch failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) {
      const local = await localWorkspaceBatch(payload.operations, payload);
      if (!local?.ok) throw new Error(local?.error || "Workspace batch failed");
      return local;
    }
    const local = await localWorkspaceBatch(payload.operations, payload);
    if (!local?.ok) throw new Error(local?.error || "Workspace batch failed");
    return local;
  }
}

async function openLocalWorkspaceWithFallback(rootPath, options = {}) {
  const payload = {
    rootPath: String(rootPath || "").trim(),
    folderName: String(options.folderName || "").trim(),
  };

  try {
    const result = await meshTunnelRequest("workspace.open-local", payload);
    if (!result?.ok) throw new Error(result?.error || "Open local workspace failed");
    return result;
  } catch (error) {
    if (!isMeshWorkerUnavailableError(error)) throw error;
    const local = await localWorkspaceOpenLocal(payload.rootPath, { folderName: payload.folderName });
    if (!local?.ok) throw new Error(local?.error || "Open local workspace failed");
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    };
  }
}

async function runGitWithFallback(action, data, fallback) {
  try {
    const result = await meshTunnelRequest(action, data || {});
    if (!result?.ok) throw new Error(result?.error || "Git request failed");
    return result;
  } catch (error) {
    const canUseLocalState = isLocalPathWorkspaceState()
      && String(error?.message || "").toLowerCase().includes("no local workspace root configured");
    if (!isMeshWorkerUnavailableError(error) && !canUseLocalState) throw error;
    const local = await fallback();
    if (!local?.ok) throw new Error(local?.error || "Git request failed");
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    };
  }
}

function sanitizeTerminalChunk(raw) {
  return String(raw || "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[\[\(][0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b[PX^_][^\x1b]*\x1b\\/g, "")
    .replace(/\x1b[^[\]PX^_()]/g, "")
    .replace(/[\x00-\x08\x0e-\x1f\x7f]/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function makeAssistantTerminalEntry(session, type, text, extra = {}) {
  session.cursor += 1;
  const entry = {
    index: session.cursor,
    type,
    text: String(text || ""),
    createdAt: toIsoNow(),
    ...extra,
  };
  session.entries.push(entry);
  if (session.entries.length > 1500) {
    session.entries.splice(0, session.entries.length - 1500);
  }
  session.updatedAt = entry.createdAt;
  return entry;
}

function getAssistantTerminalSession(sessionId) {
  const id = String(sessionId || "").trim();
  return id ? assistantTerminalSessions.get(id) || null : null;
}

function createAssistantTerminalSession(options = {}) {
  if (!pty) {
    throw new Error("node-pty is not available on this server.");
  }

  const shellPref = String(options.shell || "").trim().toLowerCase();
  let shell;
  if (shellPref === "python3" || shellPref === "python") shell = "python3";
  else if (shellPref === "bash" || shellPref === "zsh") shell = shellPref;
  else shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");

  const id = `term-${Date.now()}-${crypto.randomUUID()}`;
  const proc = pty.spawn(shell, [], {
    name: "xterm-color",
    cols: 120,
    rows: 30,
    cwd: process.env.HOME || __dirname,
    env: process.env,
  });

  const session = {
    id,
    shell,
    status: "running",
    createdAt: toIsoNow(),
    updatedAt: toIsoNow(),
    entries: [],
    cursor: 0,
    proc,
  };

  proc.onData((raw) => {
    const chunk = sanitizeTerminalChunk(raw);
    if (!chunk) return;
    makeAssistantTerminalEntry(session, "output", chunk);
  });

  proc.onExit((event) => {
    session.status = "exited";
    session.exitCode = Number(event?.exitCode ?? 0);
    makeAssistantTerminalEntry(session, "exit", `Process exited with code ${session.exitCode}.`, {
      exitCode: session.exitCode,
    });
  });

  assistantTerminalSessions.set(id, session);
  return {
    ok: true,
    session: {
      id: session.id,
      shell: session.shell,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    },
  };
}

function listAssistantTerminalOutput(sessionId, sinceIndex = 0) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session) {
    throw new Error("Terminal session not found.");
  }

  const since = Math.max(0, Number(sinceIndex) || 0);
  return {
    ok: true,
    session: {
      id: session.id,
      shell: session.shell,
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      exitCode: Number.isFinite(session.exitCode) ? session.exitCode : null,
    },
    cursor: session.cursor,
    entries: session.entries.filter((entry) => entry.index > since),
  };
}

function writeAssistantTerminalInput(sessionId, input) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session || !session.proc) {
    throw new Error("Terminal session not found.");
  }
  if (session.status !== "running") {
    throw new Error("Terminal session is not running.");
  }

  const data = typeof input === "string" ? input : String(input || "");
  if (!data) {
    throw new Error("Terminal input is required.");
  }

  makeAssistantTerminalEntry(session, "input", data);
  session.proc.write(data);
  return {
    ok: true,
    session: {
      id: session.id,
      status: session.status,
      updatedAt: session.updatedAt,
    },
  };
}

function destroyAssistantTerminalSession(sessionId) {
  const session = getAssistantTerminalSession(sessionId);
  if (!session) {
    return { ok: true, deleted: false };
  }

  try {
    session.proc?.kill();
  } catch {
    // ignore shutdown race
  }
  session.status = "closed";
  session.updatedAt = toIsoNow();
  assistantTerminalSessions.delete(session.id);
  return { ok: true, deleted: true, sessionId: session.id };
}

function createCompressedContextExcerpt(content, limitChars, pathValue = "", options = {}) {
  const text = normalizeContextExcerptText(content);
  const maxChars = Math.max(400, Number(limitChars) || 0);
  const focusTerms = normalizeExcerptFocusTerms(options.focusTerms || []);
  if (!text) {
    return {
      excerpt: "",
      truncated: false,
      excerptChars: 0,
    };
  }
  if (text.length <= maxChars) {
    return {
      excerpt: text,
      truncated: false,
      excerptChars: text.length,
    };
  }

  const marker = `\n\n[server-note: excerpt truncated for token budget in ${toSafePath(pathValue) || "workspace file"}]\n\n`;
  const gapMarker = "\n\n[...omitted...]\n\n";

  const headSize = Math.max(180, Math.floor(maxChars * 0.24));
  const tailSize = Math.max(140, Math.floor(maxChars * 0.18));
  const focusRanges = collectFocusedCharRanges(text, focusTerms, {
    aroundBefore: 220,
    aroundAfter: 520,
    maxHits: 10,
  });

  let ranges = mergeCharRanges([
    { start: 0, end: Math.min(text.length, headSize) },
    ...focusRanges,
    { start: Math.max(0, text.length - tailSize), end: text.length },
  ]);

  let excerptBody = buildExcerptFromCharRanges(text, ranges, gapMarker);
  let availableChars = Math.max(120, maxChars - marker.length);

  while (excerptBody.length > availableChars && ranges.length > 2) {
    ranges.splice(1, 1);
    excerptBody = buildExcerptFromCharRanges(text, ranges, gapMarker);
  }

  if (excerptBody.length > availableChars) {
    const trimmedHead = Math.max(80, Math.floor(availableChars * 0.68));
    const trimmedTail = Math.max(40, availableChars - trimmedHead);
    excerptBody = `${text.slice(0, trimmedHead)}${gapMarker}${text.slice(Math.max(0, text.length - trimmedTail))}`;
  }

  const excerpt = `${excerptBody}${marker}`;
  return {
    excerpt,
    truncated: true,
    excerptChars: excerpt.length,
  };
}

function normalizeContextExcerptText(input) {
  return String(input || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function normalizeExcerptFocusTerms(rawTerms) {
  const sourceTerms = Array.isArray(rawTerms)
    ? rawTerms
    : extractSearchTokens(String(rawTerms || ""));

  const deduped = [];
  const seen = new Set();
  for (const term of sourceTerms) {
    const normalized = String(term || "").trim().toLowerCase();
    if (normalized.length < 3 || seen.has(normalized)) continue;
    seen.add(normalized);
    deduped.push(normalized);
    if (deduped.length >= 10) break;
  }
  return deduped;
}

function collectFocusedCharRanges(text, focusTerms = [], options = {}) {
  const source = String(text || "");
  const terms = Array.isArray(focusTerms) ? focusTerms : [];
  if (!source || terms.length === 0) return [];

  const aroundBefore = Math.max(40, Number(options.aroundBefore) || 220);
  const aroundAfter = Math.max(60, Number(options.aroundAfter) || 520);
  const maxHits = Math.max(1, Number(options.maxHits) || 10);

  const ranges = [];
  const lower = source.toLowerCase();
  let hitCount = 0;

  for (const rawTerm of terms) {
    if (hitCount >= maxHits) break;
    const term = String(rawTerm || "").toLowerCase();
    if (!term) continue;

    let searchIdx = 0;
    while (hitCount < maxHits) {
      const hitIdx = lower.indexOf(term, searchIdx);
      if (hitIdx < 0) break;
      ranges.push({
        start: Math.max(0, hitIdx - aroundBefore),
        end: Math.min(source.length, hitIdx + term.length + aroundAfter),
      });
      hitCount += 1;
      searchIdx = hitIdx + term.length;
    }
  }

  return mergeCharRanges(ranges);
}

function mergeCharRanges(ranges = []) {
  const normalized = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({
      start: Math.max(0, Number(range?.start) || 0),
      end: Math.max(0, Number(range?.end) || 0),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (!normalized.length) return [];

  const merged = [normalized[0]];
  for (const current of normalized.slice(1)) {
    const previous = merged[merged.length - 1];
    if (current.start <= previous.end + 24) {
      previous.end = Math.max(previous.end, current.end);
      continue;
    }
    merged.push(current);
  }
  return merged;
}

function buildExcerptFromCharRanges(text, ranges = [], gapMarker = "\n\n[...omitted...]\n\n") {
  const source = String(text || "");
  const normalizedRanges = mergeCharRanges(ranges);
  if (!source || normalizedRanges.length === 0) return "";

  let output = "";
  let lastEnd = 0;
  for (const range of normalizedRanges) {
    if (output && range.start > lastEnd) output += gapMarker;
    output += source.slice(range.start, range.end);
    lastEnd = range.end;
  }
  return output;
}

async function loadCompressedContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 3, 1), 8);
  const maxModelCompressedChars = Math.min(Math.max(Number(options.maxModelCompressedChars) || 12000, 1000), 90000);
  const firstFileMaxModelCompressedChars = Math.min(
    Math.max(Number(options.firstFileMaxModelCompressedChars) || maxModelCompressedChars, maxModelCompressedChars),
    700000
  );
  const maxDecodedChars = Math.min(Math.max(Number(options.maxDecodedChars) || 16000, 800), 250000);
  const firstFileMaxDecodedChars = Math.min(
    Math.max(Number(options.firstFileMaxDecodedChars) || maxDecodedChars, maxDecodedChars),
    400000
  );
  const maxTotalDecodedChars = Math.min(
    Math.max(Number(options.maxTotalDecodedChars) || firstFileMaxDecodedChars + maxDecodedChars * Math.max(1, maxFiles - 1), 1200),
    1000000
  );
  const disableCodecDictionary = Boolean(options.disableCodecDictionary);

  const selectedPaths = dedupePaths(paths).slice(0, maxFiles);
  const focusTerms = normalizeExcerptFocusTerms(options.focusTerms || []);
  const entries = [];
  const skippedOversizePaths = [];
  let remainingDecodedChars = maxTotalDecodedChars;

  for (const [index, path] of selectedPaths.entries()) {
    if (remainingDecodedChars < 400) break;

    try {
      const opened = await openWorkspaceFileWithFallback(path, "compressed");
      const encoding = String(opened?.encoding || "").toLowerCase();
      if (encoding !== "base64-brotli") continue;

      const compressedBase64 = String(opened?.content || "");
      if (!compressedBase64) continue;

      const decoded = await decompressLocalWorkspaceText(compressedBase64);
      const decodedLimit = Math.max(
        400,
        Math.min(index === 0 ? firstFileMaxDecodedChars : maxDecodedChars, remainingDecodedChars)
      );

      let excerptResult = createCompressedContextExcerpt(decoded, decodedLimit, path, { focusTerms });
      let encodedMeta = encodeMeshModelCodec(excerptResult.excerpt, {
        withMeta: true,
        disableDictionary: disableCodecDictionary,
      });
      let modelCompressed = encodedMeta.encoded;
      const perFileLimit = index === 0 ? firstFileMaxModelCompressedChars : maxModelCompressedChars;

      while (modelCompressed.length > perFileLimit && excerptResult.excerpt.length > 700) {
        const nextLimit = Math.max(500, Math.floor(excerptResult.excerpt.length * 0.72));
        if (nextLimit >= excerptResult.excerpt.length) break;
        excerptResult = createCompressedContextExcerpt(decoded, nextLimit, path, { focusTerms });
        encodedMeta = encodeMeshModelCodec(excerptResult.excerpt, {
          withMeta: true,
          disableDictionary: disableCodecDictionary,
        });
        modelCompressed = encodedMeta.encoded;
      }

      if (modelCompressed.length > perFileLimit) {
        skippedOversizePaths.push(path);
        continue;
      }

      remainingDecodedChars = Math.max(0, remainingDecodedChars - excerptResult.excerptChars);

      entries.push({
        path,
        sourceEncoding: "base64-brotli",
        modelEncoding: MESH_MODEL_CODEC_VERSION,
        modelCompressed,
        usedTokens: Array.isArray(encodedMeta?.usedTokens) ? encodedMeta.usedTokens : [],
        usesCodecDictionary: Boolean(encodedMeta?.dictionaryEnabled),
        contentTruncated: excerptResult.truncated,
        excerptChars: excerptResult.excerptChars,
        originalSize: Number(opened?.originalSize || Buffer.byteLength(decoded, "utf8")),
        compressedSize: Number(opened?.compressedSize || Buffer.byteLength(compressedBase64, "utf8")),
      });
    } catch {
      // Ignore individual file load failures so the model can still answer with partial context.
    }
  }

  return {
    entries,
    skippedOversizePaths,
  };
}

async function loadPlainContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 1, 1), 3);
  const maxChars = Math.min(Math.max(Number(options.maxChars) || 220000, 2000), 900000);
  const selectedPaths = dedupePaths(paths).slice(0, maxFiles);
  const entries = [];

  for (const path of selectedPaths) {
    try {
      const opened = await openWorkspaceFileWithFallback(path, "original");
      const content = String(opened?.content || "");
      if (!content) continue;

      const contentTruncated = content.length > maxChars;
      entries.push({
        path,
        content: contentTruncated
          ? `${content.slice(0, maxChars)}\n\n[server-note: file excerpt truncated by safety limit]`
          : content,
        contentTruncated,
        originalSize: Number(opened?.originalSize || Buffer.byteLength(content, "utf8")),
      });
    } catch {
      // Ignore individual file load failures so the model can still answer with partial context.
    }
  }

  return entries;
}

function buildPlainContextBlock(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return "";

  const header = [
    "<mesh_workspace_plain_context>",
    "Files below are workspace source-of-truth in plain text.",
    "Use these file contents directly when answering.",
    "</mesh_workspace_plain_context>",
  ].join("\n");

  const blocks = entries.map((entry) => {
    const safePath = escapeTagAttribute(entry.path);
    return [
      `<workspace_file path=\"${safePath}\" encoding=\"plain-text\" excerpt_truncated=\"${Boolean(entry.contentTruncated)}\" original_bytes=\"${entry.originalSize}\">`,
      entry.content,
      "</workspace_file>",
    ].join("\n");
  });

  return `${header}\n\n${blocks.join("\n\n")}`;
}

function buildCompressedContextBlock(entries = []) {
  if (!Array.isArray(entries) || entries.length === 0) return "";

  const header = [
    `<mesh_workspace_context codec="${MESH_MODEL_CODEC_VERSION}">`,
    "Workspace files below are compressed payloads only.",
    "Decode tokens using the one-time mesh codec context document.",
    "</mesh_workspace_context>",
  ].join("\n");

  const blocks = entries.map((entry) => {
    const safePath = escapeTagAttribute(entry.path);
    return [
      `<compressed_file path="${safePath}" source_encoding="${entry.sourceEncoding}" model_encoding="${entry.modelEncoding}" original_bytes="${entry.originalSize}" source_compressed_bytes="${entry.compressedSize}" excerpt_truncated="${Boolean(entry.contentTruncated)}" excerpt_chars="${Number(entry.excerptChars || 0)}">`,
      entry.modelCompressed,
      "</compressed_file>",
    ].join("\n");
  });

  return `${header}\n\n${blocks.join("\n\n")}`;
}

function shouldPrefetchRecoveryForPrompt(rawText) {
  const text = String(rawText || "").toLowerCase();
  return /\b(exact|literally|verbatim|line|lines|which span|where exactly|regex|string|constant|env|process\.env|why|how does|what does)\b/.test(text);
}

async function loadCapsuleContextEntries(paths = [], options = {}) {
  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 3, 1), 8);
  const maxModelChars = Math.min(Math.max(Number(options.maxModelChars) || 18000, 1500), 120000);
  const firstFileMaxModelChars = Math.min(
    Math.max(Number(options.firstFileMaxModelChars) || maxModelChars, maxModelChars),
    240000,
  );
  const query = String(options.query || "").trim();
  const disableCodecDictionary = Boolean(options.disableCodecDictionary);
  const entries = [];
  const skippedOversizePaths = [];

  for (const [index, path] of dedupePaths(paths).slice(0, maxFiles).entries()) {
    try {
      const opened = await openWorkspaceFileWithFallback(path, query ? "focused" : "capsule", { query });
      const rendered = String(opened?.content || "").trim();
      if (!rendered) continue;

      const perFileLimit = index === 0 ? firstFileMaxModelChars : maxModelChars;
      let modelContent = rendered;
      let modelEncoding = "plain-text";
      let usesCodecDictionary = false;
      let truncated = false;

      if (rendered.length > perFileLimit) {
        const encodedMeta = encodeMeshModelCodec(rendered, {
          withMeta: true,
          disableDictionary: disableCodecDictionary,
        });
        if (encodedMeta?.encoded && encodedMeta.encoded.length <= perFileLimit) {
          modelContent = encodedMeta.encoded;
          modelEncoding = MESH_MODEL_CODEC_VERSION;
          usesCodecDictionary = Boolean(encodedMeta.dictionaryEnabled);
        } else {
          const nextLimit = Math.max(600, perFileLimit - 128);
          modelContent = `${rendered.slice(0, nextLimit)}\n\n[capsule truncated by gateway budget]`;
          truncated = true;
        }
      }

      if (modelContent.length > perFileLimit * 1.15) {
        skippedOversizePaths.push(path);
        continue;
      }

      entries.push({
        path,
        fileType: String(opened?.fileType || ""),
        parserFamily: String(opened?.parserFamily || ""),
        capsuleMode: String(opened?.capsule?.capsuleMode || opened?.capsuleMode || ""),
        modelEncoding,
        modelContent,
        contentTruncated: truncated,
        usesCodecDictionary,
        rawBytes: Number(opened?.rawBytes || opened?.originalSize || 0),
        capsuleBytes: Number(opened?.capsuleBytes || Buffer.byteLength(rendered, "utf8")),
        recoveryEligible: Boolean(opened?.capsule?.recoveryEligible),
        isSkeleton: Boolean(opened?.isSkeleton || opened?.capsule?.isSkeleton),
      });
    } catch {
      // Ignore individual file failures.
    }
  }

  return {
    entries,
    skippedOversizePaths,
  };
}

async function loadRecoveredSpanEntries(paths = [], query = "", options = {}) {
  if (!query || !shouldPrefetchRecoveryForPrompt(query)) {
    return [];
  }

  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || 2, 1), 4);
  const maxSpansPerFile = Math.min(Math.max(Number(options.maxSpansPerFile) || 3, 1), 6);
  const recovered = [];

  for (const path of dedupePaths(paths).slice(0, maxFiles)) {
    try {
      const result = await recoverWorkspaceWithFallback(path, { query });
      const spans = Array.isArray(result?.spans) ? result.spans.slice(0, maxSpansPerFile) : [];
      for (const span of spans) {
        if (!span?.text) continue;
        recovered.push({
          path,
          spanId: String(span.spanId || ""),
          lineStart: Number(span.lineStart || 0),
          lineEnd: Number(span.lineEnd || 0),
          text: String(span.text || ""),
        });
      }
    } catch {
      // Ignore individual recovery failures.
    }
  }

  return recovered;
}

function buildCapsuleContextBlock(entries = [], recoveredSpans = []) {
  if ((!Array.isArray(entries) || entries.length === 0) && (!Array.isArray(recoveredSpans) || recoveredSpans.length === 0)) {
    return "";
  }

  const lines = [
    `<mesh_workspace_capsules codec="${MESH_MODEL_CODEC_VERSION}">`,
    "Workspace capsules below are the primary model context.",
    "Treat span ids as evidence handles. Cite them when making exact claims.",
  ];

  if (Array.isArray(entries) && entries.length > 0) {
    for (const entry of entries) {
      lines.push(
        `<capsule_file path="${escapeTagAttribute(entry.path)}" file_type="${escapeTagAttribute(entry.fileType)}" parser="${escapeTagAttribute(entry.parserFamily)}" capsule_mode="${escapeTagAttribute(entry.capsuleMode)}" model_encoding="${escapeTagAttribute(entry.modelEncoding)}" raw_bytes="${Number(entry.rawBytes || 0)}" capsule_bytes="${Number(entry.capsuleBytes || 0)}" recovery_eligible="${Boolean(entry.recoveryEligible)}" excerpt_truncated="${Boolean(entry.contentTruncated)}" is_skeleton="${Boolean(entry.isSkeleton)}">`,
      );
      lines.push(String(entry.modelContent || ""));
      lines.push("</capsule_file>");
    }
  }

  if (Array.isArray(recoveredSpans) && recoveredSpans.length > 0) {
    lines.push("<recovered_spans>");
    for (const span of recoveredSpans) {
      lines.push(
        `<recovered_span path="${escapeTagAttribute(span.path)}" span_id="${escapeTagAttribute(span.spanId)}" line_start="${Number(span.lineStart || 0)}" line_end="${Number(span.lineEnd || 0)}">`,
      );
      lines.push(String(span.text || ""));
      lines.push("</recovered_span>");
    }
    lines.push("</recovered_spans>");
  }

  lines.push("</mesh_workspace_capsules>");
  return lines.join("\n");
}

function injectCompressedContextIntoMessages(messages = [], contextBlock = "") {
  if (!contextBlock) return messages;

  const cloned = (Array.isArray(messages) ? messages : []).map((message) => ({
    role: message.role,
    content: String(message.content || ""),
  }));

  for (let idx = cloned.length - 1; idx >= 0; idx -= 1) {
    if (cloned[idx].role === "user") {
      cloned[idx].content = `${cloned[idx].content}\n\n${contextBlock}`;
      return cloned;
    }
  }

  cloned.push({ role: "user", content: contextBlock });
  return cloned;
}

function buildModelResponseTransport(encodedPayload, decodedText, compressedByModel) {
  return {
    responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
    responseEncodedBytes: Buffer.byteLength(String(encodedPayload || ""), "utf8"),
    responseDecodedBytes: Buffer.byteLength(String(decodedText || ""), "utf8"),
    compressedByModel,
  };
}

function buildServerCodecRecovery(rawText) {
  const parsed = decodeCompressedModelResponse(rawText, {
    allowLegacy: true,
    allowUnframedRot47: true,
  });
  if (parsed.codecValid) {
    return {
      decoded: parsed.decoded,
      encodedPayload: parsed.encodedPayload,
      compressedByModel: true,
      codecValid: true,
      codecMode: parsed.codecMode || "server-recovery-decoded",
      wrapped: parsed.wrapped,
      serverCodecRecovery: true,
    };
  }

  const extracted = extractCompressedModelPayload(rawText);
  const fallbackPlain = extracted.wrapped ? extracted.encodedPayload : String(rawText || "");
  const encodedPayload = encodeMeshModelCodec(fallbackPlain);
  const decoded = decodeMeshModelCodec(encodedPayload, { allowLegacy: false, allowUnframedRot47: false });

  return {
    decoded: decoded.ok ? decoded.decoded : fallbackPlain,
    encodedPayload,
    compressedByModel: false,
    codecValid: decoded.ok,
    codecMode: decoded.mode || "server-recovery-plain",
    wrapped: extracted.wrapped,
    serverCodecRecovery: true,
  };
}

function polishDecompressedAssistantText(rawText) {
  let text = String(rawText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text) return "";

  const looksLikeCode = /```|^\s*(const|let|var|function|class|import|export)\b/m.test(text);
  if (!looksLikeCode) {
    const dashSegments = (text.match(/\s-\s/g) || []).length;
    if (dashSegments >= 3 && !/\n-\s/.test(text)) {
      text = text.replace(/\s-\s/g, "\n- ");
    }

    text = text.replace(/([.!?])([A-Za-z])/g, "$1 $2");
    text = text.replace(/(^|[.!?]\s+|\n+)([a-z])/g, (_m, prefix, first) => `${prefix}${first.toUpperCase()}`);
  }

  return text;
}

function looksLikeCodecProtocolRefusal(rawText) {
  const text = String(rawText || "").toLowerCase();
  if (!text) return false;

  const refusalSignals = [
    "prompt injection",
    "social engineering",
    "not a real codec",
    "fake codec",
    "fake workspace",
    "what i will not do",
    "what i can do",
  ];

  if (refusalSignals.some((signal) => text.includes(signal))) return true;

  if (text.includes("rot47") && (text.includes("will not") || text.includes("won't"))) {
    return true;
  }

  return false;
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
};
