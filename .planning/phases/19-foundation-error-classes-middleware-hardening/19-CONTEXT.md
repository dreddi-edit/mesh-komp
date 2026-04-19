# Phase 19: Foundation — Error Classes + Middleware Hardening - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Add typed error hierarchy, wire up helmet/CORS/express-async-errors, replace unbounded Maps with LRU caches, add HTTP cache headers, and clean up empty directories. Zero-risk additive changes that everything else builds on.

</domain>

<decisions>
## Implementation Decisions

### Error Class Hierarchy
- **D-01:** Create `src/errors/` directory with base `AppError` class and subclasses: `ValidationError`, `NotFoundError`, `AuthError`, `ConflictError`
- **D-02:** Base class fields: `code` (string, e.g. `'USER_NOT_FOUND'`), `statusCode` (number), `message` (string), `cause` (optional Error). Extends `Error`.
- **D-03:** Current pattern is plain `throw new Error('...')` throughout core (~30 sites in `workspace-context.js` alone) — new error classes adopted incrementally, not a full rewrite
- **D-04:** Error codes must be machine-readable strings for Phase 27 CloudWatch metric filters

### Centralized Error Middleware
- **D-05:** Require `express-async-errors` in `src/server.js` to eliminate per-route try/catch
- **D-06:** Centralized error middleware returns existing `{ ok: false, error: '...' }` envelope format for backward compatibility — do NOT change the response format
- **D-07:** Middleware logs errors via `src/logger.js` with full context: `{ requestId, statusCode, code, stack }`
- **D-08:** Map `AppError` subclasses to status codes automatically; unknown errors → 500

### Helmet + CORS
- **D-09:** Replace hand-rolled security headers in `src/server.js:31-57` with `helmet` package
- **D-10:** CSP nonces NOT enforced in this phase — keep `unsafe-inline` for now (Phase 20 adds nonces)
- **D-11:** Wire `cors` package with explicit origin allowlist from `src/config/index.js`; wildcard `*` only in development
- **D-12:** `cors` package already in `package.json` but not imported in `src/server.js` — just wire it up

### LRU Cache Replacements
- **D-13:** Rate limiter store (`src/middleware/rate-limiter.js:45`) — replace `new Map()` with `lru-cache` max 5,000 entries
- **D-14:** Workspace file Map (`src/core/index.js:312`) — replace with `lru-cache`, configurable max size via config
- **D-15:** `sessionCache` in `src/core/auth.js:56` — already has TTL logic but uses plain Map; convert to `lru-cache` max 1,000
- **D-16:** `meshCodecSessionState` in `src/core/model-providers.js:133` — convert to `lru-cache`
- **D-17:** `assistantRuns`, `assistantTerminalSessions`, `workspaceSelectJobs`, `workspaceSelectChains` in `src/core/index.js:333-337` — convert to `lru-cache` with reasonable maxSize
- **D-18:** `inferFilesCache` in `src/core/workspace-ops.js:1591` — convert to `lru-cache`

### HTTP Cache Headers
- **D-19:** Add `Cache-Control` headers to read-only API endpoints (GET routes)
- **D-20:** SSE streaming endpoints already set `Cache-Control: no-cache` (`src/routes/assistant-chat.routes.js:364,487`) — leave those alone
- **D-21:** Static assets already have immutable/86400 caching (`src/server.js:195-196`) — no changes needed

### Empty Directories
- **D-22:** Remove `src/services/` (empty) — Phase 25 recreates it with actual service modules
- **D-23:** Remove `src/utils/` (empty) — Phase 24 may create it if needed for deduplication

### Claude's Discretion
- Exact LRU max sizes for Maps beyond the ones specified (assistantRuns, terminalSessions, etc.)
- Whether to add `lru-cache` as a new dependency or use a lightweight custom implementation
- Specific Cache-Control max-age values for read-only API endpoints
- helmet configuration details beyond CSP

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Error Handling Patterns
- `.planning/codebase/CONVENTIONS.md` — Current error handling patterns: `safeRouteError()` in `src/routes/route-utils.js`, plain `Error` throws in core, `{ ok: false, error: '...' }` response format
- `.planning/codebase/CONCERNS.md` §3 (Technical Debt → Missing Abstractions) — Documents lack of error class hierarchy, per-route try/catch pattern

### Security Headers
- `.planning/codebase/CONCERNS.md` §1 (Security → Areas to Harden) — CSP `unsafe-inline`, missing CORS middleware, session token concerns
- `.planning/codebase/ARCHITECTURE.md` §2 (Layers → Entry Point) — Middleware stack order in `src/server.js`

### Performance / Maps
- `.planning/codebase/CONCERNS.md` §2 (Performance → Bottlenecks) — Rate limiter memory, workspace file Map, no HTTP cache headers
- `.planning/codebase/STRUCTURE.md` — File locations for all Maps that need LRU conversion

### Requirements
- `.planning/REQUIREMENTS.md` — QUAL-05, QUAL-06, QUAL-07, SEC-03, PERF-02, PERF-03, PERF-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/routes/route-utils.js` (22 lines) — `safeRouteError()` helper; centralized middleware replaces the need for this in most routes
- `src/logger.js` (45 lines) — Structured JSON logger, error middleware will use this for logging
- `src/config/index.js` (196 lines) — Centralized config; CORS origins and LRU sizes will be added here
- `src/middleware/rate-limiter.js` (103 lines) — Custom rate limiter with `new Map()` store to be replaced

### Established Patterns
- CommonJS `require()`/`module.exports` throughout — no ESM
- `'use strict'` at top of every file
- `// ── Section ──` box-drawing headers
- JSDoc on all exported functions
- Response format: `{ ok: true, data }` / `{ ok: false, error: '...' }`

### Integration Points
- `src/server.js:31-57` — hand-rolled security headers to be replaced by helmet
- `src/server.js:94` — rate limiter middleware mount point
- `src/core/index.js:312,333-337` — global Maps to convert to LRU
- `src/core/auth.js:56` — sessionCache Map
- `src/core/model-providers.js:133` — meshCodecSessionState Map
- `src/core/workspace-ops.js:1591` — inferFilesCache Map

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 19-foundation-error-classes-middleware-hardening*
*Context gathered: 2026-04-16*
