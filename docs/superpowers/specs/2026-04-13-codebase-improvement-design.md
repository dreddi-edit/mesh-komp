# Codebase Improvement — Design Spec

**Date:** 2026-04-13
**Scope:** Backend, Frontend, Documentation
**Approach:** Dependency-graph ordering (Option C)
**Language:** JavaScript (TypeScript migration deferred to separate project)

---

## Overview

Systematic improvement of the mesh-komp codebase across 9 phases, ordered by dependency chain. Each phase produces a self-contained, testable result before the next begins.

**Dependency chain:** Phase 1 → 2 → 3 → 4, then 5 ∥ 6, then 7 → 8 → 9

---

## Phase 1: Config Module (Foundation)

**Problem:** 51 direct `process.env` references spread across 6 files in `src/core/`. No centralized validation beyond the minimal `startup-checks.js` (50 LOC, checks only 3 vars).

**Solution:**

- New `src/config/index.js` — single source of truth for all environment configuration
- New `src/config/schemas.js` — env var definitions with types, defaults, required flags, and descriptions
- Absorb `startup-checks.js` into the config module (fail-fast validation at import time)
- All `process.env.X` references in `src/core/` and `src/routes/` replaced with `config.X`

**Validation approach:** Lightweight schema validation (no external dependency). Each var defined as:

```js
{ key: 'MESH_COSMOS_ENDPOINT', type: 'string', required: { production: true }, default: '' }
```

**Files changed:**

- New: `src/config/index.js`, `src/config/schemas.js`
- Modified: `src/core/index.js`, `src/core/auth.js`, `src/core/model-providers.js`, `src/core/workspace-infrastructure.js`, `src/core/workspace-context.js`, `src/core/startup-checks.js` (deleted or emptied to re-export)
- Modified: `src/server.js` (import config instead of startup-checks)

**Success criteria:** Server boots with validated config. Missing required vars in production cause immediate exit with clear error message. No `process.env` references remain in `src/core/` or `src/routes/`.

---

## Phase 2: Rate Limiting

**Problem:** Only login endpoint has rate limiting. All other public API routes are unprotected.

**Solution:**

- New `src/middleware/rate-limiter.js` — in-memory sliding-window rate limiter (same proven pattern as existing login limiter in `auth.routes.js:5-8`)
- Configurable via config module: `RATE_LIMIT_API_MAX`, `RATE_LIMIT_API_WINDOW_MS`, `RATE_LIMIT_UPLOAD_MAX`
- Three tiers:
  - **Auth routes** (`/api/auth/*`): 15 req/min (existing, migrated to shared middleware)
  - **API routes** (`/api/*`): 100 req/min
  - **Upload routes** (`/api/*/upload`, `/api/*/offload`): 20 req/min
- Key: IP address (from `req.ip`)
- Response on limit: `429 Too Many Requests` with `Retry-After` header

**Files changed:**

- New: `src/middleware/rate-limiter.js`
- Modified: `src/server.js` (mount middleware)
- Modified: `src/routes/auth.routes.js` (remove inline rate limiter, use shared one)
- Modified: `src/config/schemas.js` (add rate limit env vars)

**Success criteria:** All public endpoints rate-limited. Existing login rate limit behavior preserved. `429` responses include proper headers.

---

## Phase 3: Service Layer Extraction

**Problem:** Business logic lives in route handlers (`assistant.routes.js`: 1718 LOC) and monolithic core modules (`workspace-ops.js`: 1678 LOC, `model-providers.js`: 1604 LOC). No separation between HTTP concerns and business logic.

**Solution:**

Extract business logic into dedicated service modules:

- `src/services/assistant-service.js` — chat orchestration, run management, tool execution (from `assistant.routes.js` and `assistant-runs.js`)
- `src/services/workspace-service.js` — workspace CRUD, file operations, indexing triggers (from `workspace-ops.js`)
- `src/services/model-service.js` — provider resolution, key management, model routing (from `model-providers.js`)

**Pattern:**

```
Route handler (thin controller)
  → validates input
  → calls service method
  → formats response

Service (business logic)
  → orchestrates operations
  → calls core modules for infrastructure
  → throws typed errors

Core (infrastructure)
  → database access, blob storage, external API calls
```

**Rules:**

- Services receive dependencies via constructor/factory (config, core modules)
- Services throw structured errors; routes catch and map to HTTP status codes
- No `req`/`res` objects in services — only plain data in/out
- Core modules (`src/core/`) become infrastructure/repository layer

**Files changed:**

- New: `src/services/assistant-service.js`, `src/services/workspace-service.js`, `src/services/model-service.js`
- Modified: `src/routes/assistant.routes.js`, `src/routes/app.routes.js`
- Modified: `src/core/workspace-ops.js`, `src/core/model-providers.js`, `src/core/assistant-runs.js`

**Success criteria:** Route files contain only HTTP logic (request parsing, response formatting). All business logic callable without Express context. Each service file under 500 LOC.

