# Requirements: Mesh v2.0 — Full-Stack Quality Sweep

**Defined:** 2026-04-16
**Core Value:** Harden the entire Mesh platform to production quality across security, code quality, testing, performance, UI/UX, and infrastructure.

## v1 Requirements

Requirements for this milestone. Each maps to roadmap phases.

### Security

- [ ] **SEC-01**: CSP policy uses per-request nonces via helmet; `unsafe-inline` removed from both `script-src` and `style-src`
- [ ] **SEC-02**: All mutating API routes require valid CSRF token via double-submit cookie pattern (csrf-csrf)
- [x] **SEC-03**: CORS middleware (cors package) is wired up with explicit origin allowlist; no wildcard in production
- [ ] **SEC-04**: All API input validation uses Zod schemas; hand-rolled `src/schemas/index.js` is replaced
- [ ] **SEC-05**: Frontend JS uses safe DOM APIs or DOMPurify instead of raw `innerHTML` for all user-content injection points (~100+ sites)

### Performance

- [ ] **PERF-01**: HTML view serving uses async file read with in-memory cache; no `fs.readFileSync` on the request path
- [x] **PERF-02**: Workspace file Map uses LRU eviction with configurable max size; no unbounded heap growth
- [x] **PERF-03**: Rate limiter store uses LRU cache with bounded max entries (5,000) instead of plain Map
- [x] **PERF-04**: Read-only API endpoints return appropriate Cache-Control and ETag headers
- [ ] **PERF-05**: Anthropic native streaming uses prompt caching (`cache_control` blocks + `anthropic-beta` header)
- [ ] **PERF-06**: Bedrock streaming uses `cache_control` array on system block
- [ ] **PERF-07**: BedrockRuntimeClient is instantiated once per process (module-level singleton), not per request
- [ ] **PERF-08**: `streamAnthropicNative` respects `storedCredentials.anthropic.maxTokens` with 4096 fallback
- [ ] **PERF-09**: Workspace enrichment runs with bounded concurrency (parallel file processing within batches)

### Code Quality

- [ ] **QUAL-01**: All core files are under 400 lines; 8 monolith files (>1,000 lines each) are decomposed into focused modules
- [ ] **QUAL-02**: `src/core/index.js` wiring hub is refactored; global mutable state is replaced with explicit dependency passing
- [ ] **QUAL-03**: Duplicated functions (`toSafePath`, `normalizeEmail`, path scoring) exist in exactly one location and are imported from there
- [ ] **QUAL-04**: Service layer exists between routes and core; routes do not call core functions directly
- [x] **QUAL-05**: Typed error class hierarchy (`AppError`, `ValidationError`, `NotFoundError`, etc.) replaces plain `Error` with string messages
- [x] **QUAL-06**: Centralized async error handling middleware catches all unhandled route errors; no per-route try/catch required
- [x] **QUAL-07**: Empty `src/services/` and `src/utils/` directories are either populated with extracted code or removed
- [ ] **QUAL-08**: `model-providers.js` (1,663 lines) is split into per-provider modules (`anthropic.js`, `openai.js`, `gemini.js`, `bedrock.js`, `byok.js`, `codec.js`)

### Testing

- [ ] **TEST-01**: Dedicated test files exist for `workspace-ops.js`, `workspace-infrastructure.js`, `workspace-context.js`, `assistant-runs.js`, `voice-agent.js`, `deployments.js` with >60% line coverage each
- [ ] **TEST-02**: GitHub Actions CI pipeline runs lint → test → coverage on every push and PR
- [ ] **TEST-03**: E2E test suite using Playwright covers login, workspace open, chat send, terminal launch, and voice page load
- [ ] **TEST-04**: Frontend smoke tests verify all 16 pages load without console errors

### UI/UX

- [ ] **UI-01**: CSS design tokens (colors, spacing, typography, shadows) defined as custom properties on `:root`; all stylesheets use tokens instead of hardcoded values
- [ ] **UI-02**: Custom UI chrome (tabs, panels, modals, context menus) has ARIA roles, keyboard navigation, and visible focus indicators
- [ ] **UI-03**: Shared HTML structure (nav, head, scripts, footer) extracted into nunjucks template layouts; 16 standalone pages converted to template inheritance
- [ ] **UI-04**: Frontend JS and CSS are bundled and minified via esbuild; feature scripts lazy-loaded on demand
- [ ] **UI-05**: Responsive design uses CSS custom property breakpoints; all pages usable at 768px width minimum
- [ ] **UI-06**: `animejs` is vendored into the asset bundle instead of served from `node_modules/`

