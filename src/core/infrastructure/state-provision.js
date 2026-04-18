'use strict';

/**
 * Workspace provisioning, local file scan, git helpers, and disk write operations.
 * References globals injected by core/index.js and functions from sibling modules.
 */

const fs = require('fs');
const path = require('path');

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
