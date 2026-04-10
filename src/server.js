const express = require('express');
const path = require('path');
const fs = require('fs');
const os = require('os');
const core = require('./core/index');

// Destructure all required core logic directly into global scope for routes (fast monolithic refactor)
Object.keys(core).forEach(k => {
    global[k] = core[k];
});

const app = express();

app.use(express.json({ limit: "200mb" }));

// Serve root (/) from views/index.html
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'views', 'index.html'));
});

// Clean URL support: check views/ first, then root, for any path with no file extension
app.use((req, res, next) => {
  if (req.path === '/') return next();
  if (req.path.slice(1).indexOf('.') === -1) {
    const inViews = path.join(__dirname, '..', 'views', req.path + '.html');
    if (fs.existsSync(inViews)) return res.sendFile(inViews);
    const atRoot = path.join(__dirname, '..', req.path + '.html');
    if (fs.existsSync(atRoot)) return res.sendFile(atRoot);
  }
  next();
});

// Point static files to the root directory, not the /src directory!
// Keep the fast-changing workbench assets effectively uncached so UI/graph fixes
// are visible immediately after deploy.
app.use(express.static(path.join(__dirname, '..'), {
  setHeaders(res, filePath) {
    const normalized = String(filePath || '').replace(/\\/g, '/');
    if (/(\/assets\/app-workspace\.js|\/assets\/app-graph\.js|\/assets\/app-workspace\.css|\/assets\/features\/voice-chat\.js)$/.test(normalized)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  },
}));


const authRoutes = require('./routes/auth.routes');
const appRoutes = require('./routes/app.routes');
const assistantRoutes = require('./routes/assistant.routes');
const { setupRealtimeRelay } = require('./routes/realtime.routes');

const http = require('http');
const { WebSocketServer } = require('ws');
const server = http.createServer(app);

/* Voice: WebSocket relay to Azure OpenAI Realtime API */
setupRealtimeRelay(server);

app.use('/', authRoutes);
app.use('/', appRoutes);
app.use('/', assistantRoutes);

/* ─────────────────────────────────────────
   WebSocket terminal — ws://localhost:8080/terminal
───────────────────────────────────────── */
let nodePty;
try { nodePty = require("node-pty"); } catch { nodePty = null; }

const wss = new WebSocketServer({ noServer: true });
const TERMINAL_UPLOAD_ROOT = process.env.MESH_TERMINAL_UPLOAD_ROOT || path.join(os.tmpdir(), 'mesh-terminal-workspaces');

function sanitizeTerminalSegment(value, fallback = 'workspace') {
  const raw = String(value || '').trim();
  const safe = raw.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || fallback;
}

function buildMaterializedWorkspaceRoot(workspace = {}) {
  const folderName = sanitizeTerminalSegment(workspace.folderName, 'workspace');
  const identity = sanitizeTerminalSegment(workspace.workspaceId || folderName, 'workspace');
  return path.join(TERMINAL_UPLOAD_ROOT, `${folderName}-${identity}`);
}

async function shouldReuseMaterializedWorkspace(targetRoot, workspace = {}) {
  try {
    const markerPath = path.join(targetRoot, '.mesh-terminal-meta.json');
    const raw = await fs.promises.readFile(markerPath, 'utf8');
    const marker = JSON.parse(raw);
    return (
      String(marker.workspaceId || '') === String(workspace.workspaceId || '') &&
      String(marker.indexedAt || '') === String(workspace.indexedAt || '') &&
      Number(marker.fileCountCompleted || 0) === Number(workspace.fileCountCompleted || 0)
    );
  } catch {
    return false;
  }
}

async function listMaterializableWorkspaceFiles(workspace = {}) {
  const workspaceId = String(workspace.workspaceId || '').trim();
  if (global.workspaceMetadataStore?.enabled && workspaceId) {
    const docs = await global.workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return docs.filter((doc) => String(doc?.status || 'completed').toLowerCase() === 'completed' && doc?.path);
  }
  return [...(workspace.files?.values?.() || [])].filter((doc) => doc?.path);
}

async function materializeUploadWorkspaceRoot(workspace = {}) {
  const targetRoot = buildMaterializedWorkspaceRoot(workspace);
  if (await shouldReuseMaterializedWorkspace(targetRoot, workspace)) {
    return targetRoot;
  }

  const files = await listMaterializableWorkspaceFiles(workspace);
  await fs.promises.rm(targetRoot, { recursive: true, force: true });
  await fs.promises.mkdir(targetRoot, { recursive: true });

  const writeOne = async (meta) => {
    const workspacePath = global.toSafePath ? global.toSafePath(meta?.path) : String(meta?.path || '').trim();
    if (!workspacePath) return;
    const relativePath = global.toWorkspaceRelativePath
      ? global.toWorkspaceRelativePath(workspacePath, workspace.folderName)
      : workspacePath;
    if (!relativePath) return;

    const opened = await global.openWorkspaceFileWithFallback(workspacePath, 'original', {
      workspaceId: workspace.workspaceId || '',
      sessionId: workspace.sessionId || '',
    });
    const absolutePath = path.join(targetRoot, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, String(opened?.content || ''), 'utf8');
  };

  const mapper = global.mapWithConcurrency || (async (items, _limit, fn) => Promise.all(items.map(fn)));
  await mapper(files, 6, writeOne);

  await fs.promises.writeFile(path.join(targetRoot, '.mesh-terminal-meta.json'), JSON.stringify({
    workspaceId: workspace.workspaceId || '',
    folderName: workspace.folderName || '',
    indexedAt: workspace.indexedAt || '',
    fileCountCompleted: Number(workspace.fileCountCompleted || files.length),
  }, null, 2), 'utf8');

  return targetRoot;
}

async function resolveTerminalCwd() {
  const workspace = global.localAssistantWorkspace || {};
  if (String(workspace.sourceKind || '').trim() === 'local-path' && workspace.rootPath) {
    return {
      cwd: workspace.rootPath,
      note: workspace.rootPath,
    };
  }

  if (String(workspace.workspaceId || '').trim() && String(workspace.folderName || '').trim()) {
    const cwd = await materializeUploadWorkspaceRoot(workspace);
    return {
      cwd,
      note: `${cwd} (materialized from uploaded workspace)`,
    };
  }

  const fallback = path.join(__dirname, '..');
  return {
    cwd: fallback,
    note: fallback,
  };
}

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname !== '/terminal') return;
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on("connection", async (ws, req) => {
  const ptyModule = nodePty || global.pty;
  if (!ptyModule) {
    ws.send(JSON.stringify({ type: "output", data: "\r\n\x1b[31m● node-pty not available on this server.\x1b[0m\r\n" }));
    return;
  }

  const urlParams = new URL(req.url, "http://localhost").searchParams;
  const shellPref = urlParams.get("shell");
  let shell = shellPref || (process.env.SHELL || "bash");
  
  // Explicit Linux fallbacks for Azure
  if (process.platform !== 'win32' && !shell.startsWith('/')) {
    shell = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
  }

  let cwdInfo = { cwd: path.join(__dirname, '..'), note: path.join(__dirname, '..') };
  try {
    cwdInfo = await resolveTerminalCwd();
  } catch (error) {
    try {
      ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[33m● Workspace mount fallback: ${String(error?.message || 'failed to materialize upload workspace')}\x1b[0m\r\n` }));
    } catch {}
  }

  const proc = ptyModule.spawn(shell, [], {
    name: "xterm-color",
    cols: 120,
    rows: 36,
    cwd: cwdInfo.cwd,
    env: process.env,
  });

  proc.onData(data => { try { ws.send(JSON.stringify({ type: "output", data })); } catch {} });
  proc.onExit(() => { try { ws.send(JSON.stringify({ type: "exit" })); ws.close(); } catch {} });
  try {
    ws.send(JSON.stringify({ type: "output", data: `\r\n\x1b[36m● Workspace root: ${cwdInfo.note}\x1b[0m\r\n` }));
  } catch {}
  ws.on("message", (msg) => {
    try {
      const { type, data, cols, rows } = JSON.parse(msg);
      if (type === "input") proc.write(data);
      if (type === "resize") proc.resize(cols, rows);
    } catch {}
  });
  ws.on("close", () => { try { proc.kill(); } catch {} });
});

const PORT = Number(process.env.PORT || 8080);
server.listen(PORT, () => {
    console.log('Server successfully started on port ' + PORT);
});