---

## Phase 4: File Splits

**Problem:** After service extraction, remaining large files still exceed 400 LOC limit.

**Solution:**

Split by resource/concern:

**`assistant.routes.js`** (remaining after service extraction) → split into:
- `src/routes/assistant-chat.routes.js` — `/api/chat/*` endpoints
- `src/routes/assistant-runs.routes.js` — `/api/runs/*` endpoints
- `src/routes/assistant-tools.routes.js` — `/api/tools/*` endpoints

**`workspace-infrastructure.js`** (1301 LOC) → split into:
- `src/core/workspace-indexing.js` — file indexing, tree-sitter parsing
- `src/core/workspace-blob.js` — Azure Blob operations
- `src/core/workspace-cosmos.js` — Cosmos DB operations

**`index.js`** (1182 LOC) → remains as facade, but delegates to extracted modules. Target: under 200 LOC as pure delegation layer.

**`voice-agent.js`** (851 LOC) → split into:
- `src/core/voice-agent.js` — agent loop, tool dispatch (under 400 LOC)
- `src/core/voice-tools.js` — tool definitions and handlers

**Files changed:**

- New: 7 files (3 route splits, 3 core splits, 1 voice split)
- Modified: `src/core/index.js` (reduce to facade)
- Deleted: none (original files become the split pieces)

**Success criteria:** No file in `src/` exceeds 400 LOC. All existing tests still pass. All routes still respond identically.

---

## Phase 5: Frontend Security — innerHTML Audit

**Problem:** 109 `innerHTML` usages across 26 asset files. 16 `console.log` statements in production code.

**Solution:**

**innerHTML triage** (all 109 occurrences):

1. **User-input-derived** — replace with `textContent`, `createElement`/`appendChild`, or DOM API. These are XSS vectors.
2. **Server-response-derived** — if the server already sanitizes (e.g., marked with DOMPurify), document why it's safe. If not, add sanitization.
3. **Static template strings** — replace with template helper that uses `createElement`. For complex templates, a minimal `html()` tagged template that escapes interpolations.

**Priority files:**
- `app-workspace.js` (17 occurrences) — highest risk, main workspace UI
- `content-search.js` (10) — renders search results
- `voice-chat.js` (7) — renders chat messages
- `settings.js` (9) — renders settings forms
- `repo-docs.js` (9) — renders documentation

**console.log cleanup:**
- Remove all 16 occurrences from production assets
- Add a conditional `debug()` utility in `assets/mesh-client.js` that only logs when `localStorage.debug` is set

**Files changed:**

- Modified: all 26 files in `assets/` with innerHTML
- Modified: 5 files with console.log
- New: debug utility in `assets/mesh-client.js` (extend existing file)

**Success criteria:** Zero innerHTML with unsanitized user input. Zero console.log in production assets. All UI features still render correctly.

---

## Phase 6: Tests

**Problem:** 14 test files with 114 test cases. Missing coverage for: config, services (new), rate-limiter (new), auth, voice-agent, workspace-ops, model-providers.

**Solution:**

New test files:

- `test/config.test.js` — validation happy path, missing required vars, defaults, type coercion
- `test/rate-limiter.test.js` — window behavior, tier limits, reset, concurrent requests
- `test/assistant-service.test.js` — chat flow, run lifecycle, error propagation
- `test/workspace-service.test.js` — CRUD operations, indexing triggers, edge cases
- `test/model-service.test.js` — provider resolution, fallback behavior, key validation
- `test/auth.test.js` — session creation, validation, expiry, BYOK flow
- `test/voice-agent.test.js` — tool loop, error handling, timeout behavior

**Test approach:**
- Node.js built-in test runner (already configured: `npm test` → `node --test`)
- AAA pattern, behavior-focused
- Mock at module boundaries (core modules mocked when testing services)
- Naming: `given [context], when [action], then [expected]`

**Files changed:**

- New: 7 test files
- Modified: `test/startup-checks.test.js` (update to test config module instead)

**Success criteria:** >80% coverage on service layer and config. All critical paths (auth, chat, workspace CRUD) have test coverage. All tests deterministic and isolated.

---

## Phase 7: JSDoc Coverage

**Problem:** Only 47 `@param/@returns` annotations across 13.6k LOC in `src/`.

**Solution:**

Add JSDoc to all public functions in `src/`:

- `@param` with type and description for every parameter
- `@returns` with type and description
- `@throws` for functions that throw typed errors
- `// @ts-check` header in all new and modified files

**Priority order:**
1. `src/services/*` (new files, set the standard)
2. `src/config/*` (new files)
3. `src/middleware/*` (new files)
4. `src/routes/*` (public API surface)
5. `src/core/*` (infrastructure)

**Scope:** Public functions only. Internal helpers get JSDoc only if the signature is non-obvious.

**Files changed:**

- Modified: all files in `src/`

**Success criteria:** Every exported function has complete JSDoc. `// @ts-check` produces zero errors in all new files.

