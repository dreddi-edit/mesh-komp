# Global DI Completion & Vault Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `global.*` → DI migration for the two remaining WebSocket route modules (`terminal.routes.js`, `realtime.routes.js`), fix `.env.example` gaps, and sync the Obsidian vault with the current code state.

**Architecture:** The previous hardening plan (2026-04-11-server-hardening.md) completed Tasks 1–6 for the three HTTP route files but skipped Step 13 — checking/migrating the two WebSocket modules. After that commit, `src/server.js` no longer sets any `global.*`, leaving `terminal.routes.js` and `realtime.routes.js` reading `undefined` globals at runtime. This plan fixes that breakage, closes the `.env.example` gaps, and brings the Obsidian vault into sync with the refactored codebase.

**Tech Stack:** Node.js, CommonJS modules, `node:test` + `node:assert/strict`. No new runtime dependencies.

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `src/routes/terminal.routes.js` | Add `core` param to `setupTerminalRelay`; extract helpers to accept deps; remove all `global.*` |
| Modify | `src/routes/realtime.routes.js` | Add `core` param to `setupRealtimeRelay`, `handleSession`, `buildVoiceDeps`, `listVoiceContextPaths`, `buildVoiceCapsuleContext`; remove all `global.*` and bare globals |
| Modify | `src/server.js` | Pass `core` to both WebSocket setup calls |
| Create | `test/terminal-routes.test.js` | Unit tests for terminal helper functions with injected deps |
| Create | `test/realtime-routes.test.js` | Unit tests for realtime voice context helpers with injected deps |
| Modify | `/.env.example` | Add `MESH_SECURE_DB_FILE`, `MESH_AZURE_BLOB_INGEST_SAS_TOKEN` |
| Modify | `mesh-vault/Architecture/System Architecture.md` | Update Global State section |
| Modify | `mesh-vault/Backend/Core Orchestrator.md` | Update Known Issues section |
| Modify | `mesh-vault/Backend/Server and Routes.md` | Update responsibilities; add security hardening section |
| Modify | `mesh-vault/Development/Scripts and Commands.md` | Add logger env var note |
| Modify | `mesh-vault/Operations/Environment Variables.md` | Add missing vars |

> **Note on vault path:** The canonical vault is `mesh-vault/` in the repo. Check `ls mesh-vault/` to confirm structure before editing.

---

## Task 1: Fix `terminal.routes.js` — Inject Core Dependencies

**Problem:** `listMaterializableWorkspaceFiles`, `materializeUploadWorkspaceRoot`, `resolveTerminalCwd`, and the auth checks in `setupTerminalRelay` all read from `global.*`. `src/server.js` no longer writes any globals, so these are all `undefined` at runtime.

**Files:**
- Modify: `src/routes/terminal.routes.js`
- Modify: `src/server.js:171`
- Create: `test/terminal-routes.test.js`

---

- [ ] **Step 1: Write the failing tests**

Create `test/terminal-routes.test.js`:

