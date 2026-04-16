'use strict';
/**
 * MESH — Workspace Infrastructure Layer
 * Tunnel, path utilities, local workspace state, git helpers, job queue,
 * S3 blob offload, and workspace provisioning.
 *
 * All functions reference mutable state and constants via globals (populated
 * by server.js at startup) at call-time. The five utility functions below are
 * inlined here because createWorkspaceOffloadConfig() runs at module load
 * time, before globals are available.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');

const { MESH_SYSTEM_PROMPT } = require('./model-providers');
const config = require('../config');
const logger = require('../logger');
const { trimTrailingSlashes } = require('../config/env-utils');

let S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand;
try {
  ({ S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } = require('@aws-sdk/client-s3'));
} catch {
  S3Client = null;
}

let _s3Client = null;
function getS3Client() {
  if (_s3Client) return _s3Client;
  if (!S3Client) throw new Error('AWS S3 SDK not available. Run: npm install @aws-sdk/client-s3');
  const opts = { region: config.AWS_REGION_BEDROCK || process.env.AWS_REGION || 'us-east-1' };
  if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
    opts.credentials = { accessKeyId: config.AWS_ACCESS_KEY_ID, secretAccessKey: config.AWS_SECRET_ACCESS_KEY };
  }
  _s3Client = new S3Client(opts);
  return _s3Client;
}

function createWorkspacePerfTracker(scope, meta = {}) {
  const startedAt = Date.now();
  const marks = [];
  return {
    mark(label, extra = {}) {
      marks.push({ label, at: Date.now(), ...extra });
    },
    flush(extra = {}) {
      if (!MESH_WORKSPACE_PERF_LOG) return;
      const totalMs = Date.now() - startedAt;
      const detail = marks.map((mark, index) => {
        const previousAt = index > 0 ? marks[index - 1].at : startedAt;
        return `${mark.label}:${mark.at - previousAt}ms`;
      }).join(" | ");
      logger.info(`Perf: ${scope}`, { scope: 'mesh-perf', totalMs, ...meta, ...extra, steps: detail || undefined });
    },
  };
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const source = Array.isArray(items) ? items : [];
  if (!source.length) return [];
  const limit = Math.max(1, Math.min(Number(concurrency) || 1, source.length));
  const output = new Array(source.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= source.length) break;
      output[index] = await mapper(source[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return output;
}

function isWorkspaceIndexablePath(pathInput = "") {
  const normalized = toSafePath(pathInput);
  if (!normalized) return false;
  if (LOCAL_WORKSPACE_SKIP_DIRS.test(normalized)) return false;
  if (LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock)$/i.test(normalized)) return false;
  // Minified bundles: no symbol value, wastes token budget
  if (/\.min\.(js|css)$/.test(normalized)) return false;
  return true;
}

async function meshTunnelRequest(action, data = {}, requestId = null) {
  const envelope = JSON.stringify({ action, data });
  const compressed = await brotliCompress(Buffer.from(envelope, "utf8"), {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: MESH_TUNNEL_BROTLI_QUALITY,
    },
  });

  const headers = {
    "Content-Type": "application/octet-stream",
    "X-Mesh-Encoding": "brotli",
    "X-Mesh-Worker-Secret": process.env.MESH_WORKER_SECRET || "",
  };

  if (requestId) {
    headers["X-Request-ID"] = String(requestId);
  }

  const response = await fetch(MESH_CORE_URL, {
    method: "POST",
    headers,
    body: compressed,
  });

  const packed = Buffer.from(await response.arrayBuffer());
  const unpacked = await brotliDecompress(packed);
  const parsed = JSON.parse(unpacked.toString("utf8"));

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `Mesh worker request failed (${response.status})`);
  }

  return parsed;
}

function toSafePath(rawPath) {
  const input = String(rawPath || "").replace(/\\/g, "/").trim();
  if (!input) return "";
  const normalized = path.posix.normalize(`/${input}`).replace(/^\/+/, "");
  return normalized === "." ? "" : normalized;
}

function basename(filePath) {
  const normalized = toSafePath(filePath);
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function ensureWorkspaceOwnedPath(pathInput, workspaceFolderName) {
  const requested = toSafePath(pathInput);
  if (!requested) return "";

  const root = toSafePath(workspaceFolderName);
  if (!root) return requested;
  if (requested === root || requested.startsWith(`${root}/`)) return requested;
  return `${root}/${requested}`;
}

function localWorkspaceSummary() {
  return {
    folderName: localAssistantWorkspace.folderName,
    rootPath: localAssistantWorkspace.rootPath || "",
    workspaceId: localAssistantWorkspace.workspaceId || "",
    sessionId: localAssistantWorkspace.sessionId || "",
    sourceKind: normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind),
    fileCountTotal: Number(localAssistantWorkspace.fileCountTotal || localAssistantWorkspace.files.size || 0),
    fileCountCompleted: Number(localAssistantWorkspace.fileCountCompleted || 0),
    fileCountPending: Number(localAssistantWorkspace.fileCountPending || 0),
    fileCountFailed: Number(localAssistantWorkspace.fileCountFailed || 0),
    status: String(localAssistantWorkspace.status || ""),
    indexedAt: localAssistantWorkspace.indexedAt,
  };
}

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
  localAssistantWorkspace.status = "";
  localAssistantWorkspace.indexedAt = null;
}

function isLocalPathWorkspaceState() {
  return normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_LOCAL_PATH
    && Boolean(localAssistantWorkspace.rootPath);
}

function isUploadWorkspaceState() {
  return normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind) === WORKSPACE_SOURCE_UPLOAD
    && Boolean(localAssistantWorkspace.workspaceId);
}

async function syncLocalUploadWorkspaceSummary(workspaceId, fallback = {}) {
  if (!workspaceMetadataStore.enabled || !workspaceId) return null;
  const summary = await workspaceMetadataStore.getWorkspaceSummary(workspaceId);
  if (!summary) return null;
  localAssistantWorkspace.folderName = String(summary.folderName || fallback.folderName || localAssistantWorkspace.folderName || "workspace") || "workspace";
  localAssistantWorkspace.rootPath = "";
  localAssistantWorkspace.workspaceId = String(summary.workspaceId || workspaceId);
  localAssistantWorkspace.sessionId = String(summary.sessionId || fallback.sessionId || localAssistantWorkspace.sessionId || "");
  localAssistantWorkspace.sourceKind = WORKSPACE_SOURCE_UPLOAD;
  localAssistantWorkspace.fileCountTotal = Number(summary.fileCountTotal || 0);
  localAssistantWorkspace.fileCountCompleted = Number(summary.fileCountCompleted || 0);
  localAssistantWorkspace.fileCountFailed = Number(summary.fileCountFailed || 0);
  localAssistantWorkspace.fileCountPending = Number(summary.fileCountPending || 0);
  localAssistantWorkspace.status = String(summary.status || "");
  localAssistantWorkspace.indexedAt = String(summary.indexedAt || summary.updatedAt || "") || null;
  localAssistantWorkspace.files = new Map();
  persistLocalWorkspaceState();
  return summary;
}

function toWorkspacePath(folderName, relativePath = "") {
  const root = toSafePath(folderName);
  const relative = toSafePath(relativePath);
  if (!root) return relative;
  return relative ? `${root}/${relative}` : root;
}

function toWorkspaceRelativePath(pathInput, folderName = localAssistantWorkspace.folderName) {
  const requested = toSafePath(pathInput);
  if (!requested) return "";

  const root = toSafePath(folderName);
  if (!root) return requested;
  if (requested === root) return "";
  if (requested.startsWith(`${root}/`)) return requested.slice(root.length + 1);
  return requested;
}

function normalizeAbsoluteRootPath(rootPath) {
  const input = String(rootPath || "").trim();
  if (!input) return "";
  return path.resolve(input);
}

function resolveLocalWorkspaceAbsolutePath(pathInput) {
  if (!isLocalPathWorkspaceState()) {
    throw new Error("No local workspace root configured.");
  }

  const requested = ensureWorkspaceOwnedPath(pathInput, localAssistantWorkspace.folderName);
  if (!requested || requested.endsWith("/")) {
    throw new Error("Invalid file path");
  }

  const relativePath = toWorkspaceRelativePath(requested, localAssistantWorkspace.folderName);
  if (!relativePath) {
    throw new Error("Invalid file path");
  }

  const absolutePath = path.resolve(localAssistantWorkspace.rootPath, relativePath);
  if (absolutePath !== localAssistantWorkspace.rootPath && !absolutePath.startsWith(`${localAssistantWorkspace.rootPath}${path.sep}`)) {
    throw new Error("Path escapes workspace root.");
  }

  return { requested, relativePath, absolutePath };
}

function gitPathFromWorkspacePath(pathInput) {
  return toSafePath(toWorkspaceRelativePath(pathInput, localAssistantWorkspace.folderName));
}

function workspacePathFromGitPath(pathInput) {
  return toWorkspacePath(localAssistantWorkspace.folderName || "", pathInput);
}

/**
 * Generates a recursive directory tree string for metadata provisioning (Local).
 */
