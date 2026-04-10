# Codex Task: Mesh AI Workbench — Phase 2 (Git Integration) & Phase 3 (Split Editor + Polish)

> **Context**: This is the Mesh AI Workbench at try-mesh.com. It has a VS Code-like layout built in Phase 1 (dark/light theme, xterm.js terminal, command palette, minimap, breadcrumbs). The architecture is: `app.html` (main page + runtime), `assets/assistant-workbench.js` (VS Code shell IIFE, ~2250 lines), `assets/assistant-workbench.css` (theme + layout, ~1734 lines), `server.js` (gateway API, ~6657 lines), `mesh-core/src/server.js` (worker tunnel, ~883 lines).
>
> **Important patterns to follow**:
> - Gateway routes use `requireAuth` middleware (defined at `server.js:645`)
> - Gateway → Worker communication uses `meshTunnelRequest(action, data)` (defined at `server.js:827`) which brotli-compresses JSON envelopes
> - Worker tunnel dispatch is a big if/else chain in `mesh-core/src/server.js:818-858`
> - Frontend API calls use `bridge.requestJson(method, url, body)` (exposed from `app.html`)
> - Sidebar panes are registered via `data-sidebar-pane="name"` in `buildShell()` at `assistant-workbench.js:1374-1378`
> - Activity bar buttons use `data-activity-view="name"` at `assistant-workbench.js:1348-1365`
> - `setSidebarView(view)` handles sidebar switching at `assistant-workbench.js:527`
> - Theme uses CSS custom properties (`--mesh-*`), dark theme via `.mesh-dark-theme` class
> - Editor state: `state.workbenchLayout.openEditors[]` and `state.workbenchLayout.activeEditor`
> - Existing diff editor: `ensureMonacoDiffInstance()` in `app.html` and `renderDiffEditor()` at `app.html:3276`
> - Status bar rendered by `renderStatusbar()` at `assistant-workbench.js:611`
> - Command palette commands registered in `commandRegistry` array at `assistant-workbench.js:299`

---

## Phase 2: Git Integration

### Task 2.1 — Backend Git API Routes in `server.js`

Add new routes after the existing assistant routes (after line ~6294, before `app.post("/api/assistant/chat", ...)`). All routes must use `requireAuth` middleware.

**Implementation approach**: Use `child_process.execFile('git', [...args], { cwd })` — no new npm dependencies needed. The workspace root should be derived from the current workspace folder. Add a helper:

```js
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

async function runGit(args, cwd) {
  const workspaceCwd = cwd || currentWorkspaceRoot(); // derive from workspace state
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: workspaceCwd,
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
```

The workspace root path: The gateway forwards git calls to the worker via `meshTunnelRequest()`. The worker knows the actual filesystem path. So the gateway routes should proxy to the worker via tunnel (same pattern as all other workspace operations).

**Routes to add in `server.js`** (gateway side — these all forward to worker via tunnel):

```js
// GET /api/assistant/git/status
app.get("/api/assistant/git/status", requireAuth, async (_req, res) => {
  try {
    const result = await meshTunnelRequest("git.status", {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/assistant/git/branches
app.get("/api/assistant/git/branches", requireAuth, async (_req, res) => {
  try {
    const result = await meshTunnelRequest("git.branches", {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/checkout — body: { branch }
app.post("/api/assistant/git/checkout", requireAuth, async (req, res) => {
  try {
    const { branch } = req.body || {};
    const result = await meshTunnelRequest("git.checkout", { branch });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/stage — body: { files: string[] }
app.post("/api/assistant/git/stage", requireAuth, async (req, res) => {
  try {
    const { files } = req.body || {};
    const result = await meshTunnelRequest("git.stage", { files });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/unstage — body: { files: string[] }
app.post("/api/assistant/git/unstage", requireAuth, async (req, res) => {
  try {
    const { files } = req.body || {};
    const result = await meshTunnelRequest("git.unstage", { files });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/commit — body: { message, files?: string[] }
app.post("/api/assistant/git/commit", requireAuth, async (req, res) => {
  try {
    const { message, files } = req.body || {};
    const result = await meshTunnelRequest("git.commit", { message, files });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/push
app.post("/api/assistant/git/push", requireAuth, async (req, res) => {
  try {
    const result = await meshTunnelRequest("git.push", {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/pull
app.post("/api/assistant/git/pull", requireAuth, async (req, res) => {
  try {
    const result = await meshTunnelRequest("git.pull", {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/assistant/git/diff?path=optional
app.get("/api/assistant/git/diff", requireAuth, async (req, res) => {
  try {
    const filePath = req.query.path || '';
    const result = await meshTunnelRequest("git.diff", { path: filePath });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// GET /api/assistant/git/log?limit=20
app.get("/api/assistant/git/log", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const result = await meshTunnelRequest("git.log", { limit });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/stash — body: { action: 'push' | 'pop' | 'list' }
app.post("/api/assistant/git/stash", requireAuth, async (req, res) => {
  try {
    const { action } = req.body || {};
    const result = await meshTunnelRequest("git.stash", { action });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/clone — body: { url, path? }
app.post("/api/assistant/git/clone", requireAuth, async (req, res) => {
  try {
    const { url, path: targetPath } = req.body || {};
    const result = await meshTunnelRequest("git.clone", { url, path: targetPath });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/init
app.post("/api/assistant/git/init", requireAuth, async (req, res) => {
  try {
    const result = await meshTunnelRequest("git.init", {});
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/create-branch — body: { name, startPoint? }
app.post("/api/assistant/git/create-branch", requireAuth, async (req, res) => {
  try {
    const { name, startPoint } = req.body || {};
    const result = await meshTunnelRequest("git.create-branch", { name, startPoint });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// POST /api/assistant/git/delete-branch — body: { name }
app.post("/api/assistant/git/delete-branch", requireAuth, async (req, res) => {
  try {
    const { name } = req.body || {};
    const result = await meshTunnelRequest("git.delete-branch", { name });
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});
```

### Task 2.2 — Worker Git Tunnel Actions in `mesh-core/src/server.js`

Add git action handlers in the tunnel dispatch chain (inside the if/else block starting at line 818, before the `else { payload = { ok: false, error: ... } }` fallback at line 857).