### Infrastructure

- [ ] **INFRA-01**: GitHub Actions CI/CD pipeline with lint, test, coverage gating, and deploy trigger
- [ ] **INFRA-02**: Structured error monitoring via CloudWatch metric filters on error codes from typed error classes
- [ ] **INFRA-03**: OpenAPI/Swagger specification covering all `/api/*` routes with request/response schemas
- [ ] **INFRA-04**: `npm audit` runs in CI; build fails on high/critical severity vulnerabilities
- [ ] **INFRA-05**: DynamoDB schema documented with version tracking; migration strategy for schema changes

## v2 Requirements

Deferred to future milestone. Tracked but not in current roadmap.

### TypeScript Migration
- **TS-01**: Migrate backend from CommonJS JS to TypeScript with strict mode
- **TS-02**: Migrate frontend from vanilla JS to TypeScript

### Advanced Testing
- **ATEST-01**: Contract tests for AI provider API boundaries
- **ATEST-02**: Load testing with autocannon for performance baselines
- **ATEST-03**: Visual regression testing with screenshot comparison

### Advanced Infrastructure
- **AINF-01**: Docker containerization for dev/staging/prod parity
- **AINF-02**: Database seeding/fixtures for development
- **AINF-03**: Feature flag system for gradual rollouts

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| TypeScript migration | Scope explosion — 20k+ lines; separate multi-month effort |
| SPA framework rewrite | Working vanilla JS frontend; no user-facing benefit justifies risk |
| Microservices split | Wrong scale; monolith is correct architecture for single-digit user base |
| Kubernetes / Docker | EC2 + PM2 + ASG working; K8s adds operational overhead with no benefit |
| ORM adoption | DynamoDB + SQLite queries are simple; ORM adds unnecessary abstraction |
| Real-time collaboration | CRDT/OT is massive complexity; single-user IDE doesn't need it |
| passport.js | Existing cookie auth works; passport adds complexity for no gain |
| Sentry (self-hosted) | Operational burden; CloudWatch metric filters achieve the same goal |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SEC-01 | Phase 20 | Pending |
| SEC-02 | Phase 20 | Pending |
| SEC-03 | Phase 19 | Complete |
| SEC-04 | Phase 20 | Pending |
| SEC-05 | Phase 21 | Pending |
| PERF-01 | Phase 23 | Pending |
| PERF-02 | Phase 19 | Complete |
| PERF-03 | Phase 19 | Complete |
| PERF-04 | Phase 19 | Complete |
| PERF-05 | Phase 23 | Pending |
| PERF-06 | Phase 23 | Pending |
| PERF-07 | Phase 23 | Pending |
| PERF-08 | Phase 23 | Pending |
| PERF-09 | Phase 23 | Pending |
| QUAL-01 | Phase 24 | Pending |
| QUAL-02 | Phase 25 | Pending |
| QUAL-03 | Phase 24 | Pending |
| QUAL-04 | Phase 25 | Pending |
| QUAL-05 | Phase 19 | Complete |
| QUAL-06 | Phase 19 | Complete |
| QUAL-07 | Phase 19 | Complete |
| QUAL-08 | Phase 24 | Pending |
| TEST-01 | Phase 22 | Pending |
| TEST-02 | Phase 22 | Pending |
| TEST-03 | Phase 22 | Pending |
| TEST-04 | Phase 22 | Pending |
| UI-01 | Phase 26 | Pending |
| UI-02 | Phase 26 | Pending |
| UI-03 | Phase 26 | Pending |
| UI-04 | Phase 26 | Pending |
| UI-05 | Phase 26 | Pending |
| UI-06 | Phase 26 | Pending |
| INFRA-01 | Phase 22 | Pending |
| INFRA-02 | Phase 27 | Pending |
| INFRA-03 | Phase 27 | Pending |
| INFRA-04 | Phase 22 | Pending |
| INFRA-05 | Phase 27 | Pending |

**Coverage:**
- v1 requirements: 37 total
- Mapped to phases: 37
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-16*
*Last updated: 2026-04-16 after initial definition*
