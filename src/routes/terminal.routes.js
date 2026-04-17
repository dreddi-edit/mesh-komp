'use strict';

/**
 * Terminal WebSocket handler for Mesh.
 *
 * Spawns a node-pty shell session per connection.
 * For local-path workspaces, CWD is the real rootPath.
 * For upload workspaces, files are materialized to a local temp dir before the shell spawns.
 *
 * Call setupTerminalRelay(server, { projectRoot, core }) once after the HTTP server is created.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { WebSocketServer } = require('ws');
const config = require('../config');

const TERMINAL_UPLOAD_ROOT = config.MESH_TERMINAL_UPLOAD_ROOT
  || path.join(os.tmpdir(), 'mesh-terminal-workspaces');

/**
 * Strips sensitive environment variables before passing process.env to a spawned shell.
 * Preserves PATH, HOME, TERM and other runtime necessities.
 * Blocklist includes common secret identifiers (KEY, SECRET, TOKEN, etc) as well as
 * cloud provider prefixes (AWS, GOOGLE, AZURE).
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}
 */
const SENSITIVE_ENV_PATTERN = /(KEY|SECRET|PASSWORD|TOKEN|CREDENTIAL|PRIVATE|AUTH|JWT|CERT|SIG|SIGNATURE|AKIA|ASIA|ASCA|APKA|BEDROCK|ANTHROPIC|OPENAI|GEMINI)/i;

function sanitizeEnvForShell(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !SENSITIVE_ENV_PATTERN.test(key))
  );
}

/**
 * @param {string} value
 * @param {string} [fallback]
 * @returns {string}
 */
function sanitizeTerminalSegment(value, fallback = 'workspace') {
  const raw  = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || fallback;
}

/**
 * @param {{ folderName?: string, workspaceId?: string }} workspace
 * @returns {string}
 */
function buildMaterializedWorkspaceRoot(workspace = {}) {
  const folderName = sanitizeTerminalSegment(workspace.folderName, 'workspace');
  const identity   = sanitizeTerminalSegment(workspace.workspaceId || folderName, 'workspace');
  return path.join(TERMINAL_UPLOAD_ROOT, `${folderName}-${identity}`);
}

/**
 * @param {string} targetRoot
 * @param {{ workspaceId?: string, indexedAt?: string, fileCountCompleted?: number }} workspace
 * @returns {Promise<boolean>}
 */
async function shouldReuseMaterializedWorkspace(targetRoot, workspace = {}) {
  try {
    const markerPath = path.join(targetRoot, '.mesh-terminal-meta.json');
    const raw    = await fs.promises.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    return (
      String(marker.workspaceId       || '') === String(workspace.workspaceId       || '') &&
      String(marker.indexedAt         || '') === String(workspace.indexedAt         || '') &&
      Number(marker.fileCountCompleted || 0)  === Number(workspace.fileCountCompleted || 0)
    );
  } catch {
    return false;
  }
}

/**
 * @param {{ workspaceId?: string, files?: Map<string, unknown> }} workspace
 * @param {{ workspaceMetadataStore: { enabled: boolean, listWorkspaceFiles: Function } }} deps
 * @returns {Promise<Array<{ path: string }>>}
 */
async function listMaterializableWorkspaceFiles(workspace = {}, deps = {}) {
  const workspaceId = String(workspace.workspaceId || '').trim();
  const { workspaceMetadataStore } = deps;
  if (workspaceMetadataStore?.enabled && workspaceId) {
    const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return docs.filter((doc) => String(doc?.status || 'completed').toLowerCase() === 'completed' && doc?.path);
  }
  return [...(workspace.files?.values?.() || [])].filter((doc) => doc?.path);
}