async function generateMeshWorkspaceTree(rootPath, currentPath = "", depth = 0) {
  if (depth > 6) return "";
  const absolutePath = path.join(rootPath, currentPath);
  let result = "";

  try {
    const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (LOCAL_WORKSPACE_SKIP_DIRS.test(entry.name)) continue;
      // All files and folders are visible

      const indent = "  ".repeat(depth);
      if (entry.isDirectory()) {
        result += `${indent}- 📁 ${entry.name}/\n`;
        result += await generateMeshWorkspaceTree(rootPath, path.join(currentPath, entry.name), depth + 1);
      } else {
        if (LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(entry.name)) continue;
        result += `${indent}- 📄 ${entry.name}\n`;
      }
    }
  } catch {
    // Skip unreadable
  }
  return result;
}

/**
 * Generates a recursive directory tree string from a flat file manifest (Cloud Mode).
 */
function generateMeshWorkspaceTreeFromManifest(files = [], folderName = "workspace") {
  const tree = {};
  const rootName = String(folderName || "workspace").trim() || "workspace";

  for (const file of files) {
    const filePath = String(file.path || file.name || "").trim();
    if (!filePath) continue;
    if (LOCAL_WORKSPACE_SKIP_DIRS.test(filePath)) continue;
    // All files are visible in manifest

    const parts = filePath.split("/");
    let current = tree;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = i === parts.length - 1 ? null : {};
      }
      current = current[part];
    }
  }

  function render(node, name, depth = 0) {
    const indent = "  ".repeat(depth);
    if (node === null) {
      if (LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(name)) return "";
      return `${indent}- 📄 ${name}\n`;
    }
    let res = `${indent}- 📁 ${name}/\n`;
    const children = Object.keys(node).sort((a, b) => {
      const aIsDir = node[a] !== null;
      const bIsDir = node[b] !== null;
      if (aIsDir && !bIsDir) return -1;
      if (!aIsDir && bIsDir) return 1;
      return a.localeCompare(b);
    });
    for (const child of children) {
      res += render(node[child], child, depth + 1);
    }
    return res;
  }

  return render(tree, rootName);
}

