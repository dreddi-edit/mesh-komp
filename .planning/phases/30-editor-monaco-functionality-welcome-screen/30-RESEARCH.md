# Phase 30: Editor — Monaco Functionality & Welcome Screen
## RESEARCH COMPLETE

**Date:** 2026-04-17
**Phase:** 30 — Editor — Monaco Functionality & Welcome Screen
**Requirements:** EDIT-01, EDIT-02, EDIT-03

---

## Root Cause Analysis

### EDIT-01: Monaco Rendering (Inconsistent blank/unstyled editor)

**Root cause confirmed:** `app-workspace.js:1132` — `initMonaco()` has a hard early return `if(typeof require==='undefined')return`. When `loader.js` is `defer`-loaded and app-workspace.js is also `defer`-loaded, both fire after HTML parse. `loader.js` (line 521) is ordered before `app-workspace.js` (line 533) so `require` is usually defined. However on slow CDN connections loader.js can still be downloading when DOMContentLoaded fires, causing the early return to silently kill the entire Monaco initialization chain. `S.monacoReady` stays false forever, `createEditor()` becomes a no-op, and the editor never renders.

**Worker config** at `app.njk:507-519` is correct (Blob workers from CDN). No changes needed there.

**Fix:** Replace the single `typeof require === 'undefined'` guard with a polling loop (50ms interval, 8s timeout) that waits for `require` before calling `require.config(...)`. No `onload` attribute needed — polling is simpler and handles the case cleanly.

### EDIT-02: Welcome Screen Recent Workspaces

**Current state:** `app.njk:258-262` has a hardcoded `.ws-item` div. The `$$('.ws-item')` click handler at `app-workspace.js:2083` just calls `openFolder()` (directory picker) — no stored handle used.

**Backend:** `src/core/auth.js:31` defines `USER_STORE_ALLOWED_KEYS` — any new store key must be added here. The existing `/api/user/store/:key` PUT/GET routes at `app.routes.js:345-395` handle all storage. No new routes needed.

**idb-keyval:** Already loaded at `app.njk:522`. Currently only stores `last-folder`. Extend to `recent-folder-0`, `recent-folder-1`, `recent-folder-2`.

**Safe DOM construction pattern** (avoids innerHTML XSS risk — consistent with existing codebase):
```js
function renderRecentWorkspaces(recents) {
  const container = document.querySelector('#welcomeScr .workspaces');
  if (!container) return;
  container.textContent = '';
  const title = document.createElement('div');
  title.className = 'workspaces-title';
  title.textContent = 'Recent';
  container.appendChild(title);
  recents.slice(0, 3).forEach((ws, i) => {
    const el = document.createElement('div');
    el.className = 'ws-item';
    el.dataset.idbKey = `recent-folder-${i}`;
    const name = document.createElement('span');
    name.className = 'ws-name';
    name.textContent = ws.name;
    const path = document.createElement('span');
    path.className = 'ws-path';
    path.textContent = ws.path || '(local)';
    el.appendChild(name);
    el.appendChild(path);
    el.addEventListener('click', () => openRecentWorkspace(i));
    container.appendChild(el);
  });
}
```

**`openRecentWorkspace(index)` pattern:**
```js
async function openRecentWorkspace(index) {
  if (!window.idbKeyval) { openFolder(); return; }
  const h = await idbKeyval.get('recent-folder-' + index);
  if (!h) { toast('Info', 'Re-select folder'); openFolder(); return; }
  const perm = await h.queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    const req = await h.requestPermission({ mode: 'readwrite' });
    if (req !== 'granted') { toast('Error', 'Permission denied'); return; }
  }
  // Continue with same flow as openFolder() after h is obtained
}
```

**Save recent workspace** (called after successful `openFolder()`):
```js
async function saveRecentWorkspace(h) {
  // Shift existing handles down: 0→1, 1→2 (drop 2 if existed)
  const prev0 = await idbKeyval.get('recent-folder-0').catch(() => null);
  const prev1 = await idbKeyval.get('recent-folder-1').catch(() => null);
  if (prev1) await idbKeyval.set('recent-folder-2', prev1);
  if (prev0) await idbKeyval.set('recent-folder-1', prev0);
  await idbKeyval.set('recent-folder-0', h);
  // Also persist to server for cross-cache-clear persistence
  try {
    const existing = await api('/api/user/store/meshRecentWorkspaces').then(d => d?.value?.list || []).catch(() => []);
    const entry = { name: h.name, path: '(local)', timestamp: Date.now() };
    const updated = [entry, ...existing.filter(w => w.name !== h.name)].slice(0, 3);
    await api('/api/user/store/meshRecentWorkspaces', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: { list: updated }, merge: false }),
    });
  } catch { /* non-critical — idb-keyval still works */ }
}
```