The worker has access to the filesystem. The workspace root is typically `workspaceState.folderName` resolved to an absolute path. You need to determine the actual directory. The worker keeps workspace files in memory but the git operations need to run against the actual filesystem. Use `process.cwd()` or a configurable `MESH_WORKSPACE_ROOT` env var as the git working directory.

Add this helper at the top of the worker file (after imports, around line 44):

```js
const execFileAsync = promisify(require('child_process').execFile);

function getGitCwd() {
  // Use configured workspace root or fall back to process cwd
  return process.env.MESH_WORKSPACE_ROOT || process.cwd();
}

async function runGit(args) {
  const { stdout, stderr } = await execFileAsync('git', args, {
    cwd: getGitCwd(),
    maxBuffer: 10 * 1024 * 1024,
    timeout: 30000,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}
```

Note: `child_process` needs to be imported. Add `import { execFile } from 'child_process';` at the top (the file already imports from `'util'` so `promisify` is available).

**Add these tunnel action handlers** in the if/else chain (before the final `else` fallback):

```js
} else if (action === 'git.status') {
    const branch = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
    const statusRaw = (await runGit(['status', '--porcelain=v1'])).stdout;
    const lines = statusRaw ? statusRaw.split('\n') : [];
    const staged = [], unstaged = [], untracked = [];
    for (const line of lines) {
        const x = line[0], y = line[1], file = line.slice(3);
        if (x === '?' && y === '?') { untracked.push(file); }
        else {
            if (x !== ' ' && x !== '?') staged.push({ file, status: x });
            if (y !== ' ' && y !== '?') unstaged.push({ file, status: y });
        }
    }
    let ahead = 0, behind = 0;
    try {
        const abRaw = (await runGit(['rev-list', '--left-right', '--count', `HEAD...@{upstream}`])).stdout;
        const parts = abRaw.split(/\s+/);
        ahead = parseInt(parts[0]) || 0;
        behind = parseInt(parts[1]) || 0;
    } catch {}
    payload = { ok: true, branch, staged, unstaged, untracked, ahead, behind };

} else if (action === 'git.branches') {
    const raw = (await runGit(['branch', '-a', '--format=%(refname:short)\t%(HEAD)'])).stdout;
    const lines = raw ? raw.split('\n') : [];
    const branches = [];
    let current = '';
    for (const line of lines) {
        const [name, head] = line.split('\t');
        branches.push(name);
        if (head === '*') current = name;
    }
    if (!current) {
        try { current = (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout; } catch {}
    }
    payload = { ok: true, branches, current };

} else if (action === 'git.checkout') {
    const branch = String(data.branch || '');
    if (!branch) { payload = { ok: false, error: 'Branch name required' }; }
    else {
        await runGit(['checkout', branch]);
        payload = { ok: true, branch };
    }

} else if (action === 'git.stage') {
    const files = Array.isArray(data.files) ? data.files : ['.'];
    await runGit(['add', ...files]);
    payload = { ok: true };

} else if (action === 'git.unstage') {
    const files = Array.isArray(data.files) ? data.files : [];
    await runGit(['reset', 'HEAD', ...files]);
    payload = { ok: true };

} else if (action === 'git.commit') {
    const message = String(data.message || '');
    if (!message) { payload = { ok: false, error: 'Commit message required' }; }
    else {
        if (Array.isArray(data.files) && data.files.length) {
            await runGit(['add', ...data.files]);
        }
        const result = await runGit(['commit', '-m', message]);
        payload = { ok: true, output: result.stdout };
    }

} else if (action === 'git.push') {
    const result = await runGit(['push']);
    payload = { ok: true, output: result.stdout || result.stderr };

} else if (action === 'git.pull') {
    const result = await runGit(['pull']);
    payload = { ok: true, output: result.stdout || result.stderr };

} else if (action === 'git.diff') {
    const args = ['diff'];
    if (data.path) args.push('--', data.path);
    const result = await runGit(args);
    // Also get staged diff
    const stagedArgs = ['diff', '--cached'];
    if (data.path) stagedArgs.push('--', data.path);
    const staged = await runGit(stagedArgs);
    payload = { ok: true, diff: result.stdout, stagedDiff: staged.stdout };

} else if (action === 'git.log') {
    const limit = Math.min(parseInt(data.limit) || 20, 100);
    const result = await runGit(['log', `--max-count=${limit}`, '--format=%H\t%an\t%ae\t%aI\t%s']);
    const lines = result.stdout ? result.stdout.split('\n') : [];
    const commits = lines.map((line) => {
        const [hash, author, email, date, ...msgParts] = line.split('\t');
        return { hash, author, email, date, message: msgParts.join('\t') };
    });
    payload = { ok: true, commits };

} else if (action === 'git.stash') {
    const stashAction = String(data.action || 'push');
    if (stashAction === 'list') {
        const result = await runGit(['stash', 'list']);
        payload = { ok: true, stashes: result.stdout ? result.stdout.split('\n') : [] };
    } else if (stashAction === 'pop') {
        const result = await runGit(['stash', 'pop']);
        payload = { ok: true, output: result.stdout };
    } else {
        const result = await runGit(['stash', 'push', '-m', data.message || 'Mesh stash']);
        payload = { ok: true, output: result.stdout };
    }

} else if (action === 'git.clone') {
    const url = String(data.url || '');
    if (!url) { payload = { ok: false, error: 'Repository URL required' }; }
    else {
        const targetPath = data.path || url.split('/').pop().replace(/\.git$/, '');
        const result = await runGit(['clone', url, targetPath]);
        payload = { ok: true, path: targetPath, output: result.stderr || result.stdout };
    }

} else if (action === 'git.init') {
    const result = await runGit(['init']);
    payload = { ok: true, output: result.stdout };

} else if (action === 'git.create-branch') {
    const name = String(data.name || '');
    if (!name) { payload = { ok: false, error: 'Branch name required' }; }
    else {
        const args = ['checkout', '-b', name];
        if (data.startPoint) args.push(data.startPoint);
        await runGit(args);
        payload = { ok: true, branch: name };
    }

} else if (action === 'git.delete-branch') {
    const name = String(data.name || '');
    if (!name) { payload = { ok: false, error: 'Branch name required' }; }
    else {
        await runGit(['branch', '-d', name]);
        payload = { ok: true };
    }
```

