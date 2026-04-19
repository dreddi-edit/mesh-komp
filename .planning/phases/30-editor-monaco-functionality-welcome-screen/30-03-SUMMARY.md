## PLAN COMPLETE

**Plan:** 30-03 — EDIT-02: Welcome Screen Recent Workspaces
**Status:** Complete
**Commits:** e2b3b0c, c2cb5ce, faabb6b

## What Was Built

Three coordinated changes:

1. **`src/core/auth.js`** — Added `'meshRecentWorkspaces'` to `USER_STORE_ALLOWED_KEYS`, enabling the existing `/api/user/store/:key` PUT/GET endpoints to store recent workspace metadata per user.

2. **`views/app.njk`** — Replaced the hardcoded `ws-item` div (mesh-komp) with an empty `#recentWsList` container. Title changed from "Workspaces" to "Recent".

3. **`assets/app-workspace.js`** — Four new functions:
   - `saveRecentWorkspace(h)` — shifts idb-keyval handles (0→1→2, new→0), updates server store via PUT
   - `loadRecentWorkspaces()` — fetches `{list}` from server (survives cache clears)
   - `renderRecentWorkspaces(recents)` — safe DOM construction (textContent), up to 3 items with `openRecentWorkspace` click handlers
   - `openRecentWorkspace(index)` — `requestPermission('readwrite')` on stored handle; falls back to `showDirectoryPicker` if handle expired

   Plus: `openFolder()` calls `saveRecentWorkspace` after success; `bootstrap()` loads and renders recents; static `$$('.ws-item')` click handler removed from `bind()`.

## Key Files

- `src/core/auth.js` — `USER_STORE_ALLOWED_KEYS` line 48
- `views/app.njk` — `#recentWsList` at line 258
- `assets/app-workspace.js` — Recent workspace functions at lines 2156-2270

## Self-Check: PASSED

- `meshRecentWorkspaces` in allowlist: ✓
- `saveRecentWorkspace` called in `openFolder`: ✓
- `renderRecentWorkspaces` called in `bootstrap`: ✓
- No innerHTML used (all textContent): ✓
- Static ws-item handler removed from bind(): ✓
