'use strict';

/**
 * Workspace path utilities, perf tracker, concurrency helper, and tunnel request.
 * These functions are pure or have only external (SDK) deps — no circular imports.
 */

const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const brotliCompress = promisify(zlib.brotliCompress);
const brotliDecompress = promisify(zlib.brotliDecompress);

const config = require('../../config');
const logger = require('../../logger');

/** @param {string} rawPath @returns {string} */
function toSafePath(rawPath) {
  const input = String(rawPath || '').replace(/\\/g, '/').trim();
  if (!input) return '';
  const normalized = path.posix.normalize(`/${input}`).replace(/^\/+/, '');
  return normalized === '.' ? '' : normalized;
}

/** @param {string} filePath @returns {string} */
function basename(filePath) {
  const normalized = toSafePath(filePath);
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

/**
 * @param {string} pathInput
 * @param {string} workspaceFolderName
 * @returns {string}
 */
function ensureWorkspaceOwnedPath(pathInput, workspaceFolderName) {
  const requested = toSafePath(pathInput);
  if (!requested) return '';
  const root = toSafePath(workspaceFolderName);
  if (!root) return requested;
  if (requested === root || requested.startsWith(`${root}/`)) return requested;
  return `${root}/${requested}`;
}

/**
 * @param {string} scope
 * @param {object} [meta]
 * @returns {{ mark: Function, flush: Function }}
 */
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
      }).join(' | ');
      logger.info(`Perf: ${scope}`, { scope: 'mesh-perf', totalMs, ...meta, ...extra, steps: detail || undefined });
    },
  };
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T, index: number) => Promise<*>} mapper
 * @returns {Promise<*[]>}
 */
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

/** @param {string} pathInput @returns {boolean} */
function isWorkspaceIndexablePath(pathInput = '') {
  const normalized = toSafePath(pathInput);
  if (!normalized) return false;
  if (LOCAL_WORKSPACE_SKIP_DIRS.test(normalized)) return false;
  if (LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(normalized)) return false;
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock)$/i.test(normalized)) return false;
  if (/\.min\.(js|css)$/.test(normalized)) return false;
  return true;
}

/**
 * @param {string} action
 * @param {object} [data]
 * @param {string|null} [requestId]
 * @returns {Promise<object>}
 */
async function meshTunnelRequest(action, data = {}, requestId = null) {
  const envelope = JSON.stringify({ action, data });
  const compressed = await brotliCompress(Buffer.from(envelope, 'utf8'), {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: MESH_TUNNEL_BROTLI_QUALITY,
    },
  });

  const headers = {
    'Content-Type': 'application/octet-stream',
    'X-Mesh-Encoding': 'brotli',
    'X-Mesh-Worker-Secret': process.env.MESH_WORKER_SECRET || '',
  };
  if (requestId) headers['X-Request-ID'] = String(requestId);

  const response = await fetch(MESH_CORE_URL, { method: 'POST', headers, body: compressed });
  const packed = Buffer.from(await response.arrayBuffer());
  const unpacked = await brotliDecompress(packed);
  const parsed = JSON.parse(unpacked.toString('utf8'));

  if (!response.ok || parsed.ok === false) {
    throw new Error(parsed.error || `Mesh worker request failed (${response.status})`);
  }
  return parsed;
}

module.exports = {
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
  createWorkspacePerfTracker,
  mapWithConcurrency,
  isWorkspaceIndexablePath,
  meshTunnelRequest,
};