### Task 2.3 — Source Control Sidebar Panel in `assistant-workbench.js`

#### 2.3.1 Add SCM activity bar button

In `buildShell()` (line ~1348), add a new activity bar button **after** the "Changes" button (line 1357) and **before** the "Mesh Ops" button (line 1358):

```html
<button class="mesh-activitybar__item" type="button" data-activity-view="scm" title="Source Control" aria-label="Source Control">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="18" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><path d="M6 8.5v7M8.5 6H14a2 2 0 0 1 2 2v0a2 2 0 0 0 2 2h0"/></svg>
</button>
```

#### 2.3.2 Add SCM sidebar pane

In `buildShell()` (line ~1374-1378), add a new sidebar pane after `changes`:

```html
<section class="mesh-sidebar-pane" data-sidebar-pane="scm"></section>
```

Also register `dom.scmPane = qs('[data-sidebar-pane="scm"]', primarySidebar)` after line 1386.

#### 2.3.3 Update `setSidebarView()` to accept 'scm'

At line 528, update the allowed views array:

```js
const nextView = ['explorer', 'search', 'changes', 'scm', 'mesh'].includes(String(view || '')) ? String(view) : 'explorer'
```

At line ~645 (sidebar titles), add:

```js
scm: 'Source Control',
```

#### 2.3.4 Add SCM state

Add to the `state` object (around line 30-50):

```js
scm: {
  branch: '',
  staged: [],
  unstaged: [],
  untracked: [],
  ahead: 0,
  behind: 0,
  commitMessage: '',
  branches: [],
  loading: false,
  pollTimer: null,
},
```

#### 2.3.5 Add SCM rendering and polling functions

Add these functions (put them near the other render functions, around line 670):

```js
async function fetchGitStatus() {
  try {
    state.scm.loading = true;
    const result = await bridge.requestJson('GET', '/api/assistant/git/status');
    if (result.ok) {
      state.scm.branch = result.branch || '';
      state.scm.staged = result.staged || [];
      state.scm.unstaged = result.unstaged || [];
      state.scm.untracked = result.untracked || [];
      state.scm.ahead = result.ahead || 0;
      state.scm.behind = result.behind || 0;
    }
  } catch {} finally {
    state.scm.loading = false;
    renderScmPane();
  }
}

async function fetchGitBranches() {
  try {
    const result = await bridge.requestJson('GET', '/api/assistant/git/branches');
    if (result.ok) {
      state.scm.branches = result.branches || [];
      state.scm.branch = result.current || state.scm.branch;
    }
  } catch {}
}

function startScmPolling() {
  if (state.scm.pollTimer) return;
  fetchGitStatus();
  state.scm.pollTimer = window.setInterval(() => fetchGitStatus(), 5000);
}

function stopScmPolling() {
  if (state.scm.pollTimer) {
    window.clearInterval(state.scm.pollTimer);
    state.scm.pollTimer = null;
  }
}

function renderScmPane() {
  if (!dom.scmPane) return;

  const { branch, staged, unstaged, untracked, ahead, behind, commitMessage } = state.scm;
  const changeCount = staged.length + unstaged.length + untracked.length;

  // Update activity bar badge
  const scmBtn = qs('[data-activity-view="scm"]', root);
  if (scmBtn) {
    let badge = qs('.mesh-activitybar__badge', scmBtn);
    if (changeCount > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'mesh-activitybar__badge';
        scmBtn.appendChild(badge);
      }
      badge.textContent = changeCount;
    } else if (badge) {
      badge.remove();
    }
  }

  dom.scmPane.innerHTML = `
    <div class="mesh-scm">
      <!-- Branch picker -->
      <div class="mesh-scm__branch-bar">
        <button class="mesh-scm__branch-btn" type="button" id="mesh-scm-branch-btn" title="Switch Branch">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M10 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 11a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 2a4 4 0 1 1 0-8v8z"/></svg>
          ${escapeHtml(branch || 'No branch')}
        </button>
        <div class="mesh-scm__sync">
          <button class="mesh-mini-btn" type="button" data-scm-action="pull" title="Pull${behind ? ` (${behind} behind)` : ''}">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 12l-4-4h3V2h2v6h3z"/></svg>
            ${behind ? behind : ''}
          </button>
          <button class="mesh-mini-btn" type="button" data-scm-action="push" title="Push${ahead ? ` (${ahead} ahead)` : ''}">
            <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 2l4 4H9v6H7V6H4z"/></svg>
            ${ahead ? ahead : ''}
          </button>
        </div>
      </div>

      <!-- Commit section -->
      <div class="mesh-scm__commit">
        <textarea class="mesh-scm__commit-input" id="mesh-scm-commit-msg" rows="2"
          placeholder="Commit message">${escapeHtml(commitMessage)}</textarea>
        <div class="mesh-scm__commit-actions">
          <button class="mesh-mini-btn mesh-mini-btn--primary" type="button" data-scm-action="commit"
            ${!staged.length ? 'disabled' : ''}>Commit</button>
          <button class="mesh-mini-btn" type="button" data-scm-action="commit-push"
            ${!staged.length ? 'disabled' : ''}>Commit & Push</button>
        </div>
      </div>

      <!-- Staged changes -->
      ${staged.length ? `
        <details class="mesh-scm__group" open>
          <summary class="mesh-scm__group-title">Staged Changes (${staged.length})</summary>
          <div class="mesh-scm__file-list">
            ${staged.map((f) => `
              <div class="mesh-scm__file mesh-scm__file--staged">
                <span class="mesh-scm__file-status">${escapeHtml(f.status)}</span>
                <button class="mesh-scm__file-name" type="button" data-scm-diff="${escapeHtml(f.file)}">${escapeHtml(f.file)}</button>
                <button class="mesh-scm__file-action" type="button" data-scm-unstage="${escapeHtml(f.file)}" title="Unstage">−</button>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}

      <!-- Unstaged changes -->
      ${unstaged.length ? `
        <details class="mesh-scm__group" open>
          <summary class="mesh-scm__group-title">Changes (${unstaged.length})</summary>
          <div class="mesh-scm__file-list">
            ${unstaged.map((f) => `
              <div class="mesh-scm__file mesh-scm__file--unstaged">
                <span class="mesh-scm__file-status">${escapeHtml(f.status)}</span>
                <button class="mesh-scm__file-name" type="button" data-scm-diff="${escapeHtml(f.file)}">${escapeHtml(f.file)}</button>
                <button class="mesh-scm__file-action" type="button" data-scm-stage="${escapeHtml(f.file)}" title="Stage">+</button>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}

      <!-- Untracked files -->
      ${untracked.length ? `
        <details class="mesh-scm__group" open>
          <summary class="mesh-scm__group-title">Untracked (${untracked.length})</summary>
          <div class="mesh-scm__file-list">
            ${untracked.map((f) => `
              <div class="mesh-scm__file mesh-scm__file--untracked">
                <span class="mesh-scm__file-status">?</span>
                <button class="mesh-scm__file-name" type="button" data-scm-diff="${escapeHtml(f)}">${escapeHtml(f)}</button>
                <button class="mesh-scm__file-action" type="button" data-scm-stage="${escapeHtml(f)}" title="Stage">+</button>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}

      ${!changeCount ? '<div class="mesh-panel-empty">No changes detected.</div>' : ''}
    </div>
  `;
}
```

