---
phase: "39"
plan: "39-01"
subsystem: settings
tags: [auth, server, settings, theme]
requires: []
provides:
  - Server-side auth gate for /settings
  - Dead code removal (showSettingsAuthWarning)
  - DEFAULT_APPEARANCE.theme changed to "system"
affects:
  - src/server.js
  - assets/settings.js
tech-stack:
  added: []
  patterns:
    - resolveAuthUserFromRequest direct call in page route (not API middleware)
key-files:
  created: []
  modified:
    - src/server.js
    - assets/settings.js
key-decisions:
  - Used resolveAuthUserFromRequest directly (not requireAuth) — page route needs redirect, not 401 JSON
  - /settings route registered before VIEW_ROUTE_MAP app.use() middleware for correct Express order
requirements-completed:
  - SETT-04
  - SETT-05
duration: "3 min"
completed: "2026-04-19"
---

# Phase 39 Plan 01: Auth Gate + JS Cleanup + DEFAULT_APPEARANCE Summary

Server-side auth gate added for `/settings` — unauthenticated users redirected to `/app?login=1`. Dead `showSettingsAuthWarning()` function and call site removed. `DEFAULT_APPEARANCE.theme` changed from `"light"` to `"system"`.

**Duration:** ~3 min | **Completed:** 2026-04-19
**Tasks:** 3 | **Files:** 2 modified

## What Was Built

- **`src/server.js`** — Added `const { resolveAuthUserFromRequest } = require('./core/auth')` and a dedicated `app.get('/settings', ...)` route before the VIEW_ROUTE_MAP middleware. Unauthenticated GET /settings → `res.redirect('/app?login=1')`. Authenticated → `sendHtmlWithHashes(res, 'settings.njk')`.
- **`assets/settings.js`** — Removed `showSettingsAuthWarning()` function (24 lines) and the `if (response.status === 401) { showSettingsAuthWarning(); } else if` branch in `preloadUserStoreCache()`. Changed `DEFAULT_APPEARANCE.theme` from `"light"` to `"system"`.

## Task Commits

- Tasks 39-01-01/02/03: `6494bfb` — feat(39-01): add /settings auth gate + remove dead auth warning + system theme default

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Self-Check: PASSED

- `grep "resolveAuthUserFromRequest" src/server.js` → 2 matches (require + usage) ✓
- `grep "res.redirect('/app?login=1')" src/server.js` → 1 match ✓
- `grep "app.get('/settings'" src/server.js` → 1 match ✓
- `/settings` route appears before VIEW_ROUTE_MAP app.use() ✓
- `grep "showSettingsAuthWarning" assets/settings.js` → 0 matches ✓
- `grep 'theme: "system"' assets/settings.js` → 1 match ✓

## Next

Ready for Wave 2 (39-02): views/settings.njk template changes (requires browser verify).
