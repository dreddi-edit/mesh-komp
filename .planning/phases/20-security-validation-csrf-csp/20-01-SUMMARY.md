---
plan: 20-01
title: Zod Validation Schemas
status: complete
completed: 2026-04-16
commit: fedeb74
---

## What Was Built

Replaced all hand-rolled validators in `src/schemas/index.js` with Zod domain schemas. Created five per-domain schema files under `src/schemas/`. Refactored the validation middleware to use `schema.safeParse()` and map errors to `ValidationError` with per-field detail. Wired Zod validation into auth (login, session revoke) and all git mutating routes.

## Key Files Created/Modified

- `src/schemas/auth.js` — loginSchema, sessionRevokeSchema
- `src/schemas/workspace.js` — 11 workspace operation schemas
- `src/schemas/chat.js` — chat, codec, inline-complete schemas
- `src/schemas/git.js` — 7 git operation schemas
- `src/schemas/assistant.js` — assistantRunSchema, terminal schemas
- `src/schemas/index.js` — barrel re-export (replaces hand-rolled validators)
- `src/middleware/validate.js` — rewritten to use Zod safeParse + ValidationError
- `src/routes/auth.routes.js` — validate(loginSchema), validate(sessionRevokeSchema)
- `src/routes/assistant-git.routes.js` — validate() on all 7 mutating git routes

## Self-Check: PASSED

- `grep "z.object" src/schemas/auth.js` ✓
- `grep "safeParse" src/middleware/validate.js` ✓
- `grep "ValidationError" src/middleware/validate.js` ✓
- `grep "validate(" src/routes/auth.routes.js` ✓
- `grep "validate(" src/routes/assistant-git.routes.js` ✓
- `npm test`: 23 failures (all pre-existing, no regressions)
