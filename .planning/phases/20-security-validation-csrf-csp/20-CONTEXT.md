# Phase 20: Security — Validation + CSRF + CSP - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace hand-rolled validation with Zod schemas, add CSRF token protection to all mutating routes, and tighten CSP to remove unsafe-inline using per-request nonces. Depends on Phase 19 error classes for Zod error mapping and helmet for CSP nonces.

</domain>

<decisions>
## Implementation Decisions

### Zod Validation
- **D-01:** Replace hand-rolled validators in `src/schemas/index.js` (68 lines) with Zod schemas
- **D-02:** Create per-domain schema files under `src/schemas/` (auth.js, workspace.js, chat.js, git.js, etc.)
- **D-03:** Zod validation errors map to Phase 19's `ValidationError` class, which returns the existing `{ ok: false, error: '...' }` format
- **D-04:** Update `src/middleware/validate.js` (34 lines) to use Zod's `.safeParse()` and return field-level error details
- **D-05:** All route handlers that read `req.body`, `req.params`, or `req.query` must go through Zod validation

### CSRF Protection
- **D-06:** Use `csrf-csrf` package (double-submit cookie pattern)
- **D-07:** All mutating routes (POST/PUT/PATCH/DELETE) require valid CSRF token
- **D-08:** Current CSRF is Origin/Referer check only (`src/server.js:59-88`) — upgrade to token-based
- **D-09:** Frontend pages must include CSRF token in requests — update `assets/mesh-client.js` (75 lines) and any direct `fetch()` calls

### CSP Nonce Enforcement
- **D-10:** Use helmet's CSP nonce generation (per-request `res.locals.nonce`)
- **D-11:** Remove `unsafe-inline` from both `script-src` and `style-src`
- **D-12:** All 16 HTML pages in `views/` must use nonce attributes on inline `<script>` and `<style>` tags
- **D-13:** Inline styles in `views/index.html` (2,067 lines with heavy inline CSS) need special attention — either extract to CSS files or add nonces

### Claude's Discretion
- Zod schema granularity (strict vs. loose parsing)
- CSRF token header name and cookie configuration
- How to inject nonces into HTML pages (template variable vs. middleware replacement)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Validation
- `.planning/codebase/CONVENTIONS.md` §Validation — Current hand-rolled schema pattern in `src/schemas/index.js` and `src/middleware/validate.js`
- `.planning/codebase/CONCERNS.md` §1 (Security → Vanilla validation schemas) — Documents weakness of hand-rolled validators

### CSRF
- `.planning/codebase/CONCERNS.md` §1 (Security → Session tokens) — Current Origin/Referer CSRF guard, SameSite cookie limitations

### CSP
- `.planning/codebase/CONCERNS.md` §1 (Security → CSP allows unsafe-inline) — `src/server.js:39-40`
- `.planning/codebase/CONCERNS.md` §4 (UI/UX → Frontend Architecture) — 16 standalone HTML pages, no build step, inline styles

### Files to Modify
- `.planning/codebase/STRUCTURE.md` — Full file layout showing all 16 HTML views, all route files, schema location

### Requirements
- `.planning/REQUIREMENTS.md` — SEC-01, SEC-02, SEC-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/middleware/validate.js` (34 lines) — Existing validation middleware; refactor to use Zod
- `src/schemas/index.js` (68 lines) — Current hand-rolled schemas to be replaced
- `assets/mesh-client.js` (75 lines) — API client; needs CSRF token injection

### Established Patterns
- All API responses use `{ ok: true/false }` envelope
- Routes use `requireAuth` middleware for session checks
- Views are standalone HTML files served by Express

### Integration Points
- `src/server.js:59-88` — Current CSRF Origin/Referer check to be replaced
- `src/server.js` helmet config from Phase 19 — CSP nonces added here
- All route files in `src/routes/` — validation middleware applied to each
- All 16 HTML files in `views/` — nonce attributes needed
- `assets/` JS files that make `fetch()` calls — CSRF token header needed

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

*Phase: 20-security-validation-csrf-csp*
*Context gathered: 2026-04-16*
