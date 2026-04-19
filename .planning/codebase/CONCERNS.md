# Concerns

## 1. Security

### Strengths
- **Auth**: scrypt password hashing with timing-safe comparison (`src/core/auth.js:144-162`)
- **CSRF**: Origin/Referer guard on mutating requests (`src/server.js:67-88`)
- **Path traversal**: `toSafePath()` + `resolveLocalWorkspaceAbsolutePath()` validates paths stay within workspace root (`src/core/workspace-infrastructure.js:126-252`)
- **Shell injection**: Terminal spawns use strict shell allowlist + `execFile()` array args everywhere (`src/routes/terminal.routes.js:256`)
- **Security headers**: CSP, HSTS, X-Frame-Options, Permissions-Policy (`src/server.js:30-57`)
- **Encrypted storage**: AES-256-GCM for all user data in DynamoDB (`secure-db.js:50-74`)
- **Rate limiting**: Auth (15/min), API (configurable), upload (configurable) (`src/middleware/rate-limiter.js`)
- **Env sanitization**: Secrets stripped from terminal shell env (`src/routes/terminal.routes.js:31-37`)

### Areas to Harden
- **XSS surface**: Extensive `innerHTML` usage in frontend JS (~100+ instances across `assets/`). Most use `esc()` helper but pattern is fragile — a single missed escape creates a stored XSS. Chat messages go through `DOMPurify.sanitize()` (`assets/app-workspace.js:1216`), but many other areas construct HTML strings with template literals.
- **CSP allows `unsafe-inline`**: Both `script-src` and `style-src` permit `unsafe-inline` (`src/server.js:39-40`), weakening XSS protection.
- **No CORS middleware**: The `cors` package is in `package.json` but not imported in `src/server.js`. Cross-origin requests rely solely on CSRF guard + SameSite cookies.
- **Session tokens in cookie only**: No additional CSRF token — relies on SameSite=Strict + Origin check. SameSite=Strict can break legitimate cross-tab flows.
- **Vanilla validation schemas**: Hand-rolled validators in `src/schemas/index.js` lack the depth of Zod/Joi — easy to miss edge cases.
- **Demo user password**: `DEMO_USER_PASSWORD` has no default enforcement of strength — empty string disables demo login rather than using a weak password, but this is not immediately obvious.

## 2. Performance

### Current Optimizations
- Asset content-hash map built at startup (avoids fs per request) (`src/server.js:147-161`)
- View route map pre-computed at startup (`src/server.js:117-141`)
- HTTP compression with Brotli/gzip (`src/middleware/compression.js`)
- Session cache (30s TTL, 100 max) saves 2 DynamoDB calls per auth request (`src/core/auth.js:53-66`)
- Credential cache (60s TTL) saves 1 DynamoDB GSI query per chat request (`src/core/auth.js:91-104`)
- Tree-sitter worker pool pre-warmed at startup (`src/server.js:227-235`)
- PM2 cluster mode for multi-core scaling (`ecosystem.config.js:28-29`)

### Bottlenecks & Concerns
- **Synchronous `fs.readFileSync` on request path**: `sendHtmlWithHashes()` reads HTML files synchronously per request (`src/server.js:177`). Should use async read + cache.
- **Synchronous `fs.readdirSync`** at startup is fine, but `buildAssetHashMap` uses sync `readFileSync` for hashing (`src/server.js:155`).
- **Single-threaded workspace enrichment**: `enrichLocalWorkspaceRecords()` processes files serially within its queue (`src/core/workspace-ops.js:40-51`). Concurrency is per-file within a batch, but only one enrichment job runs at a time.
- **In-memory workspace state**: All workspace files stored in a RAM `Map`. Large workspaces (1000+ files) will consume significant heap. No eviction policy.
- **`workspace-ops.js:835-951` grep implementation**: Reads entire file content for each search. No indexing, no streaming. Large workspaces will be slow.
- **Rate limiter memory**: In-memory Map with threshold-based cleanup (`src/middleware/rate-limiter.js:69-73`). Under heavy traffic, store can grow to 10,000 entries before cleanup triggers.
- **No HTTP cache headers on API responses**: Only static assets get Cache-Control. API JSON responses have no caching guidance.
- **`model-providers.js` at 1,663 lines**: Contains all AI provider logic, codec, and utility functions. Module initialization time and memory footprint may be significant.

## 3. Technical Debt