#### 2.3.6 Wire SCM event handlers

Add click handlers inside `wireEvents()` (the function that sets up all event delegation). Add to the main click delegation:

```js
// SCM actions
const scmAction = target.closest('[data-scm-action]')?.dataset?.scmAction;
if (scmAction === 'commit' || scmAction === 'commit-push') {
  const msg = qs('#mesh-scm-commit-msg')?.value?.trim();
  if (!msg) return;
  state.scm.commitMessage = '';
  try {
    await bridge.requestJson('POST', '/api/assistant/git/commit', { message: msg });
    if (scmAction === 'commit-push') {
      await bridge.requestJson('POST', '/api/assistant/git/push');
    }
    fetchGitStatus();
  } catch (err) {
    console.error('[SCM] Commit failed:', err);
  }
  return;
}
if (scmAction === 'pull') {
  await bridge.requestJson('POST', '/api/assistant/git/pull');
  fetchGitStatus();
  return;
}
if (scmAction === 'push') {
  await bridge.requestJson('POST', '/api/assistant/git/push');
  fetchGitStatus();
  return;
}

const stageFile = target.closest('[data-scm-stage]')?.dataset?.scmStage;
if (stageFile) {
  await bridge.requestJson('POST', '/api/assistant/git/stage', { files: [stageFile] });
  fetchGitStatus();
  return;
}

const unstageFile = target.closest('[data-scm-unstage]')?.dataset?.scmUnstage;
if (unstageFile) {
  await bridge.requestJson('POST', '/api/assistant/git/unstage', { files: [unstageFile] });
  fetchGitStatus();
  return;
}

const diffFile = target.closest('[data-scm-diff]')?.dataset?.scmDiff;
if (diffFile) {
  try {
    const result = await bridge.requestJson('GET', `/api/assistant/git/diff?path=${encodeURIComponent(diffFile)}`);
    if (result.ok && (result.diff || result.stagedDiff)) {
      // Open in diff editor using existing bridge capability
      const diffContent = result.stagedDiff || result.diff;
      bridge.renderDiffPreview?.({ path: diffFile, diff: diffContent });
    }
  } catch {}
  return;
}

// Branch picker
if (target.closest('#mesh-scm-branch-btn')) {
  openBranchPicker();
  return;
}
```

#### 2.3.7 Branch picker dialog

Add a function to show a branch picker (reuse the command palette pattern):

```js
async function openBranchPicker() {
  await fetchGitBranches();
  // Reuse command palette in a special 'branches' mode
  state.commandPaletteMode = 'branches';
  openCommandPalette('branches');
}
```

Update the command palette rendering to handle a 'branches' mode where it shows branches from `state.scm.branches`, and selecting one calls:

```js
await bridge.requestJson('POST', '/api/assistant/git/checkout', { branch: selectedBranch });
fetchGitStatus();
```

#### 2.3.8 Start/stop SCM polling on sidebar switch

In `setSidebarView()`, add:

```js
if (nextView === 'scm') startScmPolling();
else stopScmPolling();
```

#### 2.3.9 Add status bar branch indicator

In `renderStatusbar()` (line ~611), add the current branch to the left section:

```js
// Add before the existing statusWorkspace text
const gitBranch = state.scm.branch;
if (gitBranch) {
  dom.statusWorkspace.textContent = `⎇ ${gitBranch} · ${dom.statusWorkspace.textContent}`;
}
```

#### 2.3.10 Add command palette commands

Add to `commandRegistry` (at line ~299):

```js
{ id: 'git.commit', label: 'Git: Commit', shortcut: '', category: 'Git', action: () => { setSidebarView('scm'); qs('#mesh-scm-commit-msg')?.focus() } },
{ id: 'git.push', label: 'Git: Push', shortcut: '', category: 'Git', action: async () => { await bridge.requestJson('POST', '/api/assistant/git/push'); fetchGitStatus() } },
{ id: 'git.pull', label: 'Git: Pull', shortcut: '', category: 'Git', action: async () => { await bridge.requestJson('POST', '/api/assistant/git/pull'); fetchGitStatus() } },
{ id: 'git.checkout', label: 'Git: Switch Branch', shortcut: '', category: 'Git', action: () => openBranchPicker() },
{ id: 'git.clone', label: 'Git: Clone Repository', shortcut: '', category: 'Git', action: () => openCloneDialog() },
{ id: 'view.scm', label: 'Show Source Control', shortcut: '', category: 'View', action: () => setSidebarView('scm') },
```

### Task 2.4 — SCM Styles in `assistant-workbench.css`

Add these styles (append to end of file):