/**
 * Automatically provisions .mesh/workspace-instructions.md if it doesn't exist.
 * Supports both Local and Cloud backends.
 */
/**
 * Reads package.json from rootPath and returns a flat summary of name, description,
 * and top-level dependency names. Returns an empty string when unavailable.
 */
async function readPackageJsonSummary(rootPath) {
  if (!rootPath) return "";
  try {
    const raw = await fs.promises.readFile(path.join(rootPath, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const lines = [];
    if (pkg.name) lines.push(`Project: ${pkg.name}`);
    if (pkg.description) lines.push(`Description: ${pkg.description}`);
    if (deps.length) lines.push(`Dependencies: ${deps.join(", ")}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}

async function provisionMeshWorkspaceMetadata(ctx = {}) {
  const { rootPath, workspaceId, folderName, sourceKind, sessionId, manifestFiles } = ctx;
  const isCloud = Boolean(workspaceId) && workspaceMetadataStore.enabled;
  const isLocal = Boolean(rootPath);
  const meshPath = ".mesh/workspace-instructions.md";

  try {
    let tree = "";
    let pkgSummary = "";
    if (isLocal) {
      const meshDir = path.join(rootPath, ".mesh");
      const exists = await fs.promises.access(meshDir).then(() => true).catch(() => false);
      if (exists) return; // Local folder already has it
      [tree, pkgSummary] = await Promise.all([
        generateMeshWorkspaceTree(rootPath),
        readPackageJsonSummary(rootPath),
      ]);
    } else if (isCloud) {
      // For cloud, we check if the file already exists in Cosmos
      const existing = await workspaceMetadataStore.getWorkspaceFile(workspaceId, `${folderName}/${meshPath}`);
      if (existing) return;
      tree = generateMeshWorkspaceTreeFromManifest(manifestFiles || [], folderName);
    } else {
      return;
    }

    const sections = [
      "# Mesh AI Workspace Instructions",
      MESH_SYSTEM_PROMPT,
    ];

    if (pkgSummary) {
      sections.push("## Project", pkgSummary);
    }

    sections.push(
      "## Coding Rules",
      "- Write complete, production-ready code. No TODOs, no placeholders, no truncated output.",
      "- Prefer editing existing files over creating new ones.",
      "- Do not add error handling for scenarios that cannot happen.",
      "- Do not add comments unless the logic is non-obvious.",
      "- Do not refactor or clean up code outside the scope of the request.",
      "- Security: never hardcode secrets, always use parameterized queries, validate all external input.",
      "## Edit Behavior",
      "- Use `read_file_range` to fetch the exact lines before performing an edit.",
      "- Prefer structural edits (targeted line changes) over full-file rewrites.",
      "- When a capsule file has `is_skeleton=\"true\"`, fetch the implementation before editing.",
      "## Workspace Structure",
      "```",
      tree || "(empty)",
      "```",
    );

    const content = sections.join("\n");

    if (isLocal) {
      const meshDir = path.join(rootPath, ".mesh");
      await fs.promises.mkdir(meshDir, { recursive: true });
      await fs.promises.writeFile(path.join(meshDir, "workspace-instructions.md"), content, "utf8");
      logger.info('Provisioned local metadata', { scope: 'workspace-infra', meshDir });
    } else if (isCloud) {
      // In cloud mode, we insert a virtual file record
      const meshFilePath = `${folderName}/${meshPath}`;
      await workspaceMetadataStore.upsertWorkspaceFileRecord({
        workspaceId,
        folderName,
        sourceKind: sourceKind || "upload",
        sessionId: sessionId || "",
        path: meshFilePath,
        status: "completed",
        record: {
          path: meshFilePath,
          kind: "source",
          description: "Mesh AI Workspace Instructions",
          originalSize: content.length,
          compressedSize: content.length,
          modelContent: content,
          capsuleMode: "none",
          parserFamily: "markdown",
          storage: { provider: "virtual", blobPath: meshFilePath },
        },
      });
      logger.info('Provisioned virtual metadata', { scope: 'workspace-infra', workspaceId });
    }
  } catch (error) {
    logger.error('Failed to provision metadata', { scope: 'workspace-infra', error: error.message });
  }
}

async function readLocalWorkspaceFileText(absolutePath) {
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    if (buffer.includes(0)) return "[binary or unreadable]";
    let text = buffer.toString("utf8");
    if (text.length > LOCAL_WORKSPACE_MAX_FILE_CHARS) {
      text = `${text.slice(0, LOCAL_WORKSPACE_MAX_FILE_CHARS)}\n\n[mesh note] File truncated during indexing because it exceeded ${LOCAL_WORKSPACE_MAX_FILE_CHARS.toLocaleString()} characters.`;
    }
    return text;
  } catch {
    return "[binary or unreadable]";
  }
}

async function scanLocalWorkspaceFiles(rootPath, folderName) {
  const pending = [{ absolutePath: rootPath, relativePath: "" }];
  const discovered = [];

  while (pending.length) {
    const current = pending.pop();
    let dirents = [];
    try {
      dirents = await fs.promises.readdir(current.absolutePath, { withFileTypes: true });
    } catch {
      continue;
    }

    dirents.sort((a, b) => a.name.localeCompare(b.name));

    for (const dirent of dirents) {
      const relativePath = toSafePath(current.relativePath ? `${current.relativePath}/${dirent.name}` : dirent.name);
      if (!relativePath) continue;

      if (dirent.isDirectory()) {
        if (LOCAL_WORKSPACE_SKIP_DIRS.test(relativePath)) continue;
        pending.push({
          absolutePath: path.join(current.absolutePath, dirent.name),
          relativePath,
        });
        continue;
      }

      if (!dirent.isFile()) continue;
      if (LOCAL_WORKSPACE_SKIP_DIRS.test(relativePath) || LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(relativePath)) continue;

      discovered.push({
        workspacePath: toWorkspacePath(folderName, relativePath),
        absolutePath: path.join(current.absolutePath, dirent.name),
      });
    }
  }

  return discovered;
}

async function packLocalWorkspaceContent(workspacePath, content, options = {}) {
  return buildWorkspaceFileRecord(workspacePath, content, {
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
    recordMode: options.recordMode || "full",
  });
}

function localWorkspaceUploadBlobStorageForPath(filePath, extra = {}) {
  return normalizeWorkspaceBlobStorage({
    provider: "s3",
    blobPath: extra.blobPath || filePath,
  }, filePath);
}

async function packLocalBlobBackedWorkspaceRecord(workspacePath, content, options = {}) {
  const storage = localWorkspaceUploadBlobStorageForPath(workspacePath, options.storage || {});
  if (!storage) {
    throw new Error("Blob-backed workspace storage reference is required.");
  }
  if (options.writeToBlob !== false) {
    await writeWorkspaceBlobText(storage, content);
  }
  return buildWorkspaceFileRecord(workspacePath, content, {
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
    originalSizeOverride: Buffer.byteLength(String(content || ""), "utf8"),
    storage,
    truncated: Boolean(options.truncated),
    persistRawContent: false,
    persistTransportChunks: false,
    recordMode: options.recordMode || "full",
  });
}

async function writeLocalWorkspaceFileToDisk(pathInput, content, options = {}) {
  const { requested, absolutePath } = resolveLocalWorkspaceAbsolutePath(pathInput);
  const overwrite = options.overwrite === true;

  if (!overwrite) {
    try {
      await fs.promises.access(absolutePath, fs.constants.F_OK);
      return { ok: false, error: "File already exists" };
    } catch {
      // File does not exist yet.
    }
  }

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, content, "utf8");

  const packed = await packLocalWorkspaceContent(requested, content);
  localAssistantWorkspace.files.set(requested, {
    path: requested,
    ...packed,
    kind: "source",
  });
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

function normalizeGitError(error) {
  const stderr = String(error?.stderr || "").trim();
  const stdout = String(error?.stdout || "").trim();
  const message = stderr || stdout || String(error?.message || "Git command failed");
  if (/not a git repository/i.test(message)) return "Not a git repository.";
  if (/spawn git/i.test(message) || /enoent/i.test(message)) return "Git is not available on the server.";
  return message;
}

function getLocalGitCwd() {
  if (!isLocalPathWorkspaceState()) {
    throw new Error("No local workspace root configured.");
  }
  return localAssistantWorkspace.rootPath;
}

async function runLocalGit(args, cwd = getLocalGitCwd()) {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    throw new Error(normalizeGitError(error));
  }
}

