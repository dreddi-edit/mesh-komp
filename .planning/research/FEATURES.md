# Feature Research

**Domain:** Node.js/Express production hardening & quality sweep
**Researched:** 2026-04-16
**Confidence:** HIGH

## Feature Landscape

### Table Stakes (Production-Quality Node.js App Must Have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Strict CSP (no unsafe-inline) | OWASP baseline; unsafe-inline negates CSP value | MEDIUM | Requires nonce generation per request; all inline scripts must use nonce or move to external files |
| CORS middleware | Any API serving browser clients needs explicit CORS | LOW | `cors` already in package.json; just needs import + config |
| Input validation with schema library | Hand-rolled validation misses edge cases | MEDIUM | Replace ~68 lines in schemas/index.js with Zod; update all routes |
| CSRF protection | Cookie-based auth without CSRF tokens is vulnerable | MEDIUM | Double-submit cookie pattern via csrf-csrf |
| Centralized async error handling | Per-route try/catch is fragile; one missed catch = unhandled rejection | LOW | express-async-errors + error middleware |
| Typed error classes | String-based errors break structured logging and HTTP status mapping | LOW | AppError hierarchy extending Error |
| >60% test coverage on business logic | Industry standard for production apps | HIGH | Currently ~25-30%; need tests for 6 untested core modules |
| CI/CD pipeline | Manual-only testing = regression risk | MEDIUM | GitHub Actions: lint → test → coverage → deploy |
| Dependency scanning | Known CVEs in deps = liability | LOW | `npm audit` in CI + fail on high severity |
| HTTP cache headers on API responses | Browsers and CDNs need caching guidance | LOW | Cache-Control/ETag on read endpoints |
| Bounded in-memory caches | Unbounded Maps = memory leak in production | LOW | lru-cache with maxSize |
| Accessibility basics | WCAG 2.1 Level A is legal requirement in many jurisdictions | HIGH | ARIA roles, keyboard nav, focus management on custom chrome |

### Differentiators (Beyond Baseline)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Anthropic prompt caching | 90% reduction in input token costs on cache hits | LOW | Phase 18 — already scoped |
| CSS design token system | Consistent theming, easier dark/light mode, maintainable styles | MEDIUM | CSS custom properties on :root |
| HTML template engine | Eliminates 16-page duplication; shared layouts/partials | MEDIUM | nunjucks with Express integration |
| OpenAPI documentation | Self-documenting API enables third-party integrations | MEDIUM | Manual spec covering all /api/* routes |
| Module decomposition (< 400 lines) | Maintainability, testability, code review velocity | HIGH | 8 files over 1,000 lines; careful splitting needed |
| Service layer + DTOs | Clean separation enables independent testing and swappable implementations | HIGH | New abstraction layer between routes and core |
| Frontend build pipeline | Bundling, minification, tree-shaking, lazy loading | MEDIUM | esbuild for JS/CSS; minimal config |
| E2E test suite | Catches integration regressions that unit tests miss | MEDIUM | Playwright replacing unused Puppeteer |

### Anti-Features (Don't Do in This Sweep)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| TypeScript migration | Type safety across 20k+ lines | Scope explosion; 6-month project on its own; breaks all existing tooling | Add JSDoc `@type` annotations for IDE support; Zod gives runtime safety |
| Full SPA rewrite | Modern frontend architecture | Working vanilla JS frontend; rewrite risk with no user-facing benefit | Template engine for shared layouts; keep vanilla JS |
| Microservices split | Scalability narrative | Single-digit user base; monolith is correct architecture; adds operational complexity | Keep monolith; improve internal modularity |
| ORM adoption | "Proper" data layer | DynamoDB + SQLite work fine; ORM adds abstraction over already-simple queries | Keep direct DynamoDB calls; improve repository pattern |
| Kubernetes / Docker | Container orchestration | EC2 + PM2 + ASG is working; K8s adds massive operational overhead | Keep current infra; improve deploy scripts |
| Real-time collaboration | Feature request | Massive complexity (CRDT/OT); not core to single-user IDE | Defer to future milestone |

## Feature Dependencies

```
[Zod Validation]
    └──enables──> [Strict CSP] (validated nonces)
                      └──enables──> [Remove unsafe-inline]

[Typed Error Classes]
    └──enables──> [Centralized Error Middleware]
                      └──enables──> [Structured Error Monitoring]

[CI/CD Pipeline]
    └──enables──> [Dependency Scanning]
    └──enables──> [Coverage Gating]
    └──enables──> [E2E Tests in CI]

[Module Decomposition]
    └──enables──> [Service Layer]
                      └──enables──> [Unit Testing Core Modules]

[HTML Template Engine]
    └──enables──> [Shared Layouts]
    └──enables──> [Frontend Build Pipeline]

[CSS Design Tokens]
    └──enables──> [Accessibility (consistent focus styles)]
```

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| CSRF protection | HIGH | MEDIUM | P1 |
| Strict CSP | HIGH | MEDIUM | P1 |
| CORS middleware | HIGH | LOW | P1 |
| Centralized error handling | HIGH | LOW | P1 |
| Typed error classes | MEDIUM | LOW | P1 |
| Zod validation | HIGH | MEDIUM | P1 |
| Bounded caches (lru-cache) | HIGH | LOW | P1 |
| CI/CD pipeline | HIGH | MEDIUM | P1 |
| Dependency scanning | HIGH | LOW | P1 |
| Test coverage (core modules) | HIGH | HIGH | P1 |
| Anthropic prompt caching | HIGH | LOW | P1 |
| HTTP cache headers | MEDIUM | LOW | P1 |
| innerHTML XSS elimination | HIGH | HIGH | P1 |
| Module decomposition | MEDIUM | HIGH | P2 |
| Service layer + DTOs | MEDIUM | HIGH | P2 |
| CSS design tokens | MEDIUM | MEDIUM | P2 |
| Accessibility | MEDIUM | HIGH | P2 |
| HTML template engine | MEDIUM | MEDIUM | P2 |
| Frontend build pipeline | LOW | MEDIUM | P2 |
| OpenAPI docs | LOW | MEDIUM | P3 |
| E2E tests | MEDIUM | MEDIUM | P2 |

## Sources

- Codebase audit: `.planning/codebase/CONCERNS.md`, `TESTING.md`
- OWASP Node.js security guidelines
- Node.js best practices (goldbergyoni/nodebestpractices)

---
*Feature research for: Node.js/Express production hardening*
*Researched: 2026-04-16*