```js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const os   = require('node:os');
const path = require('node:path');
const fs   = require('node:fs');

// We'll require these after confirming the module exports them
// (they aren't exported yet — this test will fail until Step 3)
const {
  listMaterializableWorkspaceFiles,
  resolveTerminalCwd,
} = require('../src/routes/terminal.routes');

describe('terminal-routes / listMaterializableWorkspaceFiles', () => {
  it('given workspaceMetadataStore is disabled, when called, then returns files from workspace.files map', async () => {
    const workspace = {
      workspaceId: 'ws-1',
      files: new Map([
        ['a/b.js', { path: 'a/b.js', status: 'completed' }],
        ['c/d.js', { path: 'c/d.js', status: 'completed' }],
      ]),
    };
    const deps = { workspaceMetadataStore: { enabled: false } };

    const result = await listMaterializableWorkspaceFiles(workspace, deps);

    assert.equal(result.length, 2);
    assert.ok(result.some((r) => r.path === 'a/b.js'));
  });

  it('given workspaceMetadataStore is enabled, when called, then returns only completed docs from store', async () => {
    const workspace = { workspaceId: 'ws-2', files: new Map() };
    const deps = {
      workspaceMetadataStore: {
        enabled: true,
        listWorkspaceFiles: async (id) => {
          assert.equal(id, 'ws-2');
          return [
            { path: 'x/y.js', status: 'completed' },
            { path: 'z/w.js', status: 'pending' },
          ];
        },
      },
    };

    const result = await listMaterializableWorkspaceFiles(workspace, deps);

    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'x/y.js');
  });
});

describe('terminal-routes / resolveTerminalCwd', () => {
  it('given a local-path workspace, when called, then returns workspace rootPath', async () => {
    const workspace = { sourceKind: 'local-path', rootPath: '/home/user/project' };
    const deps = { localAssistantWorkspace: workspace };

    const result = await resolveTerminalCwd('/fallback', deps);

    assert.equal(result.cwd, '/home/user/project');
  });

  it('given no active workspace, when called, then returns the fallback projectRoot', async () => {
    const deps = { localAssistantWorkspace: {} };

    const result = await resolveTerminalCwd('/fallback', deps);

    assert.equal(result.cwd, '/fallback');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/terminal-routes.test.js
```

Expected: `TypeError: listMaterializableWorkspaceFiles is not a function` (not exported yet).

- [ ] **Step 3: Refactor `terminal.routes.js` to accept injected deps**

Make these three targeted changes to `src/routes/terminal.routes.js`:

**Change 1 — `listMaterializableWorkspaceFiles`: remove `global.*`, accept `deps` param**

Current (lines 82–89):
```js
async function listMaterializableWorkspaceFiles(workspace = {}) {
  const workspaceId = String(workspace.workspaceId || '').trim();
  if (global.workspaceMetadataStore?.enabled && workspaceId) {
    const docs = await global.workspaceMetadataStore.listWorkspaceFiles(workspaceId);
    return docs.filter((doc) => String(doc?.status || 'completed').toLowerCase() === 'completed' && doc?.path);
  }
  return [...(workspace.files?.values?.() || [])].filter((doc) => doc?.path);
}
```

Replace with:
```js
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
```

**Change 2 — `materializeUploadWorkspaceRoot`: remove `global.*`, accept `deps` param**

Current signature (line 98):
```js
async function materializeUploadWorkspaceRoot(workspace = {}) {
```

New signature + body (replace full function):
```js
/**
 * @param {{ workspaceId?: string, folderName?: string, indexedAt?: string, fileCountCompleted?: number, sessionId?: string }} workspace
 * @param {{ workspaceMetadataStore: object, toSafePath: Function, toWorkspaceRelativePath: Function, openWorkspaceFileWithFallback: Function, mapWithConcurrency: Function }} deps
 * @returns {Promise<string>}
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
```

**Change 3 — `resolveTerminalCwd`: remove `global.*`, accept `deps` param**

Current (lines 157–170):
```js
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
```

Replace with:
```js
/**
 * @param {string} projectRoot
 * @param {{ localAssistantWorkspace: object, workspaceMetadataStore: object, toSafePath: Function, toWorkspaceRelativePath: Function, openWorkspaceFileWithFallback: Function, mapWithConcurrency: Function }} deps
 * @returns {Promise<{ cwd: string, note: string }>}
 */
async function resolveTerminalCwd(projectRoot, deps = {}) {
  const workspace = deps.localAssistantWorkspace || {};

  if (String(workspace.sourceKind || '').trim() === 'local-path' && workspace.rootPath) {
    return { cwd: workspace.rootPath, note: workspace.rootPath };
  }

  if (String(workspace.workspaceId || '').trim() && String(workspace.folderName || '').trim()) {
    const cwd = await materializeUploadWorkspaceRoot(workspace, deps);
    return { cwd, note: `${cwd} (materialized from uploaded workspace)` };
  }

  return { cwd: projectRoot, note: projectRoot };
}
```

