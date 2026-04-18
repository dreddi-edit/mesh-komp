# Architecture Research

**Domain:** Node.js/Express production hardening & quality sweep
**Researched:** 2026-04-16
**Confidence:** HIGH

## Current Architecture (Before Sweep)

```
Browser (16 standalone HTML pages, vanilla JS)
   │
   ├── HTTP ──► Express (src/server.js — manual security headers)
   │              ├── Static assets (views/, assets/ — no build step)
   │              ├── Routes (8 files) ──► Core (10 files, global state)
   │              │     └── No service layer, no DTOs, no error hierarchy
   │              └── Middleware (compression, rate-limit, hand-rolled validation)
   │
   ├── WS ───► Terminal (node-pty)
   └── WS ───► Voice (Transcribe → Claude → Polly)
```

## Target Architecture (After Sweep)

```
Browser (nunjucks templates with shared layouts, bundled JS/CSS)
   │
   ├── HTTP ──► Express (src/server.js)
   │              ├── Middleware Stack (ordered):
   │              │     1. Request ID
   │              │     2. helmet (CSP nonces, security headers)
   │              │     3. cors (explicit allowlist)
   │              │     4. csrf-csrf (double-submit tokens)
   │              │     5. JSON body parser
   │              │     6. Rate limiter (lru-cache backed)
   │              │     7. Compression (brotli/gzip)
   │              │     8. Zod validation middleware
   │              │
   │              ├── Static assets (bundled via esbuild, cache-busted)
   │              ├── Routes ──► Services ──► Core (decomposed modules)
   │              │     └── Typed errors + centralized error handler
   │              └── Error middleware (catches all async errors)
   │
   ├── WS ───► Terminal (unchanged)
   └── WS ───► Voice (unchanged)
```

## Safe Refactoring Order

### Tier 1: Foundation (No breaking changes, additive only)

These can all run in parallel — they don't touch each other:

| Change | Risk | Files Touched | Reason First |
|--------|------|---------------|--------------|
| Wire up `cors` | LOW | `src/server.js` | Already installed; 3-line change |
| Wire up `helmet` | LOW | `src/server.js` | Replaces manual headers; additive |
| Add `express-async-errors` | LOW | `src/server.js` | One require(); no route changes |
| Add typed error classes | LOW | New `src/errors/` dir | Additive; nothing uses them yet |
| Add `lru-cache` for rate limiter | LOW | `src/middleware/rate-limiter.js` | Drop-in replacement for Map |
| Add HTTP cache headers | LOW | `src/middleware/` | New middleware, no existing changes |
| Clean up empty dirs | LOW | `src/services/`, `src/utils/` | Remove or populate |
| Demo user password enforcement | LOW | `src/core/auth.js` | Single validation check |

### Tier 2: Security Hardening (Some breaking changes, test after each)

Must be serial within this tier:

