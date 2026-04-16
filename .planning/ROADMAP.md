# Mesh. v2.0 — Full-Stack Quality Sweep Roadmap

## Milestone: v2.0 Full-Stack Quality Sweep

**Goal:** Harden security, improve code quality, expand test coverage, add CI/CD, polish UI/UX, and ship remaining performance optimizations across the entire Mesh platform.

**Phases:** 9 (Phase 19–27, continuing from v1.0)
**Requirements:** 37 mapped

---

### Phase 19: Foundation — Error Classes + Middleware Hardening

**Goal:** Add typed error hierarchy, wire up helmet/CORS/express-async-errors, replace unbounded Maps with LRU caches, add HTTP cache headers, and clean up empty directories. Zero-risk additive changes that everything else builds on.

**Status:** planned
**Depends on:** None (first phase)
**Requirements:** QUAL-05, QUAL-06, QUAL-07, SEC-03, PERF-02, PERF-03, PERF-04
**UI hint:** no

**Success Criteria:**
1. `src/errors/` directory contains AppError, ValidationError, NotFoundError, AuthError classes extending a common base
2. `express-async-errors` is required in server.js; centralized error middleware returns structured JSON errors
3. `helmet` replaces manual security headers in server.js (CSP nonces NOT yet enforced — that's Phase 20)
4. `cors` package is imported and configured with explicit origin allowlist
5. Rate limiter uses `lru-cache` with max 5,000 entries instead of plain Map
6. Workspace file Map uses `lru-cache` with configurable maxSize
7. Read-only API endpoints return Cache-Control headers
8. Empty `src/services/` and `src/utils/` directories resolved (populated or removed)
9. npm test passes with 0 failures

---

### Phase 20: Security — Validation + CSRF + CSP

**Goal:** Replace hand-rolled validation with Zod schemas, add CSRF token protection to all mutating routes, and tighten CSP to remove unsafe-inline using per-request nonces.

**Status:** planned
**Depends on:** Phase 19 (needs error classes for Zod error mapping, helmet for CSP nonces)
**Requirements:** SEC-01, SEC-02, SEC-04
**UI hint:** no

**Success Criteria:**
1. All route schemas in `src/schemas/` use Zod; hand-rolled validators deleted
2. Zod validation errors map to existing `{ ok: false, error: "message" }` response format
3. All mutating (POST/PUT/PATCH/DELETE) routes require valid CSRF token via csrf-csrf double-submit cookie
4. CSP `script-src` and `style-src` no longer include `unsafe-inline`; nonces generated per request via helmet
5. All 16 HTML pages function correctly with strict CSP (no console CSP violation errors)
6. npm test passes with 0 failures

---

### Phase 21: Security — Frontend XSS Hardening

**Goal:** Eliminate raw innerHTML usage across frontend JS files. Replace user-content injection points with safe DOM APIs or DOMPurify.sanitize(). Highest-risk frontend change — done after CSP is strict.

**Status:** planned
**Depends on:** Phase 20 (strict CSP in place provides defense-in-depth)
**Requirements:** SEC-05
**UI hint:** yes

**Success Criteria:**
1. All user-content innerHTML injection points replaced with safe DOM APIs (createElement/textContent) or DOMPurify.sanitize()
2. Static HTML template construction via innerHTML is audited and tagged with nonces where needed
3. No visual regressions across all 16 pages (screenshot comparison before/after)
4. Browser console shows zero CSP violation errors
5. Chat messages, file trees, terminal output, and graph labels render correctly

---

### Phase 22: Testing & CI/CD

**Goal:** Set up GitHub Actions CI pipeline, add c8 code coverage, write dedicated tests for 6 untested core modules, create Playwright E2E suite, and add frontend smoke tests. Safety net for upcoming refactoring phases.

**Status:** planned
**Depends on:** Phase 19 (error classes make testing structured errors easier)
**Requirements:** TEST-01, TEST-02, TEST-03, TEST-04, INFRA-01, INFRA-04
**UI hint:** no

**Success Criteria:**
1. `.github/workflows/ci.yml` runs lint → test → coverage on push and PR
2. `npm audit` step fails CI on high/critical severity vulnerabilities
3. c8 coverage reports generated; coverage badge or summary in CI output
4. Dedicated test files exist for workspace-ops, workspace-infrastructure, workspace-context, assistant-runs, voice-agent, deployments — each with >60% line coverage
5. Playwright E2E tests cover: login flow, workspace open, chat send, terminal launch, voice page load
6. Frontend smoke tests verify all 16 pages load without JS console errors
7. CI pipeline passes green on current codebase

---

### Phase 23: Performance — Prompt Caching + Remaining Optimizations

**Goal:** Ship the Phase 18 scope (Anthropic prompt caching, Bedrock singleton, maxTokens fix) plus async HTML serving and parallel workspace enrichment. Independent of refactoring work.

**Status:** planned
**Depends on:** None (independent of Phases 19–22)
**Requirements:** PERF-01, PERF-05, PERF-06, PERF-07, PERF-08, PERF-09
**UI hint:** no

**Success Criteria:**
1. Anthropic native stream requests include `anthropic-beta: prompt-caching-2024-07-31` header and `cache_control` blocks on system messages
2. Bedrock streaming payload uses `cache_control` array on system block
3. BedrockRuntimeClient is instantiated once per process (module-level singleton)
4. `streamAnthropicNative` respects `storedCredentials.anthropic.maxTokens`, defaults to 4096
5. HTML view serving uses async file read with in-memory cache; zero `fs.readFileSync` calls on request path
6. Workspace enrichment uses bounded concurrency for parallel file processing
7. npm test passes with 0 failures

---

### Phase 24: Code Quality — Module Decomposition

**Goal:** Split 8 monolith files (>1,000 lines each) into focused modules under 400 lines. Deduplicate shared functions. Keep re-export facades for backward compatibility. Test suite from Phase 22 catches regressions.

**Status:** planned
**Depends on:** Phase 22 (need test coverage as safety net for splitting)
**Requirements:** QUAL-01, QUAL-03, QUAL-08
**UI hint:** no

**Success Criteria:**
1. `model-providers.js` (1,663 lines) split into `src/core/providers/` — anthropic.js, openai.js, gemini.js, bedrock.js, byok.js, codec.js, index.js (router)
2. `workspace-ops.js` (1,723 lines) split into `src/core/workspace/` — files.js, search.js, git.js, batch.js, index.js
3. `workspace-infrastructure.js` (1,191 lines) split into focused modules (path-safety.js, metadata.js, s3-ops.js, job-queue.js)
4. `workspace-context.js` (1,146 lines) split into focused modules
5. `assistant-runs.js` (1,130 lines) split into focused modules
6. `compression-core.cjs` (2,568 lines) split into focused modules
7. `workspace-operations.js` (2,326 lines) split into focused modules
8. `src/core/index.js` (1,200 lines) reduced to minimal re-export facade
9. `toSafePath`, `normalizeEmail`, path scoring exist in exactly one location
10. All existing tests pass; no broken require() paths

---

### Phase 25: Code Quality — Service Layer + Global State Refactor

**Goal:** Introduce service layer between routes and core. Refactor global mutable state in src/core/index.js to explicit dependency passing. Add DTOs for request/response boundaries. Highest-risk refactor — done last with full test coverage.

**Status:** planned
**Depends on:** Phase 24 (needs decomposed modules to add service layer cleanly)
**Requirements:** QUAL-02, QUAL-04
**UI hint:** no

**Success Criteria:**
1. `src/services/` contains service modules for each domain (workspace, assistant, auth, voice)
2. Routes call service functions, not core functions directly
3. `src/core/index.js` no longer assigns shared mutable state to module-level variables
4. State is passed explicitly via function parameters or a context object
5. No race conditions under concurrent requests (verified by concurrent test)
6. All existing tests pass; CI pipeline green

---

### Phase 26: UI/UX — Design Tokens + Templates + Accessibility

**Goal:** Extract CSS design tokens, convert 16 standalone HTML pages to nunjucks template inheritance, bundle frontend assets with esbuild, add accessibility (ARIA, keyboard nav), and implement responsive design.

**Status:** planned
**Depends on:** Phase 21 (frontend XSS hardening complete), Phase 24 (modules split for clean asset references)
**Requirements:** UI-01, UI-02, UI-03, UI-04, UI-05, UI-06
**UI hint:** yes

**Success Criteria:**
1. `:root` CSS custom properties define all colors, spacing, typography, shadows; no hardcoded values in stylesheets
2. All 16 HTML pages use nunjucks template inheritance with shared base layout (head, nav, scripts, footer)
3. Frontend JS and CSS bundled via esbuild; feature scripts lazy-loaded
4. `animejs` vendored into the bundle, not served from `node_modules/`
5. Custom UI chrome (tabs, panels, modals, context menus) has ARIA roles, keyboard navigation, and visible focus indicators
6. All pages usable at 768px width minimum
7. Content-hash cache busting still works through the build pipeline
8. Zero 404s in browser network tab; all pages render correctly

---

### Phase 27: Infrastructure — Docs + Monitoring + Migrations

**Goal:** Add OpenAPI documentation, structured error monitoring via CloudWatch, and DynamoDB schema documentation with migration strategy. Final polish phase.

**Status:** planned
**Depends on:** Phase 25 (needs typed errors for monitoring), Phase 20 (needs Zod schemas for OpenAPI generation)
**Requirements:** INFRA-02, INFRA-03, INFRA-05
**UI hint:** no

**Success Criteria:**
1. OpenAPI/Swagger specification covers all `/api/*` routes with request/response schemas
2. CloudWatch metric filters configured for error codes from typed error class hierarchy
3. DynamoDB schema fully documented (all tables, keys, GSIs, attributes)
4. Migration strategy documented: how to add/modify DynamoDB attributes and tables safely
5. Version tracking for schema changes (attribute in a config table or similar)

---

## Phase Dependency Graph

```
Phase 19 (Foundation)
    ├──► Phase 20 (Security: Validation + CSRF + CSP)
    │       └──► Phase 21 (Security: Frontend XSS)
    │               └──► Phase 26 (UI/UX)
    ├──► Phase 22 (Testing & CI/CD)
    │       └──► Phase 24 (Code Quality: Module Splits)
    │               └──► Phase 25 (Code Quality: Service Layer)
    │                       └──► Phase 27 (Infrastructure: Docs + Monitoring)
    └──► Phase 23 (Performance: Prompt Caching) [independent]
```

**Parallel execution opportunities:**
- Phase 22 + Phase 20 can run in parallel (different domains)
- Phase 23 can run anytime (fully independent)
- Phase 26 + Phase 25 can run in parallel (frontend vs. backend)

---

## Requirement Coverage

| Requirement | Phase | Category |
|-------------|-------|----------|
| SEC-01 | Phase 20 | Security |
| SEC-02 | Phase 20 | Security |
| SEC-03 | Phase 19 | Security |
| SEC-04 | Phase 20 | Security |
| SEC-05 | Phase 21 | Security |
| PERF-01 | Phase 23 | Performance |
| PERF-02 | Phase 19 | Performance |
| PERF-03 | Phase 19 | Performance |
| PERF-04 | Phase 19 | Performance |
| PERF-05 | Phase 23 | Performance |
| PERF-06 | Phase 23 | Performance |
| PERF-07 | Phase 23 | Performance |
| PERF-08 | Phase 23 | Performance |
| PERF-09 | Phase 23 | Performance |
| QUAL-01 | Phase 24 | Code Quality |
| QUAL-02 | Phase 25 | Code Quality |
| QUAL-03 | Phase 24 | Code Quality |
| QUAL-04 | Phase 25 | Code Quality |
| QUAL-05 | Phase 19 | Code Quality |
| QUAL-06 | Phase 19 | Code Quality |
| QUAL-07 | Phase 19 | Code Quality |
| QUAL-08 | Phase 24 | Code Quality |
| TEST-01 | Phase 22 | Testing |
| TEST-02 | Phase 22 | Testing |
| TEST-03 | Phase 22 | Testing |
| TEST-04 | Phase 22 | Testing |
| UI-01 | Phase 26 | UI/UX |
| UI-02 | Phase 26 | UI/UX |
| UI-03 | Phase 26 | UI/UX |
| UI-04 | Phase 26 | UI/UX |
| UI-05 | Phase 26 | UI/UX |
| UI-06 | Phase 26 | UI/UX |
| INFRA-01 | Phase 22 | Infrastructure |
| INFRA-02 | Phase 27 | Infrastructure |
| INFRA-03 | Phase 27 | Infrastructure |
| INFRA-04 | Phase 22 | Infrastructure |
| INFRA-05 | Phase 27 | Infrastructure |

**Coverage:** 37/37 requirements mapped ✓

---

**Milestone Success Criteria:**
- All 37 requirements verified complete
- npm test passes with >60% coverage on all core modules
- CI/CD pipeline green and enforcing quality gates
- All 16 pages functional with strict CSP, no innerHTML XSS, ARIA accessibility
- All core files under 400 lines with clean module boundaries
- OpenAPI docs, error monitoring, and schema documentation in place