**Change 4 — `setupTerminalRelay`: accept `core`, destructure deps, thread to helpers**

Current signature (line 178):
```js
function setupTerminalRelay(server, { projectRoot }) {
```

Replace the whole function definition opening and the two auth-check blocks:
```js
/**
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

  const materialDeps = {
    workspaceMetadataStore,
    toSafePath,
    toWorkspaceRelativePath,
    openWorkspaceFileWithFallback,
    mapWithConcurrency,
  };
```

Replace the auth checks inside the `upgrade` handler (lines 189–207):
```js
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
```

Replace the `resolveTerminalCwd` call inside `wss.on('connection')`:
```js
    try {
      cwdInfo = await resolveTerminalCwd(projectRoot, {
        localAssistantWorkspace: core.localAssistantWorkspace,
        ...materialDeps,
      });
    } catch (error) {
```

Replace the pty fallback line (`nodePty || global.pty`):
```js
    const ptyModule = nodePty;
    if (!ptyModule) {
```

**Change 5 — export helpers for testing**

At the bottom of the file, replace:
```js
module.exports = { setupTerminalRelay };
```
with:
```js
module.exports = { setupTerminalRelay, listMaterializableWorkspaceFiles, resolveTerminalCwd };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test test/terminal-routes.test.js
```

Expected:
```
✔ given workspaceMetadataStore is disabled, when called, then returns files from workspace.files map
✔ given workspaceMetadataStore is enabled, when called, then returns only completed docs from store
✔ given a local-path workspace, when called, then returns workspace rootPath
✔ given no active workspace, when called, then returns the fallback projectRoot
```

- [ ] **Step 5: Update the call site in `src/server.js`**

Line 171, change:
```js
setupTerminalRelay(server, { projectRoot: REPO_ROOT });
```
to:
```js
setupTerminalRelay(server, { projectRoot: REPO_ROOT, core });
```

- [ ] **Step 6: Syntax check both files**

```bash
node --check src/routes/terminal.routes.js && node --check src/server.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/routes/terminal.routes.js src/server.js test/terminal-routes.test.js
git commit -m "fix(terminal): inject core deps into setupTerminalRelay, remove global.* reads"
```

---

## Task 2: Fix `realtime.routes.js` — Inject Core Dependencies

**Problem:** `buildVoiceDeps()` references ~18 bare global names. `listVoiceContextPaths` and `buildVoiceCapsuleContext` use `global.xxx` directly. The upgrade handler calls `readAuthTokenFromRequest` and `resolveAuthUserFromRequest` as bare globals.

**Files:**
- Modify: `src/routes/realtime.routes.js`
- Modify: `src/server.js:161`
- Create: `test/realtime-routes.test.js`

---

- [ ] **Step 1: Write the failing tests**

Create `test/realtime-routes.test.js`:

