# Stack Research

**Domain:** Node.js/Express production hardening & quality sweep
**Researched:** 2026-04-16
**Confidence:** HIGH

## Recommended Stack Additions

### Security

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `zod` | ^3.23 | Schema validation | Industry standard for runtime validation in Node.js; CommonJS-compatible; replaces hand-rolled validators with type-safe, composable schemas |
| `helmet` | ^8.1 | Security headers + CSP nonces | Already Express-native; generates per-request CSP nonces, replaces manual header setting in server.js |
| `cors` | ^2.8.5 | CORS middleware | Already in package.json but not imported; Express-standard CORS handling |
| `csrf-csrf` | ^3.0 | Double-submit CSRF tokens | Stateless CSRF protection compatible with cookie-based auth; lighter than csurf (deprecated) |
| `DOMPurify` | ^3.2 | Server-side HTML sanitization | Already used client-side; use `isomorphic-dompurify` for server-side sanitization of user content |

### Testing & CI

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `c8` | ^10.1 | Code coverage via V8 | Native V8 coverage — works with node:test without Jest; zero-config; outputs lcov for CI |
| `@playwright/test` | ^1.52 | E2E browser testing | Replaced Puppeteer as standard; auto-wait, multi-browser, built-in assertions; CI-friendly |
| GitHub Actions | — | CI/CD pipeline | Free for public repos; first-class Node.js support; integrates with existing git workflow |
| `npm audit` | built-in | Dependency scanning | Zero-cost; run in CI; already available via npm |

### Code Quality

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `express-async-errors` | ^3.1 | Async error catching | Monkey-patches Express to catch async errors without wrapping every route; 0 code changes to routes |
| `lru-cache` | ^11.1 | Bounded LRU cache | Replaces unbounded Maps for workspace state and rate limiter; well-tested, zero-dep |
| `http-errors` | ^2.0 | Typed HTTP error classes | Express-native error creation; works with centralized error handler |

### UI/UX & Build

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `esbuild` | ^0.25 | JS/CSS bundling | Fastest bundler; CommonJS input support; no config needed for simple cases; outputs single bundle |
| `nunjucks` | ^3.2 | HTML templating | Mozilla-maintained; Express-native; extends/includes for shared layouts; no build step required |

### Performance

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `lru-cache` | ^11.1 | Bounded caching | (see Code Quality above — dual-purpose) |

## Installation

```bash
# Security
npm install zod helmet csrf-csrf

# Code Quality
npm install express-async-errors lru-cache http-errors

# UI/Build
npm install esbuild nunjucks

# Dev dependencies
npm install -D c8 @playwright/test
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `zod` | `joi` | If team already uses joi; zod is smaller and TypeScript-first but both work in CommonJS |
| `esbuild` | `vite` / `rollup` | If you need HMR dev server or complex plugin ecosystem; esbuild is simpler for bundling-only |
| `nunjucks` | `ejs` / `handlebars` | ejs if you want pure JS templates; handlebars if you want logic-less; nunjucks has best Express integration |
| `c8` | `istanbul/nyc` | c8 is faster (native V8); nyc is more mature but slower |
| `csrf-csrf` | `csurf` | Never — csurf is deprecated and has known vulnerabilities |
| `@playwright/test` | `puppeteer` | Puppeteer only if you need Chrome-specific CDP access; Playwright is superior for E2E |
| `helmet` | manual headers | Never — helmet is maintained against evolving browser security; manual headers drift |
| `express-async-errors` | wrapper functions | Wrapper functions work but require touching every route; express-async-errors is zero-change |
| `lru-cache` | `quick-lru` | quick-lru if you need ESM-only; lru-cache has better CJS support |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `csurf` | Deprecated, known vulnerabilities | `csrf-csrf` |
| `webpack` | Massive config overhead for this use case | `esbuild` |
| `TypeScript migration` | Too large a scope for a quality sweep; requires rewriting all 20k+ lines | Keep CommonJS; add JSDoc types for IDE support |
| `Jest` | Incompatible with node:test conventions already in place | Keep `node:test` + add `c8` for coverage |
| `Sentry` (self-hosted) | Operational burden; hosted Sentry is fine | CloudWatch Logs + metric filters (already partially in place) |
| `passport.js` | Over-engineered for cookie-based auth already working | Keep existing auth.js + add CSRF layer |

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `zod@3.23` | Node 18+ | CommonJS via `require('zod')` works |
| `helmet@8.1` | Express 5.x | Verified compatible with Express 5 |
| `esbuild@0.25` | Node 18+ | Binary install, no native deps |
| `c8@10` | node:test | Uses V8 coverage natively |
| `@playwright/test@1.52` | Node 18+ | Requires `npx playwright install` for browsers |
| `lru-cache@11` | Node 18+ | Pure JS, CommonJS compatible |
| `nunjucks@3.2` | Express 5.x | `app.engine('njk', nunjucks)` registration |

## Sources

- Codebase audit: `.planning/codebase/STACK.md`, `CONCERNS.md`
- npm registry for version verification
- Express 5 compatibility notes

---
*Stack research for: Node.js/Express production hardening*
*Researched: 2026-04-16*