### Large Files Exceeding 400-Line Guideline
| File | Lines | Issue |
|------|-------|-------|
| `mesh-core/src/compression-core.cjs` | 2,568 | Compression pipeline monolith |
| `mesh-core/src/workspace-operations.js` | 2,326 | Worker workspace operations monolith |
| `src/core/workspace-ops.js` | 1,723 | Workspace CRUD + search + git + reference resolution |
| `src/core/model-providers.js` | 1,663 | AI providers + codec + model routing |
| `src/core/workspace-context.js` | 1,146 | File caching + terminal + workspace fallback |
| `src/core/workspace-infrastructure.js` | 1,191 | Path safety + metadata + S3 + job queue |
| `src/core/assistant-runs.js` | 1,130 | Run lifecycle + proposals + batch editing |
| `src/core/index.js` | 1,200 | Wiring hub — imports + globals + re-exports |

### Global State
`src/core/index.js` assigns shared mutable state (`localAssistantWorkspace`, `workspaceMetadataStore`, `operationsStore`, etc.) to module-level variables that other core modules reference as implicit globals. This creates:
- Tight coupling between modules
- Difficult-to-test code (no dependency injection)
- Hidden dependencies — changes to globals affect all consumers silently
- Race conditions if modules mutate shared state concurrently

### Duplicated Logic
- `toSafePath()` is defined twice: `src/core/model-providers.js:40` and `src/core/workspace-infrastructure.js:126`
- `normalizeEmail()` exists in both `src/core/auth.js:122` and `secure-db.js:80`
- Path scoring logic partially duplicated between `src/core/workspace-ops.js` and `assistant-core.js`

### Empty Directories
- `src/services/` — empty, unused
- `src/utils/` — empty, unused

### Missing Abstractions
- No service layer between routes and core — routes call core functions directly
- No request/response DTOs — raw `req.body` passed through after minimal validation
- No unified error class hierarchy — plain `Error` with string messages throughout
- No middleware for async error handling — each route has its own try/catch

## 4. UI/UX Concerns

### Frontend Architecture
- **No framework**: Vanilla JS with direct DOM manipulation via `innerHTML`
- **No build step**: JS/CSS served raw from `assets/` directory
- **No bundling/minification** for client-side assets (only server-side `terser` for compression pipeline)
- **Feature files in `assets/features/`**: Each feature is a self-contained IIFE script — good isolation but no module system, no tree-shaking
- **16 HTML pages**: Each is a standalone page (not SPA), duplicating shared UI structure

### CSS
- 4 CSS files (`app-workspace.css`, `mesh-docs.css`, `mesh-settings.css`, `repo-docs.css`) totaling 1,837 lines
- Inline styles in HTML (e.g., `views/index.html` at 2,067 lines)
- No CSS custom properties for design tokens visible in the CSS files
- No responsive design framework — individual media queries

### Accessibility
- No visible ARIA attributes or accessibility patterns in the HTML/JS
- Terminal and code editor are inherently keyboard-accessible (xterm.js / CodeMirror), but custom UI chrome (tabs, panels, modals) may lack keyboard support

### Asset Pipeline
- Content hashing for cache busting (`src/server.js:147-174`) — good
- No lazy loading for feature scripts
- `animejs` served from `node_modules/` via Express static — should be bundled or vendored

## 5. Fragile Areas

### `src/core/index.js` (Wiring Hub)
Imports 7 domain modules and re-exports ~200+ functions. Any rename, add, or remove requires updating this file. A circular dependency or missing export silently breaks at runtime (no type checking).

### Global Workspace State
`localAssistantWorkspace` is mutated by `workspace-ops.js`, `workspace-infrastructure.js`, and `workspace-context.js`. Any function that modifies this object affects all others — no immutability, no change tracking.

### `workspace-ops.js:localWorkspaceSelect` (207 lines)
Single function handles upload workspace selection, manifest seeding, chunk compression, metadata store sync, and enrichment scheduling. Extremely high cyclomatic complexity.

### `model-providers.js` Provider Calls
Each provider (Anthropic, OpenAI, Gemini, Bedrock, BYOK) has its own call function with subtly different error handling. Adding a new provider requires understanding 5+ existing patterns.

### HTML View Duplication
16 standalone HTML files in `views/` — changes to shared UI elements (nav, footer, auth checks) must be replicated manually across all files.

## 6. Missing Infrastructure

- **No CI/CD pipeline** — no GitHub Actions, Jenkins, or CodeBuild config
- **No health check endpoint** — no `/health` or `/ready` for load balancer probes
- **No structured error monitoring** — logger writes to stdout/stderr but no Sentry, CloudWatch Logs agent, or error aggregation
- **No API documentation** — no OpenAPI/Swagger spec
- **No database migrations** — DynamoDB schema managed implicitly
- **No dependency scanning** — no `npm audit` or Snyk in workflow