```js
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Not exported yet — will fail until Step 3
const {
  listVoiceContextPaths,
  buildVoiceCapsuleContext,
} = require('../src/routes/realtime.routes');

describe('realtime-routes / listVoiceContextPaths', () => {
  it('given preferred paths in context, when called, then returns those paths (up to 6)', async () => {
    const context = {
      activeFilePath: 'src/a.js',
      selectedPaths: ['src/b.js', 'src/c.js'],
    };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: {},
      workspaceMetadataStore: { enabled: false },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.deepEqual(result, ['src/a.js', 'src/b.js', 'src/c.js']);
  });

  it('given no preferred paths and workspaceMetadataStore is enabled, when called, then returns store paths', async () => {
    const context = { activeFilePath: '', selectedPaths: [], workspaceId: 'ws-3' };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { workspaceId: 'ws-3', files: new Map() },
      workspaceMetadataStore: {
        enabled: true,
        listWorkspaceFiles: async () => [
          { path: 'lib/x.js' },
          { path: 'lib/y.js' },
        ],
      },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.ok(result.includes('lib/x.js'));
    assert.ok(result.includes('lib/y.js'));
  });

  it('given no preferred paths and no store, when called, then returns workspace file keys', async () => {
    const context = { activeFilePath: '', selectedPaths: [] };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: {
        files: new Map([['src/foo.js', {}], ['src/bar.js', {}]]),
      },
      workspaceMetadataStore: { enabled: false },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.ok(result.includes('src/foo.js'));
  });
});

describe('realtime-routes / buildVoiceCapsuleContext', () => {
  it('given no workspace paths, when called, then returns empty string', async () => {
    const voiceSession = { getContextSnapshot: () => ({ activeFilePath: '', selectedPaths: [] }) };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { files: new Map() },
      workspaceMetadataStore: { enabled: false },
      loadCapsuleContextEntries: async () => ({ entries: [] }),
      buildCapsuleContextBlock: () => '',
    };

    const result = await buildVoiceCapsuleContext(voiceSession, core);

    assert.equal(result, '');
  });

  it('given workspace paths exist, when called, then returns capsule context block', async () => {
    const voiceSession = {
      getContextSnapshot: () => ({ activeFilePath: 'src/index.js', selectedPaths: [] }),
    };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { files: new Map() },
      workspaceMetadataStore: { enabled: false },
      loadCapsuleContextEntries: async (paths) => ({ entries: [{ path: paths[0], content: 'console.log(1)' }] }),
      buildCapsuleContextBlock: (entries) => `<capsule>${entries[0].path}</capsule>`,
    };

    const result = await buildVoiceCapsuleContext(voiceSession, core);

    assert.equal(result, '<capsule>src/index.js</capsule>');
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
node --test test/realtime-routes.test.js
```

Expected: `TypeError: listVoiceContextPaths is not a function`.

- [ ] **Step 3: Refactor `realtime.routes.js` to accept injected deps**

**Change 1 — `setupRealtimeRelay`: accept `core`, destructure auth helpers**

Current (line 23):
```js
function setupRealtimeRelay(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    ...
    const token = readAuthTokenFromRequest(req);
    ...
    const resolved = await resolveAuthUserFromRequest(req);
    ...
    wss.handleUpgrade(req, socket, head, (clientWs) => {
      handleSession(clientWs, { authUserId: resolved.user.id });
    });
```

Replace with:
```js
/**
 * @param {import('http').Server} server
 * @param {object} core  All exports from src/core/index.js
 */
function setupRealtimeRelay(server, core) {
  const { readAuthTokenFromRequest, resolveAuthUserFromRequest } = core;
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', async (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/api/realtime') return;

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
      wss.handleUpgrade(req, socket, head, (clientWs) => {
        handleSession(clientWs, { authUserId: resolved.user.id, core });
      });
    } catch {
      socket.write('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
}
```

**Change 2 — `buildVoiceDeps`: accept `core`, destructure all deps from it**

Current (line 53):
```js
function buildVoiceDeps() {
  return {
    MESH_DEFAULT_MODEL,
    toSafePath,
    assistantRuns,
    ...
  };
}
```

