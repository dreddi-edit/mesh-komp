'use strict';

/**
 * Workspace provisioning, local file scan, git helpers, and disk write operations.
 * References globals injected by core/index.js and functions from sibling modules.
 */

const fs = require('fs');
const path = require('path');

const { MESH_SYSTEM_PROMPT } = require('../model-providers');
const logger = require('../../logger');

const { toSafePath, mapWithConcurrency } = require('./path-utils');
const { toWorkspacePath, resolveLocalWorkspaceAbsolutePath, isLocalPathWorkspaceState } = require('./state-meta');
const { normalizeWorkspaceBlobStorage, writeWorkspaceBlobText } = require('./s3-ops');

const SCAN_DIR_CONCURRENCY = 8;

/**
 * Generates a recursive directory tree string for metadata provisioning (Local).
 * @param {string} rootPath
 * @param {string} [currentPath]
 * @param {number} [depth]
 * @returns {Promise<string>}
 */
async function generateMeshWorkspaceTree(rootPath, currentPath = '', depth = 0) {
  if (depth > 6) return '';
  const absolutePath = path.join(rootPath, currentPath);
  let result = '';

  try {
    const entries = await fs.promises.readdir(absolutePath, { withFileTypes: true });
    entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });

    for (const entry of entries) {
      if (LOCAL_WORKSPACE_SKIP_DIRS.test(entry.name)) continue;
      const indent = '  '.repeat(depth);
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
 * @param {object[]} [files]
 * @param {string} [folderName]
 * @returns {string}
 */
function generateMeshWorkspaceTreeFromManifest(files = [], folderName = 'workspace') {
  const tree = {};
  const rootName = String(folderName || 'workspace').trim() || 'workspace';

  for (const file of files) {
    const filePath = String(file.path || file.name || '').trim();
    if (!filePath) continue;
    if (LOCAL_WORKSPACE_SKIP_DIRS.test(filePath)) continue;
    const parts = filePath.split('/');
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
    const indent = '  '.repeat(depth);
    if (node === null) {
      if (LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(name)) return '';
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
 * Reads package.json from rootPath and returns a flat project summary.
 * @param {string} rootPath
 * @returns {Promise<string>}
 */
async function readPackageJsonSummary(rootPath) {
  if (!rootPath) return '';
  try {
    const raw = await fs.promises.readFile(path.join(rootPath, 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const lines = [];
    if (pkg.name) lines.push(`Project: ${pkg.name}`);
    if (pkg.description) lines.push(`Description: ${pkg.description}`);
    if (deps.length) lines.push(`Dependencies: ${deps.join(', ')}`);
    return lines.join('\n');
  } catch {
    return '';
  }
}

/**
 * Automatically provisions .mesh/workspace-instructions.md if it doesn't exist.
 * Supports both Local and Cloud backends.
 * @param {object} [ctx]
 * @returns {Promise<void>}
 */
async function provisionMeshWorkspaceMetadata(ctx = {}) {
  const { rootPath, workspaceId, folderName, sourceKind, sessionId, manifestFiles } = ctx;
  const isCloud = Boolean(workspaceId) && workspaceMetadataStore.enabled;
  const isLocal = Boolean(rootPath);
  const meshPath = '.mesh/workspace-instructions.md';

  try {
    let tree = '';
    let pkgSummary = '';
    if (isLocal) {
      [tree, pkgSummary] = await Promise.all([
        generateMeshWorkspaceTree(rootPath),
        readPackageJsonSummary(rootPath),
      ]);
    } else if (isCloud) {
      tree = generateMeshWorkspaceTreeFromManifest(manifestFiles || [], folderName);
    } else {
      return;
    }

    const sections = ['# Mesh AI Workspace Instructions', MESH_SYSTEM_PROMPT];

    if (pkgSummary) {
      sections.push('## Project', pkgSummary);
    }

    sections.push(
      '## Coding Rules',
      '- Write complete, production-ready code. No TODOs, no placeholders, no truncated output.',
      '- Prefer editing existing files over creating new ones.',
      '- Do not add error handling for scenarios that cannot happen.',
      '- Do not add comments unless the logic is non-obvious.',
      '- Do not refactor or clean up code outside the scope of the request.',
      '- Security: never hardcode secrets, always use parameterized queries, validate all external input.',
      '## Edit Behavior',
      '- Use `read_file_range` to fetch the exact lines before performing an edit.',
      '- Prefer structural edits (targeted line changes) over full-file rewrites.',
      '- When a capsule file has `is_skeleton="true"`, fetch the implementation before editing.',
      '## Workspace Structure',
      '```',
      tree || '(empty)',
      '```',
    );

    const content = sections.join('\n');

    if (isLocal) {
      const meshDir = path.join(rootPath, '.mesh');
      await fs.promises.mkdir(meshDir, { recursive: true });
      await fs.promises.writeFile(path.join(meshDir, 'workspace-instructions.md'), content, 'utf8');
      logger.info('Provisioned local metadata', { scope: 'workspace-infra', meshDir });
    } else if (isCloud) {
      const meshFilePath = `${folderName}/${meshPath}`;
      await workspaceMetadataStore.upsertWorkspaceFileRecord({
        workspaceId,
        folderName,
        sourceKind: sourceKind || 'upload',
        sessionId: sessionId || '',
        path: meshFilePath,
        status: 'completed',
        record: {
          path: meshFilePath,
          kind: 'source',
          description: 'Mesh AI Workspace Instructions',
          originalSize: content.length,
          compressedSize: content.length,
          modelContent: content,
          capsuleMode: 'none',
          parserFamily: 'markdown',
          storage: { provider: 'virtual', blobPath: meshFilePath },
        },
      });
      logger.info('Provisioned virtual metadata', { scope: 'workspace-infra', workspaceId });
    }
  } catch (error) {
    logger.error('Failed to provision metadata', { scope: 'workspace-infra', error: error.message });
  }
}

/**
 * @param {string} absolutePath
 * @returns {Promise<string>}
 */
async function readLocalWorkspaceFileText(absolutePath) {
  try {
    const buffer = await fs.promises.readFile(absolutePath);
    if (buffer.includes(0)) return '[binary or unreadable]';
    let text = buffer.toString('utf8');
    if (text.length > LOCAL_WORKSPACE_MAX_FILE_CHARS) {
      text = `${text.slice(0, LOCAL_WORKSPACE_MAX_FILE_CHARS)}\n\n[mesh note] File truncated during indexing because it exceeded ${LOCAL_WORKSPACE_MAX_FILE_CHARS.toLocaleString()} characters.`;
    }
    return text;
  } catch {
    return '[binary or unreadable]';
  }
}

/**
 * @param {string} rootPath
 * @param {string} folderName
 * @returns {Promise<Array<{ workspacePath: string, absolutePath: string }>>}
 */
async function scanLocalWorkspaceFiles(rootPath, folderName) {
  let pending = [{ absolutePath: rootPath, relativePath: '' }];
  const discovered = [];

  while (pending.length) {
    const batch = pending;
    pending = [];

    const results = await mapWithConcurrency(batch, SCAN_DIR_CONCURRENCY, async (current) => {
      let dirents;
      try {
        dirents = await fs.promises.readdir(current.absolutePath, { withFileTypes: true });
      } catch {
        return { files: [], subdirs: [] };
      }

      dirents.sort((a, b) => a.name.localeCompare(b.name));
      const files = [];
      const subdirs = [];

      for (const dirent of dirents) {
        const relativePath = toSafePath(current.relativePath ? `${current.relativePath}/${dirent.name}` : dirent.name);
        if (!relativePath) continue;

        if (dirent.isDirectory()) {
          if (!LOCAL_WORKSPACE_SKIP_DIRS.test(relativePath)) {
            subdirs.push({ absolutePath: path.join(current.absolutePath, dirent.name), relativePath });
          }
          continue;
        }

        if (!dirent.isFile()) continue;
        if (LOCAL_WORKSPACE_SKIP_DIRS.test(relativePath) || LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(relativePath)) continue;

        files.push({
          workspacePath: toWorkspacePath(folderName, relativePath),
          absolutePath: path.join(current.absolutePath, dirent.name),
        });
      }

      return { files, subdirs };
    });

    for (const { files, subdirs } of results) {
      discovered.push(...files);
      pending.push(...subdirs);
    }
  }

  return discovered;
}

/**
 * @param {string} workspacePath
 * @param {string} content
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function packLocalWorkspaceContent(workspacePath, content, options = {}) {
  return buildWorkspaceFileRecord(workspacePath, content, {
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
    recordMode: options.recordMode || 'full',
  });
}

/**
 * @param {string} filePath
 * @param {object} [extra]
 * @returns {{ provider: string, blobPath: string }|null}
 */
function localWorkspaceUploadBlobStorageForPath(filePath, extra = {}) {
  return normalizeWorkspaceBlobStorage({
    provider: 's3',
    blobPath: extra.blobPath || filePath,
  }, filePath);
}

/**
 * @param {string} workspacePath
 * @param {string} content
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function packLocalBlobBackedWorkspaceRecord(workspacePath, content, options = {}) {
  const storage = localWorkspaceUploadBlobStorageForPath(workspacePath, options.storage || {});
  if (!storage) {
    throw new Error('Blob-backed workspace storage reference is required.');
  }
  if (options.writeToBlob !== false) {
    await writeWorkspaceBlobText(storage, content);
  }
  return buildWorkspaceFileRecord(workspacePath, content, {
    legacyBrotliQuality: WORKSPACE_BROTLI_QUALITY,
    initialBrotliQuality: WORKSPACE_INITIAL_BROTLI_QUALITY,
    originalSizeOverride: Buffer.byteLength(String(content || ''), 'utf8'),
    storage,
    truncated: Boolean(options.truncated),
    persistRawContent: false,
    persistTransportChunks: false,
    recordMode: options.recordMode || 'full',
  });
}

/**
 * @param {string} pathInput
 * @param {string} content
 * @param {object} [options]
 * @returns {Promise<object>}
 */
async function writeLocalWorkspaceFileToDisk(pathInput, content, options = {}) {
  const { requested, absolutePath } = resolveLocalWorkspaceAbsolutePath(pathInput);
  const overwrite = options.overwrite === true;

  if (!overwrite) {
    try {
      await fs.promises.access(absolutePath, fs.constants.F_OK);
      return { ok: false, error: 'File already exists' };
    } catch {
      // File does not exist yet.
    }
  }

  await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.promises.writeFile(absolutePath, content, 'utf8');

  const packed = await packLocalWorkspaceContent(requested, content);
  localAssistantWorkspace.files.set(requested, {
    path: requested,
    ...packed,
    kind: 'source',
  });
  localAssistantWorkspace.indexedAt = new Date().toISOString();
  persistLocalWorkspaceState();

  return {
    ok: true,
    mode: 'local-fallback',
    path: requested,
    originalSize: Number(packed.originalSize || 0),
    compressedSize: Number(packed.compressedSize || 0),
    capsuleBytes: Number(packed.compressionStats?.capsuleBytes || 0),
    transportBytes: Number(packed.compressionStats?.transportBytes || 0),
    updatedAt: localAssistantWorkspace.indexedAt,
  };
}

/** @param {Error} error @returns {string} */
function normalizeGitError(error) {
  const stderr = String(error?.stderr || '').trim();
  const stdout = String(error?.stdout || '').trim();
  const message = stderr || stdout || String(error?.message || 'Git command failed');
  if (/not a git repository/i.test(message)) return 'Not a git repository.';
  if (/spawn git/i.test(message) || /enoent/i.test(message)) return 'Git is not available on the server.';
  return message;
}

/** @returns {string} */
function getLocalGitCwd() {
  if (!isLocalPathWorkspaceState()) {
    throw new Error('No local workspace root configured.');
  }
  return localAssistantWorkspace.rootPath;
}

/**
 * @param {string[]} args
 * @param {string} [cwd]
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
async function runLocalGit(args, cwd = getLocalGitCwd()) {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });
    return { stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    throw new Error(normalizeGitError(error));
  }
}

/** @param {Error} error @returns {boolean} */
function isMeshWorkerUnavailableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('fetch failed') ||
    message.includes('econnrefused') ||
    message.includes('enotfound') ||
    message.includes('network') ||
    message.includes('timed out') ||
    message.includes('aborted') ||
    message.includes('socket')
  );
}

module.exports = {
  generateMeshWorkspaceTree,
  generateMeshWorkspaceTreeFromManifest,
  readPackageJsonSummary,
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
};