function isMeshWorkerUnavailableError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("network") ||
    message.includes("timed out") ||
    message.includes("aborted") ||
    message.includes("socket")
  );
}

function countPendingWorkspaceSelectJobs() {
  let pending = 0;
  for (const jobId of workspaceSelectJobOrder) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === "queued" || job.status === "running") pending += 1;
  }
  return pending;
}

function pruneWorkspaceSelectJobs() {
  const now = Date.now();

  for (const jobId of [...workspaceSelectJobOrder]) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === "queued" || job.status === "running") continue;
    if (now - Number(job.createdAtMs || now) <= WORKSPACE_SELECT_JOB_TTL_MS) continue;
    workspaceSelectJobs.delete(jobId);
  }

  for (let i = workspaceSelectJobOrder.length - 1; i >= 0; i -= 1) {
    if (!workspaceSelectJobs.has(workspaceSelectJobOrder[i])) {
      workspaceSelectJobOrder.splice(i, 1);
    }
  }

  while (workspaceSelectJobOrder.length > WORKSPACE_SELECT_MAX_JOB_HISTORY) {
    const oldestId = workspaceSelectJobOrder[0];
    const oldest = workspaceSelectJobs.get(oldestId);
    if (oldest && (oldest.status === "queued" || oldest.status === "running")) break;
    workspaceSelectJobOrder.shift();
    workspaceSelectJobs.delete(oldestId);
  }
}