```css
/* ── Source Control ── */
.mesh-scm { padding: 8px; display: flex; flex-direction: column; gap: 8px; }
.mesh-scm__branch-bar { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 4px 0; }
.mesh-scm__branch-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--mesh-input-bg); border: 1px solid var(--mesh-border);
  border-radius: 4px; padding: 4px 10px; color: var(--mesh-text);
  font-size: 12px; cursor: pointer; flex: 1; min-width: 0;
}
.mesh-scm__branch-btn:hover { border-color: var(--mesh-accent); }
.mesh-scm__sync { display: flex; gap: 4px; }

.mesh-scm__commit { display: flex; flex-direction: column; gap: 6px; }
.mesh-scm__commit-input {
  width: 100%; resize: vertical; min-height: 36px; max-height: 120px;
  background: var(--mesh-input-bg); border: 1px solid var(--mesh-border);
  border-radius: 4px; padding: 6px 8px; color: var(--mesh-text);
  font-size: 12px; font-family: inherit;
}
.mesh-scm__commit-input:focus { border-color: var(--mesh-accent); outline: none; }
.mesh-scm__commit-actions { display: flex; gap: 6px; }
.mesh-scm__commit-actions .mesh-mini-btn { flex: 1; }
.mesh-scm__commit-actions .mesh-mini-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.mesh-scm__group { border: none; margin: 0; padding: 0; }
.mesh-scm__group-title {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.05em; color: var(--mesh-muted-text);
  padding: 6px 0 4px; cursor: pointer; user-select: none;
}
.mesh-scm__file-list { display: flex; flex-direction: column; }
.mesh-scm__file {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 4px; border-radius: 3px; font-size: 12px;
}
.mesh-scm__file:hover { background: var(--mesh-hover); }
.mesh-scm__file-status {
  width: 16px; text-align: center; font-weight: 700; font-size: 11px; flex-shrink: 0;
}
.mesh-scm__file--staged .mesh-scm__file-status { color: #4ec9b0; }
.mesh-scm__file--unstaged .mesh-scm__file-status { color: #e2b93d; }
.mesh-scm__file--untracked .mesh-scm__file-status { color: #888; }
.mesh-scm__file-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: none; border: none; color: var(--mesh-text); text-align: left;
  font-size: 12px; cursor: pointer; padding: 0;
}
.mesh-scm__file-name:hover { text-decoration: underline; }
.mesh-scm__file-action {
  width: 20px; height: 20px; border: none; background: none;
  color: var(--mesh-muted-text); cursor: pointer; font-size: 14px;
  border-radius: 3px; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.mesh-scm__file-action:hover { background: var(--mesh-hover); color: var(--mesh-text); }

.mesh-activitybar__badge {
  position: absolute; top: 2px; right: 2px;
  background: var(--mesh-accent); color: #fff;
  font-size: 9px; font-weight: 700; min-width: 14px; height: 14px;
  border-radius: 7px; display: flex; align-items: center; justify-content: center;
  padding: 0 3px;
}
.mesh-activitybar__item { position: relative; }
```

### Task 2.5 — Clone Dialog

Add a simple clone dialog function in `assistant-workbench.js`:

```js
function openCloneDialog() {
  const url = window.prompt('Enter repository URL to clone:');
  if (!url) return;
  bridge.requestJson('POST', '/api/assistant/git/clone', { url })
    .then((result) => {
      if (result.ok) {
        // Refresh workspace
        bridge.openWorkspace?.();
        fetchGitStatus();
      }
    })
    .catch((err) => console.error('[SCM] Clone failed:', err));
}
```

---

## Phase 3: Split Editor + Polish

### Task 3.1 — Split Editor Support in `assistant-workbench.js`

#### 3.1.1 Update editor state model

Replace the flat `openEditors` / `activeEditor` with an editor groups model. In the `state.workbenchLayout` object (line ~38):

```js
// Replace:
//   openEditors: [],
//   activeEditor: '',
// With:
editorGroups: [
  { id: 'group-1', openEditors: [], activeEditor: '' }
],
activeGroupId: 'group-1',
// Keep legacy accessors as getters for backward compat:
get openEditors() { return this.editorGroups.find(g => g.id === this.activeGroupId)?.openEditors || [] },
set openEditors(v) { const g = this.editorGroups.find(g => g.id === this.activeGroupId); if (g) g.openEditors = v },
get activeEditor() { return this.editorGroups.find(g => g.id === this.activeGroupId)?.activeEditor || '' },
set activeEditor(v) { const g = this.editorGroups.find(g => g.id === this.activeGroupId); if (g) g.activeEditor = v },
```

**Note**: The getter/setter approach ensures all existing code that reads `state.workbenchLayout.openEditors` and `state.workbenchLayout.activeEditor` continues to work unchanged. Only the split editor code needs to be aware of `editorGroups`.

#### 3.1.2 Split editor DOM

Update `buildShell()` to wrap the editor area in a flex container. The current structure has `mesh-editor-group` as a single area. Change it to:

```html
<div class="mesh-editor-groups">
  <div class="mesh-editor-group" data-editor-group="group-1">
    <!-- existing tab bar + breadcrumbs + content goes here -->
  </div>
</div>
```

#### 3.1.3 Add split function

