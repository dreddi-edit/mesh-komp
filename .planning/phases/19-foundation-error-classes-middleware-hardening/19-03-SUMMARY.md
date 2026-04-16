---
phase: 19
plan: "03"
title: "Helmet + CORS Middleware"
status: complete
started: 2026-04-16T21:50:00Z
completed: 2026-04-16T21:55:00Z
---

# Summary: 19-03 Helmet + CORS Middleware

## What was built
Replaced hand-rolled security headers in server.js with helmet package. Configured helmet to match prior behavior: DENY frame guard, strict-origin-when-cross-origin referrer policy, conditional HSTS, Permissions-Policy with microphone=(self). Wired CORS with explicit origin allowlist from config.

## Key files
- `src/server.js` — helmet + cors middleware (modified)
- `src/config/index.js` — CORS_ORIGINS config with dev defaults (modified)
- `package.json` — added helmet, lru-cache dependencies

## Decisions
- Preserved CSP CDN allowlists (cdnjs.cloudflare.com, cdn.jsdelivr.net) from original headers
- Kept `unsafe-inline` for script-src/style-src — Phase 20 replaces with nonces
- frameguard set to 'deny' (helmet defaults to 'sameorigin')
- referrerPolicy set to 'strict-origin-when-cross-origin' (helmet defaults to 'no-referrer')
- HSTS only enabled in production (matches prior behavior)

## Self-Check: PASSED
- All security integration tests pass
- npm test: 129 pass, 0 fail