Replace with:
```js
/**
 * @param {object} core
 * @returns {object}
 */
function buildVoiceDeps(core) {
  const {
    MESH_DEFAULT_MODEL,
    toSafePath,
    assistantRuns,
    assistantRunSnapshot,
    createAssistantRun,
    applyAssistantRunDecision,
    getStoredCredentialsForUser,
    mergeChatCredentials,
    openWorkspaceFileWithFallback,
    recoverWorkspaceWithFallback,
    searchWorkspaceWithFallback,
    runGitWithFallback,
    localGitStatus,
    runLocalGit,
    gitPathFromWorkspacePath,
    workspacePathFromGitPath,
    resolveLocalWorkspaceAbsolutePath,
    readLocalWorkspaceFileText,
    localWorkspaceSave,
  } = core;
  return {
    MESH_DEFAULT_MODEL,
    toSafePath,
    assistantRuns,
    assistantRunSnapshot,
    createAssistantRun,
    applyAssistantRunDecision,
    getStoredCredentialsForUser,
    mergeChatCredentials,
    openWorkspaceFileWithFallback,
    recoverWorkspaceWithFallback,
    searchWorkspaceWithFallback,
    runGitWithFallback,
    localGitStatus,
    runLocalGit,
    gitPathFromWorkspacePath,
    workspacePathFromGitPath,
    resolveLocalWorkspaceAbsolutePath,
    readLocalWorkspaceFileText,
    localWorkspaceSave,
  };
}
```

**Change 3 — `listVoiceContextPaths`: remove `global.*`, accept `core` param**

Current (line 144):
```js
async function listVoiceContextPaths(context = {}) {
  const preferred = (global.dedupePaths ? global.dedupePaths([
    context.activeFilePath,
    ...(Array.isArray(context.selectedPaths) ? context.selectedPaths : []),
  ]) : [context.activeFilePath, ...(Array.isArray(context.selectedPaths) ? context.selectedPaths : [])])
    .map((entry) => global.toSafePath ? global.toSafePath(entry) : String(entry || '').trim())
    .filter(Boolean);

  if (preferred.length) return preferred.slice(0, 6);

  const workspaceId = String(context.workspaceId || global.localAssistantWorkspace?.workspaceId || '').trim();
  if (global.workspaceMetadataStore?.enabled && workspaceId) {
    try {
      const docs = await global.workspaceMetadataStore.listWorkspaceFiles(workspaceId);
      return docs
        .map((doc) => global.toSafePath ? global.toSafePath(doc?.path) : String(doc?.path || '').trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch { /* ignore metadata listing errors */ }
  }

  return Array.from(global.localAssistantWorkspace?.files?.keys?.() || []).slice(0, 6);
}
```

Replace with:
```js
/**
 * @param {object} context
 * @param {object} core
 * @returns {Promise<string[]>}
 */
async function listVoiceContextPaths(context = {}, core = {}) {
  const { dedupePaths, toSafePath, workspaceMetadataStore } = core;
  // Access localAssistantWorkspace via core directly (live state, not destructured at module load)
  const localAssistantWorkspace = core.localAssistantWorkspace;

  const rawPaths = [
    context.activeFilePath,
    ...(Array.isArray(context.selectedPaths) ? context.selectedPaths : []),
  ];
  const preferred = (dedupePaths ? dedupePaths(rawPaths) : rawPaths)
    .map((entry) => toSafePath ? toSafePath(entry) : String(entry || '').trim())
    .filter(Boolean);

  if (preferred.length) return preferred.slice(0, 6);

  const workspaceId = String(context.workspaceId || localAssistantWorkspace?.workspaceId || '').trim();
  if (workspaceMetadataStore?.enabled && workspaceId) {
    try {
      const docs = await workspaceMetadataStore.listWorkspaceFiles(workspaceId);
      return docs
        .map((doc) => toSafePath ? toSafePath(doc?.path) : String(doc?.path || '').trim())
        .filter(Boolean)
        .slice(0, 6);
    } catch { /* ignore metadata listing errors */ }
  }

  return Array.from(localAssistantWorkspace?.files?.keys?.() || []).slice(0, 6);
}
```

**Change 4 — `buildVoiceCapsuleContext`: remove `global.*`, accept `core` param**

Current (line 168):
```js
async function buildVoiceCapsuleContext(voiceSession) {
  const context = typeof voiceSession?.getContextSnapshot === 'function'
    ? voiceSession.getContextSnapshot()
    : {};
  const paths = await listVoiceContextPaths(context);
  if (!paths.length) return '';
  const result = await global.loadCapsuleContextEntries(paths, { maxFiles: 5, maxModelChars: 5000 });
  return global.buildCapsuleContextBlock(result.entries || [], []);
}
```