```js
function splitEditorRight() {
  const currentGroup = state.workbenchLayout.editorGroups.find(g => g.id === state.workbenchLayout.activeGroupId);
  if (!currentGroup) return;
  if (state.workbenchLayout.editorGroups.length >= 3) return; // max 3 splits

  const activeEditor = currentGroup.openEditors.find(e => e.id === currentGroup.activeEditor);
  if (!activeEditor) return;

  const newGroupId = `group-${Date.now()}`;
  const newGroup = {
    id: newGroupId,
    openEditors: [{ ...activeEditor }],
    activeEditor: activeEditor.id,
  };
  state.workbenchLayout.editorGroups.push(newGroup);
  state.workbenchLayout.activeGroupId = newGroupId;

  renderEditorGroups();
}

function closeEditorGroup(groupId) {
  state.workbenchLayout.editorGroups = state.workbenchLayout.editorGroups.filter(g => g.id !== groupId);
  if (!state.workbenchLayout.editorGroups.length) {
    state.workbenchLayout.editorGroups.push({ id: 'group-1', openEditors: [], activeEditor: '' });
  }
  if (!state.workbenchLayout.editorGroups.find(g => g.id === state.workbenchLayout.activeGroupId)) {
    state.workbenchLayout.activeGroupId = state.workbenchLayout.editorGroups[0].id;
  }
  renderEditorGroups();
}

function renderEditorGroups() {
  const container = qs('.mesh-editor-groups', root);
  if (!container) return;

  // Build DOM for each group
  container.innerHTML = state.workbenchLayout.editorGroups.map((group) => {
    const editors = group.openEditors;
    const activeEd = editors.find(e => e.id === group.activeEditor) || editors[editors.length - 1];
    const isActiveGroup = group.id === state.workbenchLayout.activeGroupId;

    const tabs = editors.map((editor) => `
      <article class="mesh-editor-tab${editor.id === group.activeEditor ? ' is-active' : ''}">
        <button class="mesh-editor-tab__btn" type="button" data-editor-id="${escapeHtml(editor.id)}" data-group-id="${escapeHtml(group.id)}">
          <span class="${fileIconClass(editor.title)}">${fileIconLabel(editor.title)}</span>
          <span class="mesh-editor-tab__title">${escapeHtml(editor.title)}</span>
        </button>
        <button class="mesh-editor-tab__close" type="button" data-close-editor="${escapeHtml(editor.id)}" data-group-id="${escapeHtml(group.id)}">\u00D7</button>
      </article>
    `).join('');

    const breadcrumbs = activeEd?.path
      ? activeEd.path.split('/').filter(Boolean).map((seg, i, arr) => {
          const partial = arr.slice(0, i + 1).join('/');
          return `<button class="mesh-breadcrumb-segment" type="button" data-breadcrumb-path="${escapeHtml(partial)}">${escapeHtml(seg)}</button>${i < arr.length - 1 ? '<span class="mesh-breadcrumb-sep">\u203A</span>' : ''}`;
        }).join('')
      : '';

    return `
      <div class="mesh-editor-group${isActiveGroup ? ' is-active-group' : ''}" data-editor-group="${escapeHtml(group.id)}">
        <div class="mesh-editor-tabbar">${tabs || '<span class="mesh-editor-tab__empty">No open editors</span>'}</div>
        <div class="mesh-editor-breadcrumbs">${breadcrumbs || 'Open a file to start editing.'}</div>
        <div class="mesh-editor-content" data-group-content="${escapeHtml(group.id)}"></div>
      </div>
    `;
  }).join('<div class="mesh-editor-group-resizer"></div>');

  // Re-mount Monaco into the active group's content area
  const activeContent = qs(`[data-group-content="${state.workbenchLayout.activeGroupId}"]`, container);
  if (activeContent && window.monacoEditorInstance) {
    activeContent.appendChild(window.monacoEditorInstance.getDomNode());
    window.monacoEditorInstance.layout();
  }
}
```

#### 3.1.4 Add context menu for split

Add right-click context menu on editor tabs:

```js
function showTabContextMenu(e, editorId, groupId) {
  e.preventDefault();
  removeContextMenu(); // remove any existing

  const menu = document.createElement('div');
  menu.className = 'mesh-context-menu';
  menu.innerHTML = `
    <button class="mesh-context-menu__item" data-ctx="close" data-editor-id="${escapeHtml(editorId)}" data-group-id="${escapeHtml(groupId)}">Close</button>
    <button class="mesh-context-menu__item" data-ctx="close-others" data-editor-id="${escapeHtml(editorId)}" data-group-id="${escapeHtml(groupId)}">Close Others</button>
    <button class="mesh-context-menu__item" data-ctx="close-all" data-group-id="${escapeHtml(groupId)}">Close All</button>
    <div class="mesh-context-menu__sep"></div>
    <button class="mesh-context-menu__item" data-ctx="split-right" data-editor-id="${escapeHtml(editorId)}">Split Right</button>
  `;
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10000`;
  document.body.appendChild(menu);

  const handler = (evt) => {
    const item = evt.target.closest('[data-ctx]');
    if (item) {
      const ctx = item.dataset.ctx;
      if (ctx === 'close') closeEditorById(editorId);
      if (ctx === 'close-others') closeOtherEditors(editorId, groupId);
      if (ctx === 'close-all') closeAllEditors(groupId);
      if (ctx === 'split-right') splitEditorRight();
    }
    removeContextMenu();
    document.removeEventListener('click', handler);
  };
  setTimeout(() => document.addEventListener('click', handler), 0);
}