function estimateWorkspaceSelectPayload(payload = {}) {
  const manifest = Array.isArray(payload?.manifest) ? payload.manifest : [];
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const folderName = String(payload?.folderName || "workspace").trim() || "workspace";
  const append = Boolean(payload?.append);
  const clear = Boolean(payload?.clear);

  let originalBytesEstimate = 0;
  for (const file of files) {
    if (typeof file?.content === "string") {
      originalBytesEstimate += Buffer.byteLength(file.content, "utf8");
      continue;
    }
    if (Number.isFinite(Number(file?.rawStorage?.rawBytes))) {
      originalBytesEstimate += Number(file.rawStorage.rawBytes || 0);
      continue;
    }
    if (Number.isFinite(Number(file?.originalSize))) {
      originalBytesEstimate += Number(file.originalSize || 0);
    }
  }

  const manifestCount = manifest.length;
  const chunkFileCount = files.length;
  const fileCountEstimate = Math.max(manifestCount, chunkFileCount);

  return {
    folderName,
    append,
    clear,
    manifestCount,
    chunkFileCount,
    fileCountEstimate,
    originalBytesEstimate,
  };
}

function workspaceSelectScopeKey(userId, payload = {}) {
  const owner = String(userId || "anon").trim() || "anon";
  if (payload?.clear) return `${owner}:clear`;
  const folderName = toSafeSlug(payload?.folderName || "workspace", "workspace");
  return `${owner}:${folderName}`;
}

function computeWorkspaceSelectQueuePosition(targetJobId) {
  let queuedAhead = 0;
  for (const jobId of workspaceSelectJobOrder) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === "running") {
      if (jobId === targetJobId) return 0;
      continue;
    }
    if (job.status !== "queued") continue;
    queuedAhead += 1;
    if (jobId === targetJobId) return queuedAhead;
  }
  return null;
}

function snapshotWorkspaceSelectJob(job) {
  const safeResult = job?.result && typeof job.result === "object"
    ? {
      ok: job.result.ok !== false,
      mode: String(job.result.mode || ""),
      warning: String(job.result.warning || ""),
      fileCount: Number(job.result.fileCount || 0),
      indexedCount: Number(job.result.indexedCount || 0),
      pendingCount: Number(job.result.pendingCount || 0),
      manifestCount: Number(job.result.manifestCount || 0),
      chunkFileCount: Number(job.result.chunkFileCount || 0),
      originalBytes: Number(job.result.originalBytes || 0),
      compressedBytes: Number(job.result.compressedBytes || 0),
      capsuleBytes: Number(job.result.capsuleBytes || 0),
      transportBytes: Number(job.result.transportBytes || 0),
      ratio: Number.isFinite(Number(job.result.ratio)) ? Number(job.result.ratio) : null,
    }
    : null;

  return {
    id: String(job?.id || ""),
    status: String(job?.status || "unknown"),
    queuePosition: computeWorkspaceSelectQueuePosition(job?.id),
    mode: String(job?.mode || ""),
    createdAt: String(job?.createdAt || ""),
    startedAt: String(job?.startedAt || ""),
    finishedAt: String(job?.finishedAt || ""),
    updatedAt: String(job?.updatedAt || ""),
    error: String(job?.error || ""),
    summary: {
      folderName: String(job?.summary?.folderName || "workspace"),
      append: Boolean(job?.summary?.append),
      clear: Boolean(job?.summary?.clear),
      manifestCount: Number(job?.summary?.manifestCount || 0),
      chunkFileCount: Number(job?.summary?.chunkFileCount || 0),
      fileCountEstimate: Number(job?.summary?.fileCountEstimate || 0),
      originalBytesEstimate: Number(job?.summary?.originalBytesEstimate || 0),
    },
    result: safeResult,
  };
}

