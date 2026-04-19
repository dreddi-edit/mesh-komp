---
phase: 19
plan: "02"
title: "Centralized Error Middleware"
status: complete
started: 2026-04-16T21:55:00Z
completed: 2026-04-16T22:00:00Z
---

# Summary: 19-02 Centralized Error Middleware

## What was built
Centralized error-handling middleware at `src/middleware/error-handler.js` that maps AppError subclasses to structured `{ ok: false, error }` JSON responses. Mounted as last middleware in server.js.

## Key files
- `src/middleware/error-handler.js` — error handler middleware (created)
- `src/server.js` — wired error handler after all routes

## Decisions
- `express-async-errors` was incompatible with Express v5 (patches `lib/router/layer` which was restructured). Express v5 handles async errors natively — removed the package.
- Non-AppError gets generic "Internal server error" message to avoid leaking internals
- ValidationError responses include `fields` object when present

## Deviations
- D-01: Dropped `express-async-errors` dependency — Express v5 doesn't need it

## Self-Check: PASSED
- Error handler is last `app.use()` call before `server.listen()`
- npm test: 129 pass, 0 fail
