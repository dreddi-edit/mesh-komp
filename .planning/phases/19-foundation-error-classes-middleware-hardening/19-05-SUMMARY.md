---
phase: 19
plan: "05"
title: "HTTP Cache Headers + Directory Cleanup"
status: complete
started: 2026-04-16T22:00:00Z
completed: 2026-04-16T22:10:00Z
---

# Summary: 19-05 HTTP Cache Headers + Directory Cleanup

## What was built
Added `cacheControl()` middleware helper to route-utils.js. Applied Cache-Control headers to 11 read-only GET endpoints: docs (60s), workspace files/graph/file (30s), git status/branches/diff/log (10s). Removed empty `src/services/` and `src/utils/` directories.

## Key files
- `src/routes/route-utils.js` — cacheControl helper (created)
- `src/routes/app.routes.js` — cache headers on docs + ops endpoints
- `src/routes/assistant-workspace.routes.js` — cache headers on file listing/read
- `src/routes/assistant-git.routes.js` — cache headers on git status/branches/diff/log

## Decisions
- Did not apply to SSE streaming, POST/PUT/PATCH/DELETE, auth, or health endpoints
- Cache durations tiered: 60s (stable data), 30s (workspace files), 10s (git state)
- Empty dirs `src/services/` and `src/utils/` removed (Phase 25 recreates src/services/)

## Self-Check: PASSED
- cacheControl used in all 3 route files
- npm test: 129 pass, 0 fail
