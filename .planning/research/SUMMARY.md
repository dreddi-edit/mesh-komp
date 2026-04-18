# Project Research Summary

**Project:** Mesh. — AI-Native IDE
**Domain:** Node.js/Express production hardening & quality sweep
**Researched:** 2026-04-16
**Confidence:** HIGH

## Executive Summary

Mesh is a working AI-native IDE with a solid feature set (editor, terminal, voice-coding, chat, compression pipeline, AWS infrastructure) that shipped 17 phases of functionality. The codebase now needs hardening: security gaps (innerHTML XSS, weak CSP, no CSRF), low test coverage (~25%), no CI/CD, 8 monolith files over 1,000 lines, and frontend technical debt (no build step, no templates, no accessibility).

The recommended approach is a layered sweep: start with zero-risk additive changes (middleware, error classes, bounded caches), then harden security (Zod, CSRF, CSP, innerHTML), then improve code quality (module splits, service layer), and finally polish UI/UX (templates, build pipeline, accessibility). Testing and CI/CD run in parallel throughout. The critical risk is breaking the working app during refactoring — every change must be testable and reversible.

Stack additions are minimal: Zod, helmet, csrf-csrf, lru-cache, express-async-errors, http-errors, c8, Playwright, esbuild, nunjucks. No framework changes. No TypeScript migration. No architecture overhaul. Incremental hardening of the existing monolith.

## Key Findings

### Recommended Stack Additions

**Core additions:**
- `zod`: Runtime schema validation replacing hand-rolled validators
- `helmet`: Security headers + CSP nonce generation
- `csrf-csrf`: Stateless double-submit CSRF protection
- `lru-cache`: Bounded caches replacing unbounded Maps
- `express-async-errors`: Catches async errors without per-route try/catch

**Dev tooling:**
- `c8`: V8-native code coverage for node:test
- `@playwright/test`: E2E testing replacing unused Puppeteer
- GitHub Actions: CI/CD pipeline

**UI/Build:**
- `esbuild`: JS/CSS bundling (fastest, minimal config)
- `nunjucks`: HTML templating for shared layouts

### Expected Features

**Must have (table stakes):**
- Strict CSP without unsafe-inline
- CSRF token protection
- CORS middleware (already installed, just not wired)
- Centralized async error handling
- >60% test coverage on business logic
- CI/CD pipeline with dependency scanning
- Bounded in-memory caches
- HTTP cache headers on API responses

**Should have (competitive):**
- Module decomposition (<400 lines per file)
- CSS design token system
- HTML template engine for shared layouts
- Accessibility (WCAG 2.1 Level A)
- OpenAPI documentation

**Defer (anti-features for this sweep):**
- TypeScript migration (scope explosion)
- SPA rewrite (working frontend)
- Microservices split (wrong scale)
- Kubernetes/Docker (working infra)

### Architecture Approach

Incremental refactoring of the existing layered monolith. Six tiers of changes ordered by risk and dependency:
1. **Foundation** (additive, zero-risk): CORS, helmet, error classes, lru-cache
2. **Security** (serial, medium-risk): Zod, CSRF, CSP, innerHTML
3. **Code Quality** (serial, high-risk): module splits, global state, service layer
4. **Testing & CI** (parallel): GitHub Actions, coverage, E2E
5. **UI/UX** (parallel): CSS tokens, templates, build, accessibility
6. **Performance & Docs** (final): Phase 18, async serving, OpenAPI

### Critical Pitfalls

1. **CSP tightening breaks inline scripts** — Audit all 16 HTML files first; use CSP report-only mode before enforcing
2. **innerHTML replacement causes visual regressions** — Replace one file at a time with screenshot comparison
3. **Module split breaks import chains** — Keep re-export facades; grep ALL require paths before moving functions
4. **Zod migration changes error responses** — Write error transformer to preserve existing format
5. **CI fails on first run due to env vars** — Run with minimal env first to discover hidden dependencies

## Implications for Roadmap

### Phase 19: Foundation — Error Classes + Middleware Hardening
**Rationale:** Zero-risk additive changes that everything else builds on
**Delivers:** Typed errors, helmet, CORS, express-async-errors, lru-cache, HTTP cache headers, demo password enforcement
**Avoids:** Breaking anything — all additive