Replace with:
```js
/**
 * @param {object} voiceSession
 * @param {object} core
 * @returns {Promise<string>}
 */
async function buildVoiceCapsuleContext(voiceSession, core = {}) {
  const { loadCapsuleContextEntries, buildCapsuleContextBlock } = core;
  const context = typeof voiceSession?.getContextSnapshot === 'function'
    ? voiceSession.getContextSnapshot()
    : {};
  const paths = await listVoiceContextPaths(context, core);
  if (!paths.length) return '';
  const result = await loadCapsuleContextEntries(paths, { maxFiles: 5, maxModelChars: 5000 });
  return buildCapsuleContextBlock(result.entries || [], []);
}
```

**Change 5 — `handleSession`: accept `core` from options, thread to deps builders**

Current (line 178):
```js
async function handleSession(clientWs, options = {}) {
  ...
  const voiceSession = createVoiceAgentSession({
    authUserId: String(options?.authUserId || ''),
    deps: buildVoiceDeps(),
    ...
  });
  ...
  capsuleContext = await buildVoiceCapsuleContext(voiceSession);
```

Replace the function opening and the two call sites:
```js
async function handleSession(clientWs, options = {}) {
  const { core } = options;
  ...
  const voiceSession = createVoiceAgentSession({
    authUserId: String(options?.authUserId || ''),
    deps: buildVoiceDeps(core),
    sendClientEvent,
    sendAzureEvent: () => {},
  });
  ...
  capsuleContext = await buildVoiceCapsuleContext(voiceSession, core);
```

**Change 6 — export helpers for testing**

At the bottom of the file, replace:
```js
module.exports = { setupRealtimeRelay };
```
with:
```js
module.exports = { setupRealtimeRelay, listVoiceContextPaths, buildVoiceCapsuleContext };
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
node --test test/realtime-routes.test.js
```

Expected:
```
✔ given preferred paths in context, when called, then returns those paths (up to 6)
✔ given no preferred paths and workspaceMetadataStore is enabled, when called, then returns store paths
✔ given no preferred paths and no store, when called, then returns workspace file keys
✔ given no workspace paths, when called, then returns empty string
✔ given workspace paths exist, when called, then returns capsule context block
```

- [ ] **Step 5: Update the call site in `src/server.js`**

Line 161, change:
```js
setupRealtimeRelay(server);
```
to:
```js
setupRealtimeRelay(server, core);
```

- [ ] **Step 6: Syntax check both files**

```bash
node --check src/routes/realtime.routes.js && node --check src/server.js
```

Expected: no output.

- [ ] **Step 7: Run the full test suite to catch regressions**

```bash
node --test
```

Expected: all tests pass (no new failures).

- [ ] **Step 8: Commit**

```bash
git add src/routes/realtime.routes.js src/server.js test/realtime-routes.test.js
git commit -m "fix(realtime): inject core deps into setupRealtimeRelay, remove global.* reads"
```

---

## Task 3: Fix `.env.example` Gaps

**Problem:** Two variables required in production are completely absent from `.env.example`, making them invisible to new operators. The vault's `Operations/Environment Variables.md` lists them; the example file does not.

**Files:**
- Modify: `.env.example`

---

- [ ] **Step 1: Add `MESH_SECURE_DB_FILE` to the Required in Production section**

In `.env.example`, after the `MESH_DATA_ENCRYPTION_KEY` block, add:

```
MESH_SECURE_DB_FILE=
# Path to the encrypted SQLite database file.
# REQUIRED in production. Must be on persistent storage: /home/data/mesh-secure-v2.db
# In development, defaults to a local file in the project root.
# WARNING: Never rotate the encryption key (MESH_DATA_ENCRYPTION_KEY) casually —
# rotating it makes all existing encrypted rows unreadable.
```