function buildWorkspaceSelectAcceptedResponse(job) {
  const summary = job?.summary || {};
  const pendingEstimate = Math.max(
    Number(summary.fileCountEstimate || 0),
    Number(summary.chunkFileCount || 0),
    Number(summary.manifestCount || 0),
  );

  return {
    ok: true,
    queued: true,
    asyncMode: WORKSPACE_SELECT_ASYNC_MODE || "queue",
    jobId: String(job?.id || ""),
    status: String(job?.status || "queued"),
    mode: "async-queue",
    folderName: String(summary.folderName || "workspace"),
    append: Boolean(summary.append),
    cleared: Boolean(summary.clear),
    manifestCount: Number(summary.manifestCount || 0),
    chunkFileCount: Number(summary.chunkFileCount || 0),
    fileCount: Number(summary.fileCountEstimate || 0),
    indexedCount: 0,
    pendingCount: pendingEstimate,
    originalBytes: Number(summary.originalBytesEstimate || 0),
    compressedBytes: 0,
    capsuleBytes: 0,
    transportBytes: 0,
    ratio: null,
    acceptedAt: String(job?.createdAt || toIsoNow()),
  };
}

async function executeWorkspaceSelectWithFallback(selectPayload = {}, requestId = null) {
  try {
    return await meshTunnelRequest("workspace.select", selectPayload, requestId);
  } catch (error) {
    const local = await localWorkspaceSelect(selectPayload);
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    };
  }
}