function removeContextMenu() {
  qs('.mesh-context-menu', document.body)?.remove();
}
```

### Task 3.2 — File Tree Context Menu in `assistant-workbench.js`

Add right-click handler on file explorer items:

```js
function showFileContextMenu(e, filePath) {
  e.preventDefault();
  removeContextMenu();

  const fileName = filePath.split('/').pop();
  const menu = document.createElement('div');
  menu.className = 'mesh-context-menu';
  menu.innerHTML = `
    <button class="mesh-context-menu__item" data-ctx="open" data-path="${escapeHtml(filePath)}">Open</button>
    <button class="mesh-context-menu__item" data-ctx="open-side" data-path="${escapeHtml(filePath)}">Open to the Side</button>
    <div class="mesh-context-menu__sep"></div>
    <button class="mesh-context-menu__item" data-ctx="rename" data-path="${escapeHtml(filePath)}">Rename</button>
    <button class="mesh-context-menu__item" data-ctx="delete" data-path="${escapeHtml(filePath)}">Delete</button>
    <div class="mesh-context-menu__sep"></div>
    <button class="mesh-context-menu__item" data-ctx="copy-path" data-path="${escapeHtml(filePath)}">Copy Path</button>
    <button class="mesh-context-menu__item" data-ctx="copy-name" data-name="${escapeHtml(fileName)}">Copy Name</button>
  `;
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:10000`;
  document.body.appendChild(menu);

  const handler = (evt) => {
    const item = evt.target.closest('[data-ctx]');
    if (item) {
      const ctx = item.dataset.ctx;
      if (ctx === 'open') bridge.openWorkspaceFile?.(filePath);
      if (ctx === 'open-side') { bridge.openWorkspaceFile?.(filePath); splitEditorRight(); }
      if (ctx === 'rename') {
        const newName = window.prompt('New name:', fileName);
        if (newName && newName !== fileName) {
          const newPath = filePath.replace(/[^/]+$/, newName);
          bridge.requestJson('POST', '/api/assistant/workspace/rename', { oldPath: filePath, newPath });
        }
      }
      if (ctx === 'delete') {
        if (window.confirm(`Delete ${fileName}?`)) {
          bridge.requestJson('DELETE', '/api/assistant/workspace/file', { path: filePath });
        }
      }
      if (ctx === 'copy-path') navigator.clipboard?.writeText(filePath);
      if (ctx === 'copy-name') navigator.clipboard?.writeText(fileName);
    }
    removeContextMenu();
    document.removeEventListener('click', handler);
  };
  setTimeout(() => document.addEventListener('click', handler), 0);
}
```

Wire it in the file tree: add `contextmenu` listener on file items in the explorer pane.

### Task 3.3 — Keyboard Shortcuts in `assistant-workbench.js`

Ensure these shortcuts are handled in the existing keydown handler (already partially implemented):

| Shortcut | Action |
|----------|--------|
| `Cmd+S` / `Ctrl+S` | Save current file |
| `Cmd+W` / `Ctrl+W` | Close active editor tab |
| `Cmd+Shift+P` / `Ctrl+Shift+P` | Command palette |
| `Cmd+P` / `Ctrl+P` | Quick file open |
| `` Ctrl+` `` | Toggle terminal panel |
| `Cmd+B` / `Ctrl+B` | Toggle primary sidebar |
| `Cmd+\` / `Ctrl+\` | Split editor right |
| `Cmd+Tab` / `Ctrl+Tab` | Switch to next editor tab |
| `Cmd+H` / `Ctrl+H` | Find & Replace (Monaco built-in, just needs `Cmd+H` to not be swallowed) |
| `Escape` | Close command palette / context menu |

### Task 3.4 — Drag-and-Drop Tab Reordering

Add `draggable="true"` to editor tab articles and wire `dragstart`, `dragover`, `drop` events:

```js
// In wireEvents or after rendering tabs:
function wireTabDragDrop() {
  const tabbar = qs('.mesh-editor-tabbar', root);
  if (!tabbar) return;

  tabbar.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.mesh-editor-tab');
    if (!tab) return;
    e.dataTransfer.setData('text/plain', tab.querySelector('[data-editor-id]')?.dataset.editorId || '');
    tab.classList.add('is-dragging');
  });

  tabbar.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  tabbar.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const dropTarget = e.target.closest('.mesh-editor-tab');
    if (!dropTarget || !draggedId) return;
    const targetId = dropTarget.querySelector('[data-editor-id]')?.dataset.editorId;
    if (!targetId || targetId === draggedId) return;

    const editors = state.workbenchLayout.openEditors;
    const fromIdx = editors.findIndex(ed => ed.id === draggedId);
    const toIdx = editors.findIndex(ed => ed.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;

    const [moved] = editors.splice(fromIdx, 1);
    editors.splice(toIdx, 0, moved);
    renderEditorTabs();
  });

  tabbar.addEventListener('dragend', () => {
    qsa('.is-dragging', tabbar).forEach(el => el.classList.remove('is-dragging'));
  });
}
```

### Task 3.5 — Welcome Tab

When no files are open, show a welcome view in the editor content area:

```js
function renderWelcomeTab() {
  return `
    <div class="mesh-welcome">
      <h2>Welcome to Mesh AI Workbench</h2>
      <div class="mesh-welcome__section">
        <h3>Start</h3>
        <button class="mesh-welcome__link" data-welcome-action="open-folder">Open Folder...</button>
        <button class="mesh-welcome__link" data-welcome-action="clone">Clone Repository...</button>
      </div>
      <div class="mesh-welcome__section">
        <h3>Recent</h3>
        <p class="mesh-welcome__hint">Your recent workspaces will appear here.</p>
      </div>
      <div class="mesh-welcome__section">
        <h3>Shortcuts</h3>
        <div class="mesh-welcome__shortcut"><kbd>Cmd+Shift+P</kbd> Command Palette</div>
        <div class="mesh-welcome__shortcut"><kbd>Cmd+P</kbd> Quick Open File</div>
        <div class="mesh-welcome__shortcut"><kbd>Ctrl+\`</kbd> Toggle Terminal</div>
        <div class="mesh-welcome__shortcut"><kbd>Cmd+B</kbd> Toggle Sidebar</div>
      </div>
    </div>
  `;
}
```

Show this in `renderEditorTabs()` when `openEditors.length === 0`.

### Task 3.6 — Notification Toasts in `assistant-workbench.js`

```js
function showNotification(message, type = 'info', durationMs = 4000) {
  let container = qs('.mesh-notification-stack', root);
  if (!container) {
    container = document.createElement('div');
    container.className = 'mesh-notification-stack';
    root.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `mesh-notification mesh-notification--${type}`;
  toast.innerHTML = `
    <span class="mesh-notification__msg">${escapeHtml(message)}</span>
    <button class="mesh-notification__close" type="button">\u00D7</button>
  `;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('is-leaving');
    setTimeout(() => toast.remove(), 300);
  };
  toast.querySelector('.mesh-notification__close').addEventListener('click', dismiss);
  if (durationMs > 0) setTimeout(dismiss, durationMs);
}
```

Use `showNotification()` after git operations (commit success, push success, errors).

### Task 3.7 — Notification + Context Menu + Welcome + Split Editor Styles

Add to `assistant-workbench.css`:

```css
/* ── Context Menu ── */
.mesh-context-menu {
  background: var(--mesh-surface); border: 1px solid var(--mesh-border);
  border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,0.18);
  min-width: 180px; padding: 4px 0; font-size: 12px;
}
.mesh-context-menu__item {
  display: block; width: 100%; padding: 6px 16px; text-align: left;
  background: none; border: none; color: var(--mesh-text);
  cursor: pointer; font-size: 12px;
}
.mesh-context-menu__item:hover { background: var(--mesh-hover); }
.mesh-context-menu__sep { height: 1px; background: var(--mesh-border); margin: 4px 0; }

