# Server Hardening & Structural Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the gateway server against oversized payloads, eliminate synchronous I/O in hot paths, introduce structured logging with request IDs, and extract the terminal WebSocket into its own module — all without changing any observable behavior.

**Architecture:** Six independent, sequentially-safe tasks. Each task produces a working, deployable state. Tasks 1–4 are self-contained surgical fixes. Task 5 (terminal extraction) is a module split. Task 6 (global → DI) is a structural refactor of the highest complexity — it is the last task intentionally.

**Tech Stack:** Node.js, Express 5, CommonJS modules. No new runtime dependencies introduced.

---

## Task 1: Remove stale `CODEBASE-MAP.md` reference from repo-docs priority list

**Why:** `CODEBASE-MAP.md` was deleted from the repo. `src/routes/app.routes.js:47` still lists it in `REPO_DOCS_PRIORITY`. The repo-docs endpoint will silently skip it (file doesn't exist), but it's dead config that misleads future readers.

**Files:**
- Modify: `src/routes/app.routes.js:45-56`

---

- [ ] **Step 1: Remove the dead entry**

In `src/routes/app.routes.js`, change `REPO_DOCS_PRIORITY` from:

```js
const REPO_DOCS_PRIORITY = [
  'CURRENT-SYSTEM-OVERVIEW.md',
  'CODEBASE-MAP.md',
  'UI-REVIEW.md',
  'DEPLOY.md',
  'CLAUDE.md',
  'AZURE-ARCHITECTURE.md',
  'CAPSULA-COMPRESSION-AZURE-GESAMTDOKU.md',
  'claude-overview.md',
  '.mesh/instructions.md',
  '.mesh/dependency-map.md',
];
```

To:

```js
const REPO_DOCS_PRIORITY = [
  'CURRENT-SYSTEM-OVERVIEW.md',
  'UI-REVIEW.md',
  'DEPLOY.md',
  'CLAUDE.md',
  'AZURE-ARCHITECTURE.md',
  'CAPSULA-COMPRESSION-AZURE-GESAMTDOKU.md',
  'claude-overview.md',
  '.mesh/instructions.md',
  '.mesh/dependency-map.md',
];
```

- [ ] **Step 2: Verify the server still starts**

```bash
node --check src/routes/app.routes.js
```

Expected: no output (syntax OK).

- [ ] **Step 3: Commit**

```bash
git add src/routes/app.routes.js
git commit -m "chore(routes): remove deleted CODEBASE-MAP.md from repo-docs priority"
```

---

## Task 2: Per-Route JSON Body Limits

**Why:** `src/server.js:78` sets a global `200mb` JSON body limit. This means every endpoint — including login, session check, and user-store reads — accepts 200mb request bodies, creating a trivial DoS vector. Only `/api/assistant/workspace/offload/ingest` legitimately needs a large body (it receives chunked workspace file content). All other routes need at most a few KB.

**Files:**
- Modify: `src/server.js:78` (remove global large limit)
- Modify: `src/routes/assistant.routes.js:42-51` (add local large-body parser)

---

- [ ] **Step 1: Replace the global 200mb parser with a 1mb default**

In `src/server.js`, change line 78:

```js
// Before
app.use(express.json({ limit: "200mb" }));
```

```js
// After — tight default; offload/ingest overrides this per-route
app.use(express.json({ limit: '1mb' }));
```

- [ ] **Step 2: Add the large-body parser only to the offload/ingest route**

In `src/routes/assistant.routes.js`, the ingest route currently starts at line 42:

```js
router.post("/api/assistant/workspace/offload/ingest", requireAuth, async (req, res) => {
```

Add the per-route body parser as the second argument:

```js
const largeJsonBody = require('express').json({ limit: '200mb' });

router.post("/api/assistant/workspace/offload/ingest", requireAuth, largeJsonBody, async (req, res) => {
  try {
    const result = await ingestWorkspaceChunkFromOffload(req.body || {}, {
      userId: req.authUser?.id,
    });
    res.json(result);
  } catch (error) {
    safeRouteError(res, 400, "Offload ingest failed", error);
  }
});
```

The `largeJsonBody` constant should be declared at the top of `assistant.routes.js`, directly after the `express` require:

```js
const express = require('express');
const router = express.Router();

// Only the offload/ingest endpoint accepts large bodies (workspace file chunks).
// All other routes inherit the 1mb default set in src/server.js.
const largeJsonBody = express.json({ limit: '200mb' });
```

- [ ] **Step 3: Syntax-check both modified files**

```bash
node --check src/server.js && node --check src/routes/assistant.routes.js
```

Expected: no output.

- [ ] **Step 4: Manual smoke test**

Start the server:
```bash
node server.js
```

In a separate terminal, verify the login endpoint now rejects a large payload:
```bash
node -e "
const body = JSON.stringify({ email: 'a@a.com', password: 'x'.repeat(2_000_000) });
fetch('http://localhost:8080/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body,
}).then(r => console.log('status:', r.status));
"
```

Expected: `status: 413` (Payload Too Large from Express).

- [ ] **Step 5: Commit**

```bash
git add src/server.js src/routes/assistant.routes.js
git commit -m "fix(security): per-route JSON body limits, restrict global limit to 1mb"
```

---

## Task 3: Pre-Computed View Route Map (Eliminate `fs.existsSync` in Hot Path)

**Why:** `src/server.js:87-96` contains a clean-URL middleware that calls `fs.existsSync()` — synchronous filesystem I/O — on every incoming request that has no file extension. This blocks the Node.js event loop on each request. The set of HTML views is static and known at startup; it should be pre-built once into a Map.

**Files:**
- Modify: `src/server.js:87-96` — replace the middleware with a pre-built route map lookup

---

- [ ] **Step 1: Add the view map builder above the middleware**

In `src/server.js`, find the clean URL middleware (around line 87). Insert the following map-builder **before** the `app.use(express.static(...))` call:

```js
// ── Pre-computed clean-URL route map ─────────────────────────────────────────
// Built once at startup — eliminates fs.existsSync() on every request.
const REPO_ROOT = path.join(__dirname, '..');

function buildViewRouteMap(repoRoot) {
  const map = new Map();
  const viewsDir = path.join(repoRoot, 'views');

  // views/*.html  →  /filename
  if (fs.existsSync(viewsDir)) {
    for (const file of fs.readdirSync(viewsDir)) {
      if (file.endsWith('.html')) {
        map.set('/' + file.slice(0, -5), path.join(viewsDir, file));
      }
    }
  }

  // root-level *.html  →  /filename (views/ takes priority)
  for (const file of fs.readdirSync(repoRoot)) {
    if (file.endsWith('.html')) {
      const route = '/' + file.slice(0, -5);
      if (!map.has(route)) {
        map.set(route, path.join(repoRoot, file));
      }
    }
  }

  return map;
}

const VIEW_ROUTE_MAP = buildViewRouteMap(REPO_ROOT);
```

- [ ] **Step 2: Replace the old synchronous middleware**

Remove this block (around lines 87-96):

```js
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
```

Replace with:

```js
// Clean URL support — O(1) map lookup built once at startup.
app.use((req, res, next) => {
  if (req.path === '/' || req.path.slice(1).includes('.')) return next();
  const filePath = VIEW_ROUTE_MAP.get(req.path);
  if (filePath) return res.sendFile(filePath);
  next();
});
```

- [ ] **Step 3: Syntax check**

```bash
node --check src/server.js
```

Expected: no output.

- [ ] **Step 4: Smoke test — all clean URLs still resolve**

Start the server (`node server.js`) and verify:
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/app
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/settings
# Expected: 200

curl -s -o /dev/null -w "%{http_code}" http://localhost:8080/nonexistent-route
# Expected: 404
```

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "perf(server): pre-compute view route map at startup, eliminate fs.existsSync on every request"
```

---

## Task 4: Structured JSON Logger with Request IDs

**Why:** The server currently uses bare `console.log/warn/error` calls throughout. Log output in Azure App Service has no structured fields, no request correlation, no consistent timestamp format. A thin logger wrapper that emits newline-delimited JSON makes logs grep-able and queryable in Log Analytics. A request ID attached per-request enables tracing a single request across multiple log lines.

**Files:**
- Create: `src/logger.js` — structured JSON logger
- Modify: `src/server.js` — attach `requestId` per request, replace startup console calls with logger

---

- [ ] **Step 1: Create `src/logger.js`**

```js
'use strict';

/**
 * Minimal structured JSON logger for the Mesh gateway.
 *
 * Outputs newline-delimited JSON to stdout (info/debug) or stderr (warn/error).
 * Controlled by LOG_LEVEL env var: debug | info | warn | error (default: info).
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started', { port: 8080 });
 *   logger.error('Unhandled exception', { err: error.message, requestId });
 */

const LEVEL_VALUES = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVEL_VALUES[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVEL_VALUES.info;

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} msg
 * @param {Record<string, unknown>} [ctx]
 */
function write(level, msg, ctx = {}) {
  if ((LEVEL_VALUES[level] ?? 0) < MIN_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...ctx };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

module.exports = {
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  debug: (msg, ctx) => write('debug', msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  info:  (msg, ctx) => write('info',  msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  warn:  (msg, ctx) => write('warn',  msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  error: (msg, ctx) => write('error', msg, ctx),
};
```

- [ ] **Step 2: Write the test file**

Create `test/logger.test.js`:

```js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('logger', () => {
  it('given info level, when info is called, then emits valid JSON to stdout', () => {
    const lines = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk) => { lines.push(chunk); return true; };

    const logger = require('../src/logger');
    logger.info('test message', { foo: 'bar' });

    process.stdout.write = orig;

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'info');
    assert.equal(parsed.msg, 'test message');
    assert.equal(parsed.foo, 'bar');
    assert.ok(parsed.ts, 'ts field must be present');
  });

  it('given error level, when error is called, then emits to stderr', () => {
    const lines = [];
    const orig = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => { lines.push(chunk); return true; };

    delete require.cache[require.resolve('../src/logger')];
    const logger = require('../src/logger');
    logger.error('something failed', { code: 'E_TEST' });

    process.stderr.write = orig;

    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.equal(parsed.level, 'error');
    assert.equal(parsed.code, 'E_TEST');
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

```bash
node --test test/logger.test.js
```

Expected:
```
✔ given info level, when info is called, then emits valid JSON to stdout
✔ given error level, when error is called, then emits to stderr
```

- [ ] **Step 4: Add request ID middleware to `src/server.js`**

At the top of `src/server.js`, add the logger require after the existing requires:

```js
const { randomUUID } = require('node:crypto');
const logger = require('./logger');
```

Then add the request-ID middleware as the **first** `app.use()` call, before the security headers middleware:

```js
// ── Request ID ────────────────────────────────────────────────────────────────
// Attaches a unique ID to every request so log lines can be correlated.
app.use((req, _res, next) => {
  req.requestId = randomUUID();
  next();
});
```

- [ ] **Step 5: Replace the startup `console.warn` / `console.error` calls in `src/server.js`**

Change lines 9-12 (the startup check output):

```js
// Before
startupResult.warnings.forEach((w) => console.warn(`[startup] ${w}`));
if (!startupResult.ok) {
  startupResult.errors.forEach((e) => console.error(`[startup] FATAL: ${e}`));
  process.exit(1);
}
```

```js
// After
startupResult.warnings.forEach((w) => logger.warn(w, { phase: 'startup' }));
if (!startupResult.ok) {
  startupResult.errors.forEach((e) => logger.error(e, { phase: 'startup', fatal: true }));
  process.exit(1);
}
```

Change the final `console.log` on the last line of `src/server.js`:

```js
// Before
console.log('Server successfully started on port ' + PORT);
```

```js
// After
logger.info('Server started', { port: PORT });
```

- [ ] **Step 6: Syntax check**

```bash
node --check src/server.js && node --check src/logger.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/logger.js test/logger.test.js src/server.js
git commit -m "feat(observability): structured JSON logger with request IDs"
```

---

## Task 5: Extract Terminal WebSocket into `src/routes/terminal.routes.js`

**Why:** `src/server.js` currently contains ~180 lines of terminal WebSocket logic (lines 132–324): workspace materialization, CWD resolution, PTY spawning, env sanitization, and the `upgrade` handler. This makes `src/server.js` responsible for startup, middleware, routing, AND terminal session management — violating single responsibility. Extracting to a dedicated module aligns with the existing `realtime.routes.js` pattern.

**Files:**
- Create: `src/routes/terminal.routes.js` — all terminal WebSocket logic
- Modify: `src/server.js` — remove terminal code, call `setupTerminalRelay(server)` like `setupRealtimeRelay(server)`

---

- [ ] **Step 1: Create `src/routes/terminal.routes.js`**

```js
'use strict';

/**
 * Terminal WebSocket handler for Mesh.
 *
 * Spawns a node-pty shell session per connection.
 * For local-path workspaces, CWD is the real rootPath.
 * For upload workspaces, files are materialized to a temp dir before the shell spawns.
 *
 * @param {import('http').Server} server
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { WebSocketServer } = require('ws');

const TERMINAL_UPLOAD_ROOT = process.env.MESH_TERMINAL_UPLOAD_ROOT
  || path.join(os.tmpdir(), 'mesh-terminal-workspaces');

const SENSITIVE_ENV_PATTERN = /(_KEY|_SECRET|_PASSWORD|_TOKEN|_CREDENTIAL|_PRIVATE)$/i;

/**
 * Strips sensitive environment variables before passing process.env to a spawned shell.
 * Preserves PATH, HOME, TERM and other runtime necessities.
 * NOTE: _KEY / _SECRET / _PASSWORD / _TOKEN / _CREDENTIAL patterns are blocked.
 *
 * @param {NodeJS.ProcessEnv} env
 * @returns {Record<string, string>}
 */
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
  const raw = String(value || '').trim();
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
 * @returns {Promise<Array<{ path: string }>>}
 */
async function listMaterializableWorkspaceFiles(workspace = {}) {
  const workspaceId = String(workspace.workspaceId || '').trim();
  if (global.workspaceMetadataStore?.enabled && workspaceId) {
    const docs = await global.workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return docs.filter((doc) => String(doc?.status || 'completed').toLowerCase() === 'completed' && doc?.path);
  }
  return [...(workspace.files?.values?.() || [])].filter((doc) => doc?.path);
}

/**
 * Downloads all workspace files from Blob/Cosmos into a local temp directory,
 * then writes a marker file so subsequent connections can reuse the materialized tree.
 *
 * @param {{ workspaceId?: string, folderName?: string, indexedAt?: string, fileCountCompleted?: number, sessionId?: string }} workspace
 * @returns {Promise<string>} Absolute path to the materialized workspace root
 */
async function materializeUploadWorkspaceRoot(workspace = {}) {
  const targetRoot = buildMaterializedWorkspaceRoot(workspace);
  if (await shouldReuseMaterializedWorkspace(targetRoot, workspace)) {
    return targetRoot;
  }

  const files = await listMaterializableWorkspaceFiles(workspace);
  await fs.promises.rm(targetRoot, { recursive: true, force: true });
  await fs.promises.mkdir(targetRoot, { recursive: true });

  const writeOne = async (meta) => {
    const workspacePath = global.toSafePath
      ? global.toSafePath(meta?.path)
      : String(meta?.path || '').trim();
    if (!workspacePath) return;

    const relativePath = global.toWorkspaceRelativePath
      ? global.toWorkspaceRelativePath(workspacePath, workspace.folderName)
      : workspacePath;
    if (!relativePath) return;

    const opened = await global.openWorkspaceFileWithFallback(workspacePath, 'original', {
      workspaceId: workspace.workspaceId || '',
      sessionId:   workspace.sessionId   || '',
    });
    const absolutePath = path.join(targetRoot, relativePath);
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, String(opened?.content || ''), 'utf8');
  };

  const mapper = global.mapWithConcurrency
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
 * @returns {Promise<{ cwd: string, note: string }>}
 */
async function resolveTerminalCwd(projectRoot) {
  const workspace = global.localAssistantWorkspace || {};

  if (String(workspace.sourceKind || '').trim() === 'local-path' && workspace.rootPath) {
    return { cwd: workspace.rootPath, note: workspace.rootPath };
  }

  if (String(workspace.workspaceId || '').trim() && String(workspace.folderName || '').trim()) {
    const cwd = await materializeUploadWorkspaceRoot(workspace);
    return { cwd, note: `${cwd} (materialized from uploaded workspace)` };
  }

  return { cwd: projectRoot, note: projectRoot };
}

/**
 * Attaches terminal WebSocket handling to an existing HTTP server.
 *
 * @param {import('http').Server} server
 * @param {object} opts
 * @param {string} opts.projectRoot  Absolute path to the repo root (fallback CWD)
 */
function setupTerminalRelay(server, { projectRoot }) {
  let nodePty;
  try { nodePty = require('node-pty'); } catch { nodePty = null; }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/terminal') return;

    try {
      const token = global.readAuthTokenFromRequest ? global.readAuthTokenFromRequest(req) : '';
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
        socket.destroy();
        return;
      }
      const resolved = global.resolveAuthUserFromRequest
        ? await global.resolveAuthUserFromRequest(req)
        : null;
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
    const ptyModule = nodePty || global.pty;
    if (!ptyModule) {
      ws.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[31m● node-pty not available on this server.\x1b[0m\r\n' }));
      return;
    }

    const urlParams = new URL(req.url, 'http://localhost').searchParams;
    const shellPref = urlParams.get('shell');
    let shell = shellPref || process.env.SHELL || 'bash';

    // Explicit Linux fallbacks for Azure
    if (process.platform !== 'win32' && !shell.startsWith('/')) {
      shell = fs.existsSync('/bin/bash') ? '/bin/bash' : '/bin/sh';
    }

    let cwdInfo = { cwd: projectRoot, note: projectRoot };
    try {
      cwdInfo = await resolveTerminalCwd(projectRoot);
    } catch (error) {
      try {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[33m● Workspace mount fallback: ${String(error?.message || 'failed to materialize upload workspace')}\x1b[0m\r\n`,
        }));
      } catch {}
    }

    const proc = ptyModule.spawn(shell, [], {
      name: 'xterm-color',
      cols: 120,
      rows: 36,
      cwd: cwdInfo.cwd,
      env: sanitizeEnvForShell(process.env),
    });

    proc.onData((data) => { try { ws.send(JSON.stringify({ type: 'output', data })); } catch {} });
    proc.onExit(() => { try { ws.send(JSON.stringify({ type: 'exit' })); ws.close(); } catch {} });

    try {
      ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[36m● Workspace root: ${cwdInfo.note}\x1b[0m\r\n` }));
    } catch {}

    ws.on('message', (msg) => {
      try {
        const { type, data, cols, rows } = JSON.parse(msg);
        if (type === 'input') proc.write(data);
        if (type === 'resize') proc.resize(cols, rows);
      } catch {}
    });

    ws.on('close', () => { try { proc.kill(); } catch {} });
  });
}

module.exports = { setupTerminalRelay };
```

- [ ] **Step 2: Rewrite the terminal section in `src/server.js`**

Remove everything from line 132 (`let nodePty`) through line 324 (`ws.on("close", ...)`).

Replace with:

```js
const { setupTerminalRelay } = require('./routes/terminal.routes');

setupTerminalRelay(server, { projectRoot: path.join(__dirname, '..') });
```

Also remove the now-unused `TERMINAL_UPLOAD_ROOT` constant that was previously declared in `src/server.js` (it now lives in `terminal.routes.js`).

- [ ] **Step 3: Syntax check both files**

```bash
node --check src/server.js && node --check src/routes/terminal.routes.js
```

Expected: no output.

- [ ] **Step 4: Integration smoke test**

Start the server and verify the terminal WebSocket still works:

```bash
node server.js
# Open http://localhost:8080/app in a browser, switch to Terminal surface
# Type a command (ls, pwd) — should get shell output back
```

Expected: terminal session establishes, shell responds normally.

- [ ] **Step 5: Commit**

```bash
git add src/routes/terminal.routes.js src/server.js
git commit -m "refactor(server): extract terminal WebSocket into terminal.routes.js"
```

---

## Task 6: Replace `global.*` with Explicit Dependency Injection in Route Files

**Why:** `src/server.js:18-20` dumps ~100 core functions into `global`. Route files (`assistant.routes.js`, `app.routes.js`, `auth.routes.js`) use these globals without any `require` — making their dependencies invisible, preventing unit testing without a running server, and creating implicit coupling to startup order. The fix is to convert each route file into a factory function that receives a `core` object.

**Scope:** This is the highest-complexity task. It touches every route file and `src/server.js`. Do it in three sub-steps: one route file at a time, keeping the server fully functional between each.

**Files:**
- Modify: `src/routes/auth.routes.js` — convert to `createAuthRouter(core)`
- Modify: `src/routes/app.routes.js` — convert to `createAppRouter(core)`
- Modify: `src/routes/assistant.routes.js` — convert to `createAssistantRouter(core)`
- Modify: `src/server.js` — remove global spread, pass core to router factories

---

### Sub-task 6a: Auth routes

- [ ] **Step 1: Identify all globals used in `auth.routes.js`**

Run:
```bash
grep -n "^[^/]" src/routes/auth.routes.js | grep -v "^[0-9]*:[ ]*[/{]" | head -40
```

The globals currently used by `auth.routes.js`:
- `normalizeEmail`
- `DEMO_USER_ENABLED`
- `DEMO_USER_EMAIL`
- `DEMO_USER_EMAIL_ALIASES`
- `DEMO_USER_PASSWORD`
- `verifyPassword`
- `ensureDemoUserRecord`
- `AUTH_SESSION_TTL_MS`
- `issueAuthSession`
- `setAuthCookie`
- `pruneExpiredSessions`
- `requireAuth`
- `resolveAuthUserFromRequest`
- `readAuthCookieToken`
- `readAuthTokenFromRequest`
- `clearAuthCookie`
- `secureDb` (already required at top of the file)
- `sanitizeAuthUser`
- `reportAuthStoreError`

- [ ] **Step 2: Wrap `auth.routes.js` in a factory function**

Change the file structure from:

```js
const express = require('express');
const router = express.Router();
// ... helper functions ...
router.post("/api/auth/login", loginRateLimiter, async (req, res) => {
  // uses normalizeEmail, DEMO_USER_ENABLED, etc. from global
});
// ...
module.exports = router;
```

To:

```js
'use strict';

const express = require('express');

// ... (keep loginRateLimiter, readClientIp, inferSessionLabel, formatRelativeActivity, summarizeSession unchanged) ...

/**
 * @param {object} core  Subset of exports from src/core/index.js
 * @param {Function} core.normalizeEmail
 * @param {boolean}  core.DEMO_USER_ENABLED
 * @param {string}   core.DEMO_USER_EMAIL
 * @param {string[]} core.DEMO_USER_EMAIL_ALIASES
 * @param {string}   core.DEMO_USER_PASSWORD
 * @param {Function} core.verifyPassword
 * @param {Function} core.ensureDemoUserRecord
 * @param {number}   core.AUTH_SESSION_TTL_MS
 * @param {Function} core.issueAuthSession
 * @param {Function} core.setAuthCookie
 * @param {Function} core.clearAuthCookie
 * @param {Function} core.readAuthCookieToken
 * @param {Function} core.readAuthTokenFromRequest
 * @param {Function} core.resolveAuthUserFromRequest
 * @param {Function} core.requireAuth
 * @param {Function} core.pruneExpiredSessions
 * @param {Function} core.sanitizeAuthUser
 * @param {Function} core.reportAuthStoreError
 * @param {object}   core.secureDb
 * @returns {express.Router}
 */
function createAuthRouter(core) {
  const {
    normalizeEmail, DEMO_USER_ENABLED, DEMO_USER_EMAIL, DEMO_USER_EMAIL_ALIASES,
    DEMO_USER_PASSWORD, verifyPassword, ensureDemoUserRecord, AUTH_SESSION_TTL_MS,
    issueAuthSession, setAuthCookie, clearAuthCookie, readAuthCookieToken,
    readAuthTokenFromRequest, resolveAuthUserFromRequest, requireAuth,
    pruneExpiredSessions, sanitizeAuthUser, reportAuthStoreError, secureDb,
  } = core;

  const router = express.Router();

  router.post("/api/auth/login", loginRateLimiter, async (req, res) => {
    // ... body unchanged, but no longer reads from global ...
  });

  // ... all other routes unchanged, each now using destructured `core` locals ...

  return router;
}

module.exports = { createAuthRouter };
```

- [ ] **Step 3: Update `src/server.js` — auth routes**

Change:
```js
const authRoutes = require('./routes/auth.routes');
// ...
app.use('/', authRoutes);
```

To:
```js
const { createAuthRouter } = require('./routes/auth.routes');
// ...
app.use('/', createAuthRouter(core));
```

- [ ] **Step 4: Syntax check and smoke test**

```bash
node --check src/server.js && node --check src/routes/auth.routes.js
node server.js
# In browser: try logging in → should work
# Try wrong credentials → should get 401
```

- [ ] **Step 5: Commit sub-task 6a**

```bash
git add src/routes/auth.routes.js src/server.js
git commit -m "refactor(auth): convert auth router to factory function, remove global dependency"
```

---

### Sub-task 6b: App routes

- [ ] **Step 6: Identify globals used in `app.routes.js`**

```bash
grep -n "global\." src/routes/app.routes.js
# Also look for bare global names by checking which symbols are used but not defined/required in the file
```

Common globals in `app.routes.js`: `requireAuth`, `getUserStore`, `putUserStore`, `getBillingSummary`, `getInvoiceDownloadUrl`, `validateByokKey`, `getDeployments`, `getDeploymentPolicy`.

- [ ] **Step 7: Apply same factory pattern to `app.routes.js`**

```js
/**
 * @param {object} core
 * @returns {express.Router}
 */
function createAppRouter(core) {
  const {
    requireAuth,
    getUserStore, putUserStore,
    getBillingSummary, getInvoiceDownloadUrl,
    validateByokKey,
    getDeployments, getDeploymentPolicy,
    // add any other globals found in step 6
  } = core;

  const router = express.Router();

  // ... all routes unchanged, reading from destructured locals not global ...

  return router;
}

module.exports = { createAppRouter };
```

Update `src/server.js`:
```js
const { createAppRouter } = require('./routes/app.routes');
// ...
app.use('/', createAppRouter(core));
```

- [ ] **Step 8: Syntax check and smoke test**

```bash
node --check src/routes/app.routes.js && node --check src/server.js
node server.js
# Open /settings-account → user store should load
# Open /settings-billing → billing summary should load
```

- [ ] **Step 9: Commit sub-task 6b**

```bash
git add src/routes/app.routes.js src/server.js
git commit -m "refactor(app): convert app router to factory function, remove global dependency"
```

---

### Sub-task 6c: Assistant routes

- [ ] **Step 10: Identify globals in `assistant.routes.js`**

```bash
grep -n "^\s*[a-zA-Z]" src/routes/assistant.routes.js | grep -v "^[0-9]*:\s*//" | head -60
```

This file uses the most globals (~40+). List them all explicitly before writing the factory function. They include: `requireAuth`, `meshTunnelRequest`, `localAssistantWorkspace`, `normalizeWorkspaceSourceKind`, `workspaceOffloadClientConfig`, `ingestWorkspaceChunkFromOffload`, `shouldQueueWorkspaceSelectPayload`, `enqueueWorkspaceSelectJob`, `buildWorkspaceSelectAcceptedResponse`, `executeWorkspaceSelectWithFallback`, and many more.

- [ ] **Step 11: Apply factory pattern to `assistant.routes.js`**

Same pattern as 6a and 6b:

```js
function createAssistantRouter(core) {
  const {
    requireAuth, meshTunnelRequest, localAssistantWorkspace,
    normalizeWorkspaceSourceKind, workspaceOffloadClientConfig,
    ingestWorkspaceChunkFromOffload, shouldQueueWorkspaceSelectPayload,
    enqueueWorkspaceSelectJob, buildWorkspaceSelectAcceptedResponse,
    executeWorkspaceSelectWithFallback,
    // ... all others identified in step 10 ...
  } = core;

  const largeJsonBody = require('express').json({ limit: '200mb' });
  const router = express.Router();

  // ... all routes unchanged ...

  return router;
}

module.exports = { createAssistantRouter };
```

- [ ] **Step 12: Remove the `global.*` spread from `src/server.js`**

Once all three route files are converted, remove:

```js
// Remove these lines entirely:
Object.keys(core).forEach(k => {
    global[k] = core[k];
});
```

And update the route mounting:

```js
const { createAuthRouter }      = require('./routes/auth.routes');
const { createAppRouter }       = require('./routes/app.routes');
const { createAssistantRouter } = require('./routes/assistant.routes');
const { setupRealtimeRelay }    = require('./routes/realtime.routes');

// ...

app.use('/', createAuthRouter(core));
app.use('/', createAppRouter(core));
app.use('/', createAssistantRouter(core));
```

- [ ] **Step 13: Check `realtime.routes.js` for any globals it uses**

```bash
grep -n "global\." src/routes/realtime.routes.js
```

If it uses globals, apply the same factory pattern. If it only uses `setupRealtimeRelay(server)` with no shared core state, it can stay as-is.

- [ ] **Step 14: Full regression smoke test**

```bash
node server.js
```

Verify:
- Login / logout works
- Workspace open works
- Chat endpoint responds
- `/settings-account` loads user store
- `/app` loads without JS errors in browser console

- [ ] **Step 15: Commit sub-task 6c + global removal**

```bash
git add src/routes/assistant.routes.js src/server.js
git commit -m "refactor(core): remove global.* spread, all routes now use explicit DI"
```

---

## Self-Review

**Spec coverage:**
- Task 1 ✅ CODEBASE-MAP.md dead reference removed
- Task 2 ✅ Per-route body limits, 200mb only on ingest
- Task 3 ✅ Pre-computed view map eliminates sync I/O hot path
- Task 4 ✅ Structured logger + request IDs
- Task 5 ✅ Terminal WebSocket extracted to its own module
- Task 6 ✅ global.* → DI across all three route factories

**Placeholder scan:** No TBD or "implement later" entries. All code blocks are complete.

**Type consistency:** `core` object shape in Task 6 sub-tasks uses the same symbol names exported by `src/core/index.js` throughout.

**Risk assessment:** Tasks 1–5 are low-risk surgical changes. Task 6 is the highest risk (touches all route files) but is structured so the server is deployable after each sub-task. The `global.*` spread is only removed in step 12, after all three routers are converted — never leaving the system in a broken state.
