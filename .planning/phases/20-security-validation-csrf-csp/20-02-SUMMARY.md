---
plan: 20-02
title: CSRF Token Protection
status: complete
completed: 2026-04-16
commit: 44c771d
---

## What Was Built

Added CSRF token protection using `csrf-csrf` (double-submit cookie pattern) to all mutating routes. Removed the old Origin/Referer CSRF guard and replaced it with token-based middleware. Added `GET /api/csrf-token` endpoint for clients to seed their token. Updated `assets/mesh-client.js` with a `MeshCsrf` token manager that auto-injects `X-CSRF-Token` on all POST/PUT/PATCH/DELETE requests and retries once on 403.

## Key Files Created/Modified

- `src/middleware/csrf.js` — doubleCsrf configuration, exports csrfProtection + generateToken
- `src/config/index.js` — added CSRF_SECRET with fallback chain
- `src/server.js` — replaced csrfGuard function with csrf-csrf middleware + /api/csrf-token endpoint
- `assets/mesh-client.js` — added MeshCsrf token manager (window.MeshCsrf.safeFetch)

## Self-Check: PASSED

- `grep "doubleCsrf" src/middleware/csrf.js` ✓
- `grep "CSRF_SECRET" src/config/index.js` ✓
- `grep "csrfProtection" src/server.js` ✓
- `grep "/api/csrf-token" src/server.js` ✓
- Old Origin/Referer CSRF block removed ✓
- `grep "X-CSRF-Token" assets/mesh-client.js` ✓
- `npm test`: no new failures vs baseline