/* ── Notification Toasts ── */
.mesh-notification-stack {
  position: fixed; bottom: 32px; right: 16px; z-index: 10001;
  display: flex; flex-direction: column; gap: 8px; max-width: 380px;
}
.mesh-notification {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 14px; border-radius: 6px; font-size: 13px;
  background: var(--mesh-surface); border: 1px solid var(--mesh-border);
  box-shadow: 0 4px 12px rgba(0,0,0,0.12); color: var(--mesh-text);
  animation: meshNotifyIn 0.3s ease;
}
.mesh-notification.is-leaving { animation: meshNotifyOut 0.3s ease forwards; }
.mesh-notification--error { border-left: 3px solid #e74c3c; }
.mesh-notification--success { border-left: 3px solid #4ec9b0; }
.mesh-notification--info { border-left: 3px solid var(--mesh-accent); }
.mesh-notification__msg { flex: 1; }
.mesh-notification__close {
  background: none; border: none; color: var(--mesh-muted-text);
  cursor: pointer; font-size: 16px; padding: 0 2px;
}
@keyframes meshNotifyIn { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
@keyframes meshNotifyOut { from { opacity: 1; } to { opacity: 0; transform: translateX(20px); } }

/* ── Split Editor Groups ── */
.mesh-editor-groups { display: flex; flex: 1; min-height: 0; overflow: hidden; }
.mesh-editor-group {
  flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0;
  border-right: 1px solid var(--mesh-border);
}
.mesh-editor-group:last-child { border-right: none; }
.mesh-editor-group.is-active-group .mesh-editor-tabbar { background: var(--mesh-surface); }
.mesh-editor-group-resizer {
  width: 4px; cursor: col-resize; background: transparent; flex-shrink: 0;
}
.mesh-editor-group-resizer:hover { background: var(--mesh-accent); }
.mesh-editor-content { flex: 1; min-height: 0; overflow: hidden; position: relative; }

/* ── Welcome Tab ── */
.mesh-welcome {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  height: 100%; padding: 40px; color: var(--mesh-muted-text); text-align: center;
}
.mesh-welcome h2 { font-size: 22px; font-weight: 300; color: var(--mesh-text); margin-bottom: 32px; }
.mesh-welcome__section { margin-bottom: 24px; }
.mesh-welcome__section h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.mesh-welcome__link {
  display: block; background: none; border: none; color: var(--mesh-accent);
  cursor: pointer; font-size: 13px; padding: 4px 0; text-decoration: underline;
}
.mesh-welcome__hint { font-size: 12px; }
.mesh-welcome__shortcut { font-size: 12px; padding: 3px 0; }
.mesh-welcome__shortcut kbd {
  background: var(--mesh-input-bg); border: 1px solid var(--mesh-border);
  border-radius: 3px; padding: 1px 6px; font-family: inherit; font-size: 11px;
  margin-right: 8px;
}

/* ── Dragging tab ── */
.mesh-editor-tab.is-dragging { opacity: 0.4; }
```

### Task 3.8 — Responsive / Mobile

Add at the bottom of `assistant-workbench.css`:

```css
@media (max-width: 768px) {
  #view-ai.mesh-vscode-root { --mesh-primary-sidebar-width: 0px !important; }
  .mesh-primary-sidebar, .mesh-column-resizer--primary { display: none; }
  .mesh-secondary-sidebar { position: fixed; right: 0; top: 36px; bottom: 24px; z-index: 100; width: 90vw !important; }
  .mesh-activitybar { width: 36px; }
  .mesh-activitybar__item svg { width: 18px; height: 18px; }
}
```

---

## Verification Checklist

### Phase 2
- [ ] `GET /api/assistant/git/status` returns branch, staged, unstaged, untracked, ahead, behind
- [ ] SCM activity bar button appears with badge showing change count
- [ ] SCM sidebar shows staged/unstaged/untracked file groups
- [ ] Clicking a changed file opens diff in Monaco diff editor
- [ ] Stage/Unstage buttons move files between groups
- [ ] Commit with message creates a git commit
- [ ] Commit & Push creates commit then pushes
- [ ] Pull/Push buttons work with ahead/behind counts
- [ ] Branch picker shows all branches, switching works
- [ ] Clone Repository command palette entry works
- [ ] Status bar shows current branch name
- [ ] SCM polling refreshes every 5s when SCM pane is active, stops when switching away
- [ ] All git commands handled gracefully when not in a git repo (show "Not a git repository" error)
- [ ] Run `node --check server.js` and `node --check mesh-core/src/server.js` — no syntax errors
- [ ] Run `npm test` — all existing tests still pass

### Phase 3
- [ ] Right-click editor tab shows context menu (Close, Close Others, Close All, Split Right)
- [ ] "Split Right" creates a second editor group side by side
- [ ] Each editor group has its own tab bar and breadcrumbs
- [ ] Clicking in a group makes it the active group
- [ ] Max 3 splits enforced
- [ ] Closing all tabs in a group removes the group
- [ ] Right-click file in explorer shows context menu (Open, Rename, Delete, Copy Path)
- [ ] Editor tabs are draggable for reordering
- [ ] Welcome tab shows when no files are open
- [ ] Notification toasts appear and auto-dismiss
- [ ] `Cmd+\` splits editor right
- [ ] `Cmd+Tab` switches editor tabs
- [ ] All keyboard shortcuts work (Cmd+S, Cmd+W, Cmd+Shift+P, Cmd+P, Ctrl+`, Cmd+B)
- [ ] On narrow viewports (<768px), sidebar auto-hides
- [ ] Run `node --check server.js` — no syntax errors
- [ ] Run `npm test` — all existing tests still pass

---

## File Change Summary

| File | Phase | What to Change |
|------|-------|----------------|
| `server.js` | 2 | Add ~15 git API routes after line 6294, before the chat route |
| `mesh-core/src/server.js` | 2 | Add `execFile` import, `runGit()` helper, ~15 git tunnel actions in the if/else dispatch chain (before the final `else` at line 857) |
| `assets/assistant-workbench.js` | 2, 3 | SCM state + rendering + polling + event handlers + commands; Split editor groups model + rendering; Context menus; Drag-drop tabs; Welcome tab; Notification toasts; New keyboard shortcuts |
| `assets/assistant-workbench.css` | 2, 3 | SCM styles, context menu, notification toasts, split editor groups, welcome tab, drag state, responsive breakpoint |