- [ ] **Step 2: Add `MESH_AZURE_BLOB_INGEST_SAS_TOKEN` to the Azure Blob section**

In `.env.example`, inside the `# ── Azure Blob Storage (optional...)` section, after `MESH_AZURE_BLOB_READ_SAS_TOKEN=`, add:

```
# MESH_AZURE_BLOB_INGEST_SAS_TOKEN=
# SAS token for server-side ingest of workspace files from Blob Storage.
```

- [ ] **Step 3: Verify the file is valid (no syntax errors)**

```bash
node --check -e "require('fs').readFileSync('.env.example', 'utf8')" 2>&1 || true
# Just confirms the file is readable; .env files have no syntax to check
cat .env.example | grep -E "^[A-Z_]+=" | sort
```

Expected: a sorted list of all non-commented variables — confirms nothing was accidentally uncommented.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "docs(config): add MESH_SECURE_DB_FILE and MESH_AZURE_BLOB_INGEST_SAS_TOKEN to .env.example"
```

---

## Task 4: Sync Obsidian Vault with Current Code State

**Context:** The canonical vault is `mesh-vault/` in the repo. Update the relevant notes there.

**Scope:** Four notes need updates. The changes are targeted — only the stale sections, not full rewrites.

**Files:**
- Modify: `mesh-vault/Architecture/System Architecture.md`
- Modify: `mesh-vault/Backend/Core Orchestrator.md`
- Modify: `mesh-vault/Backend/Server and Routes.md`
- Modify: `mesh-vault/Operations/Environment Variables.md`

---

- [ ] **Step 1: Update `Architecture/System Architecture.md` — Global State section**

Find and replace the "Global State" section (currently lines 63–64):

Current:
```markdown
## Global State

The gateway uses `global.*` extensively (set in `src/server.js`) to make functions from `src/core/index.js` available to route files. This is a known architectural weakness — high coupling, hard to unit test in isolation.
```

Replace with:
```markdown
## Global State

`global.*` has been fully removed from the gateway. All route modules now receive dependencies via explicit injection:

- HTTP routes (`auth.routes.js`, `app.routes.js`, `assistant.routes.js`): factory functions accepting a `core` object — `createAuthRouter(core)`, `createAppRouter(core)`, `createAssistantRouter(core)`
- WebSocket modules (`terminal.routes.js`, `realtime.routes.js`): setup functions accepting `core` — `setupTerminalRelay(server, { projectRoot, core })`, `setupRealtimeRelay(server, core)`

`src/server.js` requires `src/core/index.js` and passes it explicitly. No globals are written at startup.
```

Also update the Known Weak Points table — remove or update the row about "Backend core monolith" if it mentions global.* (check the table in the note), and add a new row:

Find the table row:
```
| Backend core monolith | `src/core/index.js` is still large; ownership boundaries are blurry |
```

Replace with:
```
| Backend core monolith | `src/core/index.js` is still large; ownership boundaries are blurry — split into submodules is the long-term goal |
```

Update `mesh-vault/`.

- [ ] **Step 2: Update `Backend/Core Orchestrator.md` — description and Known Issues**

Find and replace the Overview paragraph:

Current:
```markdown
It is a **thin aggregator**: requires the four extracted submodules, destructures their exports into scope, and re-exports everything via `module.exports`. `src/server.js` then populates `global.*` with these exports so route files can access them.
```

Replace with:
```markdown
It is a **thin aggregator**: requires the submodules, destructures their exports into scope, and re-exports everything via `module.exports`. `src/server.js` receives the `core` export and passes it explicitly to each route factory — no `global.*` is used.
```

Find and replace the Known Issues section:

Current:
```markdown
## Known Issues

- `src/core/index.js` is still very large — hard to reason about ownership boundaries
- Global export pattern (`global.*`) makes dependency tracing difficult
- Route files access core functions without imports, coupling them to server startup order
```

Replace with:
```markdown
## Known Issues