| Change | Risk | Depends On | Reason |
|--------|------|------------|--------|
| Replace validation with Zod | MEDIUM | Tier 1 error classes | Every route using schemas/index.js changes |
| Add CSRF tokens | MEDIUM | Zod validation | Frontend must send token; all mutating routes affected |
| Tighten CSP (remove unsafe-inline) | MEDIUM | CSRF tokens | Inline scripts must move to external files or use nonces |
| innerHTML → safe DOM APIs | HIGH | CSP nonces | ~100+ call sites across assets/*.js; risk of visual regression |

### Tier 3: Code Quality (Large scope, test-gated)

Should be serial — each change is large:

| Change | Risk | Depends On | Reason |
|--------|------|------------|--------|
| Centralized error middleware | LOW | Tier 2 Zod + error classes | All routes benefit; no route changes needed (express-async-errors catches) |
| Deduplicate shared functions | LOW | None | toSafePath, normalizeEmail, path scoring → shared utils |
| Split model-providers.js | MEDIUM | Dedup | 1,663 lines → per-provider modules |
| Split workspace-ops.js | MEDIUM | Dedup | 1,723 lines → focused modules |
| Split remaining large files | MEDIUM | Previous splits | 6 more files over 1,000 lines |
| Refactor global state | HIGH | All splits done | Replace src/core/index.js wiring hub with DI |
| Introduce service layer | HIGH | Global state refactor | New layer between routes and core |

### Tier 4: Testing & CI (Can start in parallel with Tier 2)

| Change | Risk | Depends On | Reason |
|--------|------|------------|--------|
| GitHub Actions CI pipeline | LOW | None | lint → test → coverage |
| npm audit in CI | LOW | CI pipeline | Add step to workflow |
| Coverage with c8 | LOW | CI pipeline | Add --coverage flag |
| Tests for untested core modules | MEDIUM | None (but easier after splits) | 6 modules need dedicated test files |
| E2E tests with Playwright | MEDIUM | CI pipeline | Replace unused Puppeteer |

### Tier 5: UI/UX Polish (Can start in parallel with Tier 3)

| Change | Risk | Depends On | Reason |
|--------|------|------------|--------|
| CSS custom properties | LOW | None | Additive; extract existing values to :root vars |
| nunjucks template engine | MEDIUM | None | Replace 16 standalone HTML files with shared layouts |
| esbuild pipeline | MEDIUM | nunjucks | Bundle JS/CSS; add lazy loading |
| Vendor animejs | LOW | esbuild | Move from node_modules to bundled |
| Accessibility pass | MEDIUM | CSS custom properties (for focus styles) | ARIA, keyboard nav, focus management |
| Responsive framework | MEDIUM | CSS custom properties | Media queries using token values |

### Tier 6: Performance & Docs (Final)

| Change | Risk | Depends On | Reason |
|--------|------|------------|--------|
| Phase 18 (prompt caching) | LOW | None | Independent of all other work |
| Async HTML serving | LOW | nunjucks (if adopted) | Replace readFileSync with async read + cache |
| Workspace Map eviction | LOW | lru-cache (Tier 1) | Bounded workspace state |
| Parallelize workspace enrichment | MEDIUM | Module splits | Easier after workspace-ops.js is decomposed |
| OpenAPI documentation | LOW | Zod schemas | Generate from Zod schemas |
| Structured error monitoring | LOW | Error classes + CI | CloudWatch metric filters on error codes |
| Database migration strategy | LOW | None | Document DynamoDB schema; add version tracking |

## Integration Points

### New Middleware Chain

```
req → requestId → helmet(nonce) → cors → csrf → bodyParser → rateLimiter(lru) → compression → zodValidation → route → errorHandler → res
```

### Module Decomposition Map

```
src/core/model-providers.js (1,663 lines) →
├── src/core/providers/anthropic.js
├── src/core/providers/openai.js
├── src/core/providers/gemini.js
├── src/core/providers/bedrock.js
├── src/core/providers/byok.js
├── src/core/providers/codec.js
└── src/core/providers/index.js (router)

src/core/workspace-ops.js (1,723 lines) →
├── src/core/workspace/files.js (CRUD)
├── src/core/workspace/search.js (grep, find)
├── src/core/workspace/git.js (git operations)
├── src/core/workspace/batch.js (batch editing)
└── src/core/workspace/index.js (re-exports)
```

### Risk Assessment Summary

| Area | Risk Level | Mitigation |
|------|------------|------------|
| Security middleware | LOW | Additive; test each independently |
| Zod migration | MEDIUM | Replace one schema at a time; keep old as fallback |
| innerHTML elimination | HIGH | ~100+ sites; automated search + manual review; visual regression testing |
| Module splits | MEDIUM | Move functions, update imports, run tests after each file |
| Global state refactor | HIGH | Last step; requires all splits done; extensive test coverage first |
| Template engine | MEDIUM | Convert one page at a time; keep old pages as fallback |
| CI/CD | LOW | Additive; doesn't change existing code |

## Sources

- Codebase audit: `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`
- Express 5 middleware ordering best practices
- Node.js application structure patterns

---
*Architecture research for: Node.js/Express production hardening*
*Researched: 2026-04-16*