/**
 * Downloads all workspace files from Blob/Cosmos into a local temp directory,
 * then writes a marker file so subsequent connections can reuse the materialized tree.
 *
 * @param {{ workspaceId?: string, folderName?: string, indexedAt?: string, fileCountCompleted?: number, sessionId?: string }} workspace
 * @param {{ workspaceMetadataStore: object, toSafePath: Function, toWorkspaceRelativePath: Function, openWorkspaceFileWithFallback: Function, mapWithConcurrency: Function }} deps
 * @returns {Promise<string>} Absolute path to the materialized workspace root
 */
async function materializeUploadWorkspaceRoot(workspace = {}, deps = {}) {
  const {
    workspaceMetadataStore,
    toSafePath,
    toWorkspaceRelativePath,
    openWorkspaceFileWithFallback,
    mapWithConcurrency,
  } = deps;

  const targetRoot = buildMaterializedWorkspaceRoot(workspace);
  if (await shouldReuseMaterializedWorkspace(targetRoot, workspace)) {
    return targetRoot;
  }

  const files = await listMaterializableWorkspaceFiles(workspace, { workspaceMetadataStore });
  await fs.promises.rm(targetRoot, { recursive: true, force: true });
  await fs.promises.mkdir(targetRoot, { recursive: true });

  const writeOne = async (meta) => {
    const workspacePath = toSafePath
      ? toSafePath(meta?.path)
      : String(meta?.path || '').trim();
    if (!workspacePath) return;

    const relativePath = toWorkspaceRelativePath
      ? toWorkspaceRelativePath(workspacePath, workspace.folderName)
      : workspacePath;
    if (!relativePath) return;

    const opened = await openWorkspaceFileWithFallback(workspacePath, 'original', {
      workspaceId: workspace.workspaceId || '',
      sessionId:   workspace.sessionId   || '',
    });
    const absolutePath = path.join(targetRoot, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, String(opened?.content || ''), 'utf8');
  };

  const mapper = mapWithConcurrency
    || (async (items, _limit, fn) => Promise.all(items.map(fn)));
  await mapper(files, 6, writeOne);

  await fs.promises.writeFile(
    path.join(targetRoot, '.mesh-terminal-meta.json'),
    JSON.stringify({
      workspaceId:        workspace.workspaceId        || '',
      folderName:         workspace.folderName         || '',
      indexedAt:          workspace.indexedAt          || '',
      fileCountCompleted: Number(workspace.fileCountCompleted || files.length),
    }, null, 2),
    'utf8'
  );

  return targetRoot;
}

/**
 * Resolves the correct CWD for a new terminal session.
 *
 * Priority:
 *   1. Local-path workspace  → use real rootPath
 *   2. Upload workspace      → materialize to temp dir
 *   3. Fallback              → project root
 *
 * @param {string} projectRoot  Fallback CWD when no workspace is active
 * @param {{ localAssistantWorkspace: object, workspaceMetadataStore: object, toSafePath: Function, toWorkspaceRelativePath: Function, openWorkspaceFileWithFallback: Function, mapWithConcurrency: Function }} deps
 * @returns {Promise<{ cwd: string, note: string }>}
 */
async function resolveTerminalCwd(projectRoot, deps = {}) {
  const workspace = deps.localAssistantWorkspace || {};

  if (String(workspace.sourceKind || '').trim() === 'local-path' && workspace.rootPath) {
    return { cwd: workspace.rootPath, note: workspace.rootPath };
  }

  if (workspace.rootPath && workspace.rootPath !== '') {
    return { cwd: workspace.rootPath, note: workspace.rootPath };
  }

  if (String(workspace.workspaceId || '').trim() && String(workspace.folderName || '').trim()) {
    const cwd = await materializeUploadWorkspaceRoot(workspace, deps);
    return { cwd, note: `${cwd} (materialized from uploaded workspace)` };
  }

  return { cwd: projectRoot, note: projectRoot };
}

/**
 * Attaches terminal WebSocket handling to an existing HTTP server.
 *
 * @param {import('http').Server} server
 * @param {{ projectRoot: string, core: object }} opts
 */