- `src/core/index.js` is still very large — hard to reason about ownership boundaries; further split into focused submodules is the long-term goal
```

Update both file locations.

- [ ] **Step 3: Update `Backend/Server and Routes.md` — responsibilities and add security section**

Find and replace the `src/server.js` Responsibilities list:

Current:
```markdown
- Express setup and middleware
- Static file serving from repo root (for `assets/`, `views/`)
- Clean URL routing for all HTML pages
- Route module mounting
- Terminal WebSocket setup (`node-pty`)
- Voice realtime WebSocket relay
- Populating `global.*` with core functions so routes can access them
```

Replace with:
```markdown
- Express setup and middleware
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `Referrer-Policy`)
- CSRF protection (Origin/Referer check for all state-mutating requests)
- Request ID middleware (attaches `req.requestId` UUID for log correlation)
- Static file serving from repo root (for `assets/`, `views/`)
- Clean URL routing via pre-built Map (eliminates `fs.existsSync` on every request)
- Route module mounting (passes `core` to factory functions — no `global.*`)
- Terminal WebSocket setup via `setupTerminalRelay(server, { projectRoot, core })`
- Voice realtime WebSocket relay via `setupRealtimeRelay(server, core)`
```

After the Route Modules table, add a new section:

```markdown
## Security Layer (in `src/server.js`)

All security middleware runs before routes:

| Middleware | Purpose |
|-----------|---------|
| Request ID | UUID per request for log correlation (`req.requestId`) |
| Security headers | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` |
| CSRF guard | Rejects cross-origin `POST/PUT/PATCH/DELETE` based on `Origin`/`Referer` header |
| JSON body limit | Global 1 MB; `/api/assistant/workspace/offload/ingest` overrides to 200 MB |
```

Update both file locations.

- [ ] **Step 4: Update `Operations/Environment Variables.md` — add missing vars**

Find the Gateway > Core / Database table and add a row:

After the `MESH_DATA_ENCRYPTION_KEY` row, the table currently does not include `MESH_SECURE_DB_FILE`. Check if it's already there — if not, add:

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_SECURE_DB_FILE` | **Yes** | Path to encrypted SQLite. Must be `/home/data/mesh-secure-v2.db` on Azure persistent storage. Defaults to project root in dev (data lost on redeploy). |

Also, after the Voice section, add a new subsection for the logger:

```markdown
### Observability

| Variable | Required | Description |
|----------|----------|-------------|
| `LOG_LEVEL` | No | Structured logger verbosity. `debug \| info \| warn \| error`. Default: `info`. All output is newline-delimited JSON. |
```

Update both file locations.

- [ ] **Step 5: Commit**

```bash
git add mesh-vault/
git commit -m "docs(vault): sync Obsidian notes with DI refactor, security hardening, and env var gaps"
```

---

## Self-Review

**Spec coverage:**
- global.* removed from terminal.routes.js ✅ Task 1
- global.* removed from realtime.routes.js ✅ Task 2
- Tests for both modules ✅ Tasks 1 + 2
- MESH_SECURE_DB_FILE added to .env.example ✅ Task 3
- MESH_AZURE_BLOB_INGEST_SAS_TOKEN added to .env.example ✅ Task 3
- System Architecture vault note updated ✅ Task 4
- Core Orchestrator vault note updated ✅ Task 4
- Server and Routes vault note updated ✅ Task 4
- Environment Variables vault note updated ✅ Task 4

**Placeholder scan:** No TBD entries. All code blocks are complete and reference the actual function names from the codebase.

**Type consistency:** `core` object is passed by reference throughout — same object from `require('./core/index')`. `listVoiceContextPaths(context, core)` and `buildVoiceCapsuleContext(voiceSession, core)` use consistent `core` parameter naming across all tasks.

**Risk:** Tasks 1 and 2 fix a live runtime bug — terminal and voice are currently calling `undefined` functions. These are the most important to ship first.