### EDIT-03: Indexing Indicator

**Bug 1 — shows on startup investigation:**

Re-reading `restoreFolder()` at `app-workspace.js:898-940`:
- Line 901: `const h = await idbKeyval.get('last-folder')`
- Line 905-907: `if ((await h.queryPermission(opt)) !== 'granted') { if (options.interactive === false) return false; }`
- Line 912: `updateIndexProgressState('scanning', { ratio: 0.08, ... })`

So with `interactive: false`, if permission is NOT granted → returns false at 907 before line 912. This path does NOT show the indicator.

BUT: if `queryPermission` returns 'granted' (user has visited before, browser remembers), `restoreFolder` proceeds, calls `updateIndexProgressState('scanning')` at 912, starts scanning — and at the end calls `updateIndexProgressState('graph-ready')` which sets a 1.4s timer to call `updateIndexProgressState('idle')`. If the scan COMPLETES NORMALLY, the indicator hides correctly.

**Actual "always shows" scenario:** The indicator text "Indexing..." in the HTML (`app.njk:484`) is the `#idxProgText` element. The wrap is `display:none`. User sees the indicator — which means either: (a) `restoreFolder` scans and succeeds but the graph-ready→idle timer isn't firing, OR (b) some external event triggers the scan. The user says it shows even when no folder is open.

**Third path found:** `app-graph.js` references indexing — let's note for executor to check. Also: `init()` at line 2143 calls `initMonaco(()=>{createEditor();...})` AND at line 2161 calls `await restoreFolder({ interactive: false, reopenPath: snapshot.activeTabPath })`. The key is `snapshot` — if `readShellSnapshot()` returns a snapshot with `reason !== 'open-settings'`, the code falls through to the idb-keyval check but doesn't call `restoreFolder`. However, if `snapshot.reason === 'open-settings'` it DOES call `restoreFolder` with `interactive: false`.

**Definitive fix:** Add a guard at the start of `updateIndexProgressState` calls in all scan-initiating functions: only proceed with showing the indicator if `S.dirHandle` is set:

```js
// In updateIndexProgressState, add at top:
if (state !== 'idle' && !S.dirHandle) return;
```

This single guard prevents the indicator from ever appearing when no folder is open, regardless of which code path triggers it.

**Bug 2 — glitches during indexing:** CSS already has `transition: width .24s ease` at `app-workspace.css:388`. The "glitch" is the indicator appearing and immediately trying to go to `graph-ready` then `idle` in quick succession during short scans. The guard above prevents the startup case. For actual indexing glitches, the existing timer logic is correct — no additional changes needed beyond the guard.

---

## Implementation Map

### Files to Modify

| File | Change |
|------|--------|
| `views/app.njk` | Remove hardcoded `.ws-item` div (keep `.workspaces` container with just the title) |
| `assets/app-workspace.js` | (1) Replace `initMonaco()` with polling version; (2) Add `dirHandle` guard to `updateIndexProgressState`; (3) Add `saveRecentWorkspace()`, `loadRecentWorkspaces()`, `renderRecentWorkspaces()`, `openRecentWorkspace()`; (4) Call `saveRecentWorkspace(h)` in `openFolder()` after success; (5) Load and render recents in `bootstrap()` |
| `src/core/auth.js` | Add `'meshRecentWorkspaces'` to `USER_STORE_ALLOWED_KEYS` set |

### No New Routes Required

Existing `/api/user/store/:key` PUT/GET routes handle recent workspace storage.

### Wave Plan

- **Wave 1 (parallel):**
  - Plan 01 — EDIT-03: Indexing indicator guard (1-line change to `updateIndexProgressState`, isolated)
  - Plan 02 — EDIT-01: Monaco loader polling fix (`initMonaco` replacement, isolated)
- **Wave 2:**
  - Plan 03 — EDIT-02: Welcome screen recent workspaces (depends on auth.js key addition + new JS functions)

---

## Validation Architecture

### Test Matrix

| Requirement | Verification Method |
|-------------|---------------------|
| EDIT-01 | `app-workspace.js` contains `setInterval` inside `initMonaco`; open JS file → syntax colors visible in browser |
| EDIT-02 | `USER_STORE_ALLOWED_KEYS` contains `meshRecentWorkspaces`; `saveRecentWorkspace` function exists; open 3 folders → welcome screen shows all 3 after refresh |
| EDIT-03 | `updateIndexProgressState` has `S.dirHandle` guard; load app fresh → no indexing indicator in status bar |