function setupTerminalRelay(server, { projectRoot, core }) {
  const {
    workspaceMetadataStore,
    toSafePath,
    toWorkspaceRelativePath,
    openWorkspaceFileWithFallback,
    mapWithConcurrency,
    readAuthTokenFromRequest,
    resolveAuthUserFromRequest,
  } = core;

  // Stable material deps passed to workspace helpers on each connection
  const materialDeps = {
    workspaceMetadataStore,
    toSafePath,
    toWorkspaceRelativePath,
    openWorkspaceFileWithFallback,
    mapWithConcurrency,
  };

  let nodePty;
  try { nodePty = require('node-pty'); } catch { nodePty = null; }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/terminal') return;

    try {
      const token = readAuthTokenFromRequest(req);
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const resolved = await resolveAuthUserFromRequest(req);
      if (!resolved) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', async (ws, req) => {
    if (!nodePty) {
      try { ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m● node-pty not available on this server.\x1b[0m\r\n' })); } catch {}
      ws.close();
      return;
    }

    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const shellPref = urlParams.get('shell');
    const clientFolder = urlParams.get('folder') || '';
    const clientWorkspaceId = urlParams.get('workspaceId') || '';

    // Allowlist of acceptable shell names — never pass unvalidated client input to spawn().
    // node-pty uses execvp (no shell expansion), but restricting to known shells prevents
    // clients from spawning arbitrary binaries (e.g. ?shell=/path/to/malicious-binary).
    const ALLOWED_SHELLS = new Set(['bash', 'sh', 'zsh', 'fish', '/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/fish']);
    let shell = ALLOWED_SHELLS.has(shellPref) ? shellPref : (process.env.SHELL || 'bash');

    // Resolve to absolute path on Linux — ignore client-supplied value not in allowlist.
    if (process.platform !== 'win32' && !shell.startsWith('/')) {
      shell = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
    }

    let cwdInfo = { cwd: projectRoot, note: projectRoot };
    try {
      // Access core.localAssistantWorkspace directly for live state (not a snapshot from setup time)
      cwdInfo = await resolveTerminalCwd(projectRoot, {
        localAssistantWorkspace: core.localAssistantWorkspace,
        clientFolder,
        clientWorkspaceId,
        ...materialDeps,
      });
    } catch (error) {
      try {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[33m● Workspace mount fallback: ${String(error?.message || 'failed to materialize upload workspace')}\x1b[0m\r\n`,
        }));
      } catch {}
    }

    const proc = nodePty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 120,
      rows: 36,
      cwd:  cwdInfo.cwd,
      env:  sanitizeEnvForShell(process.env),
    });

    proc.onData((data) => { try { ws.send(JSON.stringify({ type: 'output', data })); } catch {} });
    proc.onExit(() => { try { ws.send(JSON.stringify({ type: 'exit' })); ws.close(); } catch {} });

    const isLocalServer = !process.env.EC2_INSTANCE_ID && !process.env.AWS_EXECUTION_ENV && (
      os.hostname().includes('.local') || os.hostname().includes('localhost') ||
      cwdInfo.cwd.startsWith('/Users/') || cwdInfo.cwd.startsWith('/home/')
    );
    const modeLabel = isLocalServer ? 'Local Terminal' : 'Remote Terminal';
    try {
      ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[36m● ${modeLabel} — ${cwdInfo.note}\x1b[0m\r\n` }));
    } catch {}

    ws.on('message', (msg) => {
      try {
        const { type, data, cols, rows } = JSON.parse(msg);
        if (type === 'input')  proc.write(data);
        if (type === 'resize') proc.resize(cols, rows);
      } catch {}
    });

    ws.on('close', () => { try { proc.kill(); } catch {} });
  });
}

module.exports = { setupTerminalRelay, listMaterializableWorkspaceFiles, resolveTerminalCwd };