### Phase 20: Security — Validation + CSRF + CSP
**Rationale:** Must happen before innerHTML work; CSP nonces require helmet from Phase 19
**Delivers:** Zod validation, CSRF tokens, strict CSP with nonces
**Avoids:** Pitfall 1 (CSP breaks), Pitfall 5 (Zod behavior change)

### Phase 21: Security — Frontend XSS Hardening
**Rationale:** innerHTML elimination is highest-risk work; needs strict CSP in place first
**Delivers:** Safe DOM APIs across ~100+ innerHTML sites
**Avoids:** Pitfall 2 (visual regressions)

### Phase 22: Testing & CI/CD
**Rationale:** Need CI before large-scale refactoring; catches regressions
**Delivers:** GitHub Actions, c8 coverage, tests for 6 untested modules, npm audit, Playwright E2E
**Avoids:** Pitfall 6 (CI env failures), Pitfall 8 (tests revealing bugs)

### Phase 23: Performance — Prompt Caching + Remaining Optimizations
**Rationale:** Independent of refactoring; ships Phase 18 + async HTML + workspace eviction + enrichment parallelization
**Delivers:** 90% input token cost reduction, async serving, bounded workspace state

### Phase 24: Code Quality — Module Decomposition
**Rationale:** Split 8 monolith files; needs test coverage from Phase 22
**Delivers:** All files under 400 lines; deduplicated functions; clean module boundaries
**Avoids:** Pitfall 3 (import breaks)

### Phase 25: Code Quality — Service Layer + Global State
**Rationale:** Highest-risk refactor; requires completed splits from Phase 24
**Delivers:** Service layer, DTOs, refactored global state, centralized error middleware
**Avoids:** Pitfall 4 (race conditions)

### Phase 26: UI/UX — Design Tokens + Templates + Accessibility
**Rationale:** Frontend polish after backend is stable
**Delivers:** CSS custom properties, nunjucks templates, shared layouts, ARIA, keyboard nav, esbuild pipeline
**Avoids:** Pitfall 7 (template asset paths)

### Phase 27: Infrastructure — Docs + Monitoring + Migrations
**Rationale:** Final polish; depends on Zod schemas (OpenAPI), error classes (monitoring)
**Delivers:** OpenAPI docs, structured error monitoring, dependency scanning, database migration strategy

### Phase Ordering Rationale

- Security before refactoring: don't refactor insecure code; fix vulnerabilities first
- CI before module splits: need regression safety net for risky changes
- Module splits before service layer: can't add service layer to 1,700-line monoliths
- Frontend polish last: backend stability is prerequisite for UI changes

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 21 (innerHTML):** Need full audit of all innerHTML sites; some may be safe (static HTML)
- **Phase 24 (Module splits):** Need dependency graph analysis before splitting
- **Phase 26 (Templates):** Need to decide which pages to convert vs. keep static

Phases with standard patterns (skip research-phase):
- **Phase 19 (Foundation):** Well-documented library integration
- **Phase 22 (CI/CD):** Standard GitHub Actions patterns
- **Phase 23 (Performance):** Phase 18 already scoped in ROADMAP.md

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All libraries verified CommonJS-compatible and actively maintained |
| Features | HIGH | Based on OWASP and Node.js community standards |
| Architecture | HIGH | Refactoring order based on dependency analysis of actual codebase |
| Pitfalls | HIGH | Based on common failure modes in Express monolith refactoring |

**Overall confidence:** HIGH

### Gaps to Address

- **innerHTML audit:** Need exact count and categorization (user content vs. static HTML) before scoping Phase 21
- **Nunjucks + esbuild integration:** Need proof-of-concept to confirm content-hash cache busting survives
- **WebSocket CSRF:** csrf-csrf may not cover WebSocket upgrade; needs investigation

## Sources

### Primary (HIGH confidence)
- Codebase audit: `.planning/codebase/` (7 documents)
- npm registry (version verification)
- Express 5 documentation

### Secondary (MEDIUM confidence)
- OWASP Node.js security cheat sheet
- Node.js best practices community guidelines

---
*Research completed: 2026-04-16*
*Ready for roadmap: yes*