function enqueueWorkspaceSelectJob(selectPayload = {}, context = {}) {
  pruneWorkspaceSelectJobs();

  if (countPendingWorkspaceSelectJobs() >= WORKSPACE_SELECT_MAX_PENDING) {
    throw new Error("Workspace indexing queue is full. Please retry in a moment.");
  }

  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const ownerUserId = String(context?.userId || "");
  const summary = estimateWorkspaceSelectPayload(selectPayload);
  const job = {
    id: `wsq_${createdAtMs.toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    status: "queued",
    mode: "",
    ownerUserId,
    scopeKey: workspaceSelectScopeKey(ownerUserId, selectPayload),
    summary,
    payload: selectPayload,
    createdAtMs,
    createdAt,
    startedAt: "",
    finishedAt: "",
    updatedAt: createdAt,
    error: "",
    result: null,
  };

  workspaceSelectJobs.set(job.id, job);
  workspaceSelectJobOrder.push(job.id);

  const previous = workspaceSelectChains.get(job.scopeKey) || Promise.resolve();
  const current = previous
    .then(async () => {
      job.status = "running";
      job.startedAt = toIsoNow();
      job.updatedAt = job.startedAt;
      const result = await executeWorkspaceSelectWithFallback(job.payload || {});
      job.result = result;
      job.mode = String(result?.mode || "mesh-worker");
      job.status = "completed";
      job.updatedAt = toIsoNow();

      // Trigger metadata provisioning (Local or Cloud)
      if (result?.ok) {
        provisionMeshWorkspaceMetadata({
          workspaceId: result.workspaceId || job.payload?.workspaceId,
          folderName: result.folderName || job.summary?.folderName,
          rootPath: result.rootPath || job.payload?.rootPath,
          sourceKind: localAssistantWorkspace.sourceKind,
          sessionId: job.payload?.sessionId,
          manifestFiles: job.payload?.files || [], // For cloud tree generation
        }).catch(() => {});
      }
    })
    .catch((error) => {
      job.status = "failed";
      job.error = String(error?.message || "Workspace queue job failed");
      job.updatedAt = toIsoNow();
    })
    .finally(() => {
      job.finishedAt = toIsoNow();
      job.updatedAt = job.finishedAt;
      job.payload = null;
      pruneWorkspaceSelectJobs();
      if (workspaceSelectChains.get(job.scopeKey) === current) {
        workspaceSelectChains.delete(job.scopeKey);
      }
    });

  workspaceSelectChains.set(job.scopeKey, current);
  return job;
}

function shouldQueueWorkspaceSelectPayload(selectPayload = {}) {
  if (!WORKSPACE_SELECT_ASYNC_ENABLED) return false;
  if (Boolean(selectPayload?.clear)) return false;
  if (selectPayload?.sync === true || selectPayload?.async === false) return false;

  const files = Array.isArray(selectPayload?.files) ? selectPayload.files : [];
  const forceAsync = selectPayload?.async === true || String(selectPayload?.mode || "").trim().toLowerCase() === "async";
  return forceAsync || files.length > 0;
}

function getWorkspaceSelectJobForUser(jobId, userId) {
  const job = workspaceSelectJobs.get(String(jobId || ""));
  if (!job) return null;
  const ownerUserId = String(job.ownerUserId || "");
  const requesterUserId = String(userId || "");
  if (ownerUserId && requesterUserId && ownerUserId !== requesterUserId) return null;
  return job;
}

function sortedLocalPaths() {
  return [...localAssistantWorkspace.files.keys()].sort((a, b) => a.localeCompare(b));
}

function normalizeWorkspaceBlobStorage(storage, filePath = "") {
  if (!storage || typeof storage !== "object") return null;
  if (!storage.provider && !storage.blobPath && !storage.s3Key) return null;
  const provider = String(storage.provider || "").trim().toLowerCase();
  if (provider && provider !== "s3") return null;
  const blobPath = toSafePath(storage.blobPath || storage.s3Key || filePath);
  if (!blobPath) return null;
  return { provider: "s3", blobPath };
}

function createWorkspaceOffloadConfig() {
  const requested = config.MESH_S3_OFFLOAD_ENABLED;
  const bucket = config.MESH_S3_BUCKET;
  const prefix = config.MESH_S3_PREFIX || "";
  const maxChunkFiles = config.MESH_S3_OFFLOAD_MAX_CHUNK_FILES;
  const maxChunkBytes = config.MESH_S3_OFFLOAD_MAX_CHUNK_BYTES;
  const maxParallelReads = config.MESH_S3_OFFLOAD_MAX_PARALLEL_READS;
  const maxInflightChunks = config.MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS;

  let enabled = false;
  let reason = "disabled-by-env";
  if (requested && !bucket) reason = "missing-bucket";
  else if (requested && !S3Client) reason = "sdk-not-installed";
  else if (requested) {
    enabled = true;
    reason = "ready";
  }

  return {
    mode: enabled ? "s3" : "direct",
    s3: { enabled, reason, bucket, prefix, maxChunkFiles, maxChunkBytes, maxParallelReads, maxInflightChunks },
    // Legacy alias so callers that read workspaceOffloadConfig.azureBlob still get a safe object
    azureBlob: { enabled: false, reason: "migrated-to-s3" },
  };
}

const workspaceOffloadConfig = createWorkspaceOffloadConfig();

function workspaceOffloadClientConfig() {
  const s3 = workspaceOffloadConfig.s3 || {};
  return {
    ok: true,
    mode: s3.enabled ? "s3" : "direct",
    s3: {
      enabled: Boolean(s3.enabled),
      reason: String(s3.reason || "disabled-by-env"),
      bucket: s3.enabled ? String(s3.bucket || "") : "",
      prefix: String(s3.prefix || ""),
      maxChunkFiles: Number(s3.maxChunkFiles || 0),
      maxChunkBytes: Number(s3.maxChunkBytes || 0),
      maxParallelReads: Number(s3.maxParallelReads || 0),
      maxInflightChunks: Number(s3.maxInflightChunks || 0),
    },
    // Legacy field — kept so frontend code that reads .azureBlob doesn't crash
    azureBlob: { enabled: false, reason: "migrated-to-s3" },
  };
}

async function compressLocalWorkspaceText(rawText) {
  const normalized = typeof rawText === "string" ? rawText : String(rawText || "");
  const buffer = await brotliCompress(Buffer.from(normalized, "utf8"), {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: WORKSPACE_BROTLI_QUALITY,
    },
  });

  return {
    compressedBase64: buffer.toString("base64"),
    originalSize: Buffer.byteLength(normalized, "utf8"),
    compressedSize: buffer.length,
  };
}

async function decompressLocalWorkspaceText(base64Buffer) {
  const unpacked = await brotliDecompress(Buffer.from(base64Buffer, "base64"));
  return unpacked.toString("utf8");
}

function normalizeIncomingWorkspacePreindexedFile(candidate, filePath) {
  if (!candidate || typeof candidate !== "object") return null;
  const normalized = {
    ...candidate,
    path: filePath,
  };

  if (!normalized.transportEnvelope && normalized.envelopeVersion && Array.isArray(normalized.chunks)) {
    normalized.transportEnvelope = {
      envelopeVersion: normalized.envelopeVersion,
      contentEncoding: normalized.contentEncoding,
      rawBytes: normalized.rawBytes,
      compressedBytes: normalized.compressedBytes,
      chunkSize: normalized.chunkSize,
      chunkCount: normalized.chunkCount,
      spanCount: normalized.spanCount,
      digest: normalized.digest,
      chunkIndex: Array.isArray(normalized.chunkIndex) ? normalized.chunkIndex : [],
      spanIndex: normalized.spanIndex && typeof normalized.spanIndex === "object" ? normalized.spanIndex : {},
      chunks: normalized.chunks,
      manifestText: typeof normalized.manifestText === "string" ? normalized.manifestText : "",
    };
  }

  const storage = normalizeWorkspaceBlobStorage(candidate?.storage, filePath);
  if (storage) {
    normalized.storage = storage;
  }

  return normalized;
}

async function readWorkspaceBlobText(storage = {}, sizeBytes = 0) {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error("S3 storage reference missing.");

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  const response = await getS3Client().send(new GetObjectCommand({ Bucket: s3.bucket, Key: key }));
  if (!response.Body) throw new Error("S3 download returned empty body.");

  const decoder = new TextDecoder("utf-8", { fatal: false });
  const sizeLimit = 25_000_000;
  let totalBytes = 0;
  let textLength = 0;
  let truncated = false;
  let binary = false;
  let content = "";

  for await (const chunk of response.Body) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += value.length;
    for (let i = 0; i < value.length; i += 1) {
      if (value[i] === 0) { binary = true; break; }
    }
    if (binary) break;
    if (textLength >= sizeLimit) { truncated = true; continue; }
    const decoded = decoder.decode(value, { stream: true });
    const remaining = sizeLimit - textLength;
    if (decoded.length <= remaining) {
      content += decoded;
      textLength += decoded.length;
    } else {
      content += decoded.slice(0, remaining);
      textLength += remaining;
      truncated = true;
    }
  }

  if (binary) {
    return { content: "[binary or unreadable]", byteLength: totalBytes || Number(sizeBytes || 0) };
  }

  const tail = decoder.decode();
  if (tail && textLength < sizeLimit) {
    const remaining = sizeLimit - textLength;
    content += tail.length <= remaining ? tail : tail.slice(0, remaining);
    textLength += Math.min(tail.length, remaining);
    if (tail.length > remaining) truncated = true;
  }

  if (truncated) {
    content += `\n\n[mesh note] File truncated during indexing because it exceeded ${sizeLimit.toLocaleString()} characters.`;
  }

  return { content, byteLength: totalBytes || Number(sizeBytes || 0) };
}

async function writeWorkspaceBlobText(storage = {}, content = "") {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error("S3 storage reference missing.");

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  await getS3Client().send(new PutObjectCommand({
    Bucket: s3.bucket,
    Key: key,
    Body: String(content || ""),
    ContentType: "text/plain; charset=utf-8",
  }));
  return normalized;
}

async function copyWorkspaceBlob(sourceStorage = {}, targetStorage = {}) {
  const normalizedSource = normalizeWorkspaceBlobStorage(sourceStorage);
  const normalizedTarget = normalizeWorkspaceBlobStorage(targetStorage);
  if (!normalizedSource || !normalizedTarget) throw new Error("S3 copy references are invalid.");

  const s3 = workspaceOffloadConfig.s3;
  const sourceKey = s3.prefix ? `${s3.prefix}/${normalizedSource.blobPath}` : normalizedSource.blobPath;
  const targetKey = s3.prefix ? `${s3.prefix}/${normalizedTarget.blobPath}` : normalizedTarget.blobPath;

  await getS3Client().send(new CopyObjectCommand({
    Bucket: s3.bucket,
    CopySource: `${s3.bucket}/${sourceKey}`,
    Key: targetKey,
  }));
  return normalizedTarget;
}

async function deleteWorkspaceBlob(storage = {}) {
  const normalized = normalizeWorkspaceBlobStorage(storage);
  if (!normalized) throw new Error("S3 storage reference missing.");

  const s3 = workspaceOffloadConfig.s3;
  const key = s3.prefix ? `${s3.prefix}/${normalized.blobPath}` : normalized.blobPath;

  try {
    await getS3Client().send(new DeleteObjectCommand({ Bucket: s3.bucket, Key: key }));
  } catch (error) {
    if (error?.name !== 'NoSuchKey') throw error;
  }
}

module.exports = {
  meshTunnelRequest,
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
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
  createWorkspacePerfTracker,
  mapWithConcurrency,
  isWorkspaceIndexablePath,
  generateMeshWorkspaceTree,
  generateMeshWorkspaceTreeFromManifest,
  provisionMeshWorkspaceMetadata,
  readLocalWorkspaceFileText,
  scanLocalWorkspaceFiles,
  packLocalWorkspaceContent,
  localWorkspaceUploadBlobStorageForPath,
  packLocalBlobBackedWorkspaceRecord,
  writeLocalWorkspaceFileToDisk,
  normalizeGitError,
  getLocalGitCwd,
  runLocalGit,
  isMeshWorkerUnavailableError,
  countPendingWorkspaceSelectJobs,
  pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload,
  workspaceSelectScopeKey,
  computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob,
  buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback,
  enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload,
  getWorkspaceSelectJobForUser,
  sortedLocalPaths,
  normalizeWorkspaceBlobStorage,
  createWorkspaceOffloadConfig,
  workspaceOffloadConfig,
  workspaceOffloadClientConfig,
  compressLocalWorkspaceText,
  decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile,
  readWorkspaceBlobText,
  writeWorkspaceBlobText,
  copyWorkspaceBlob,
  deleteWorkspaceBlob,
};