---

## Phase 8: Accessibility

**Problem:** No ARIA attributes, no semantic HTML structure, no keyboard navigation system across 15 HTML views.

**Solution:**

**Semantic HTML (all views):**
- Add landmark roles: `<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`
- Proper heading hierarchy (`h1` → `h2` → `h3`, no skipping)
- `<label>` elements for all form inputs
- `<button>` instead of clickable `<div>`/`<span>`

**ARIA (interactive components):**
- Settings SPA tabs: `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`
- Modals/dialogs: `role="dialog"`, `aria-modal`, `aria-labelledby`
- File explorer tree: `role="tree"`, `role="treeitem"`, `aria-expanded`
- Chat panel: `role="log"`, `aria-live="polite"` for new messages
- Command palette: `role="combobox"`, `aria-autocomplete`

**Keyboard navigation:**
- `Tab`/`Shift+Tab` for focus order in all views
- `Escape` to close modals, command palette, dropdowns
- `Arrow keys` for tree navigation, tab switching
- Visible focus indicators (outline styles)
- Focus trap in modals
- Focus restoration when closing overlays

**Priority views:**
1. `app.html` + `app-workspace.js` (main workspace — most interactive)
2. `settings.html` (tab navigation)
3. `terminal.html` (focus management)
4. `index.html` (landing page)

**Files changed:**

- Modified: all 15 files in `views/`
- Modified: relevant files in `assets/` and `assets/features/`
- New or modified: CSS for focus indicators in `assets/app-workspace.css`

**Success criteria:** All interactive elements keyboard-accessible. No ARIA violations detectable by axe-core. Logical tab order in all views.

---

## Phase 9: Documentation & DevX

### 9a. README.md

Complete rewrite covering:
- Project description (what Mesh is, who it's for)
- Prerequisites (Node.js version, Azure account, API keys)
- Setup instructions (clone → install → configure → run in ≤5 commands)
- Environment variables reference (table with all vars, required/optional, descriptions)
- Available npm scripts
- Architecture overview (gateway/worker split, folder structure)
- Deployment instructions (link to DEPLOY.md)
- Contributing guidelines

### 9b. ADRs

New `docs/adr/` directory with initial decisions:
- `001-config-module-pattern.md` — why centralized config with schema validation
- `002-rate-limit-in-memory.md` — why in-memory over Redis (single-instance deployment)
- `003-service-layer-pattern.md` — why services between routes and core
- `004-vanilla-js-decision.md` — why no framework, when to reconsider
- `005-innerHTML-replacement-strategy.md` — DOM API approach, template helper design

ADR format: Title, Status, Context, Decision, Consequences.

### 9c. Obsidian Vault Updates

- New: `Architecture/Config Module.md` — schema, validation, usage
- New: `Architecture/Service Layer.md` — pattern, boundaries, dependency flow
- New: `Development/API Reference.md` — all endpoints, request/response formats
- New: `Development/Contributing.md` — how to add features, run tests, deploy
- Update: `Backend/Server and Routes.md` — reflect new route splits
- Update: `Backend/Core Orchestrator.md` — reflect service layer extraction

### 9d. ESLint Enhancement

Extend `.eslintrc.json`:
- Add `no-console: "error"` (enforces debug utility usage)
- Add `no-eval: "error"`, `no-implied-eval: "error"`
- Add `no-new-func: "error"`
- Add `eqeqeq: "error"`
- Add `curly: "error"`
- Add import sorting (via `eslint-plugin-import`)
- Add Prettier integration (`eslint-config-prettier`)
- Dev dependencies: `eslint-plugin-import`, `eslint-config-prettier`, `prettier`

### 9e. package.json

- Add `description`: "AI-native browser IDE with context-compression and voice coding"
- Add `author`: from git config
- Add `repository` field
- Add `engines`: `{ "node": ">=18.0.0" }`

**Files changed:**

- Rewritten: `README.md`
- New: 5 ADR files in `docs/adr/`
- New/Modified: 6 vault files in `mesh-vault/`
- Modified: `.eslintrc.json`, `package.json`
- New dev deps: `eslint-plugin-import`, `eslint-config-prettier`, `prettier`

**Success criteria:** New developer can go from `git clone` to running server in under 5 minutes using only the README. All architectural decisions documented. ESLint catches security anti-patterns.

---

## Risk Mitigation

- **Phase 3 & 4 are highest risk** — extracting and splitting code can break behavior. Mitigation: run full test suite after each extraction. Add integration tests in Phase 6 that verify HTTP-level behavior unchanged.
- **Phase 5 innerHTML changes** — can break UI rendering. Mitigation: manual smoke test of each modified view after changes.
- **Phase 8 a11y changes** — can affect layout/styling. Mitigation: visual check of each view after semantic HTML changes.

## Out of Scope

- TypeScript migration (separate future project)
- Frontend framework adoption (separate future project)
- Build system / bundler setup (separate future project)
- Database schema changes
- New features
