# Phase 21: Security — Frontend XSS Hardening - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate raw innerHTML usage across frontend JS files. Replace user-content injection points with safe DOM APIs or DOMPurify.sanitize(). Highest-risk frontend change — done after CSP is strict (Phase 20).

</domain>

<decisions>
## Implementation Decisions

### innerHTML Audit Scope
- **D-01:** ~100+ innerHTML usage sites across `assets/` JS files need auditing
- **D-02:** Classify each site: user-content injection (dangerous) vs. static template construction (lower risk)
- **D-03:** User-content sites (chat messages, file trees, terminal output, graph labels, user-provided names) → replace with safe DOM APIs (`createElement`/`textContent`) or `DOMPurify.sanitize()`
- **D-04:** Static HTML template construction → audit and tag with CSP nonces where needed (from Phase 20)

### Key Files to Audit
- **D-05:** `assets/app-workspace.js` (1,957 lines) — heaviest innerHTML usage, includes chat message rendering at line ~1216 (already uses DOMPurify)
- **D-06:** `assets/app.js` (871 lines) — main app logic with DOM construction
- **D-07:** `assets/app-graph.js` (851 lines) — D3 graph visualization with label rendering
- **D-08:** `assets/settings.js` (1,276 lines) — settings page UI construction
- **D-09:** Feature scripts in `assets/features/` — self-contained IIFEs

### Safe Replacement Strategy
- **D-10:** Use `document.createElement()` + `textContent` for plain text content
- **D-11:** Use `DOMPurify.sanitize()` for content that legitimately contains HTML (markdown renders, code highlights)
- **D-12:** Existing `esc()` helper is fragile — replace with DOMPurify or DOM APIs, don't rely on it
- **D-13:** Verify no visual regressions across all 16 pages after changes

### Claude's Discretion
- Priority order for auditing files (by risk level)
- Whether to batch changes per file or per content type
- DOMPurify configuration (allowlisted tags/attributes)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### XSS Surface
- `.planning/codebase/CONCERNS.md` §1 (Security → XSS surface) — Documents ~100+ innerHTML instances, `esc()` helper fragility, DOMPurify usage in chat
- `.planning/codebase/CONCERNS.md` §4 (UI/UX → Frontend Architecture) — No framework, vanilla JS with direct DOM manipulation

### File Locations
- `.planning/codebase/STRUCTURE.md` §assets — All frontend JS files and their line counts
- `.planning/codebase/STRUCTURE.md` §views — All 16 HTML pages that must be visually verified

### Requirements
- `.planning/REQUIREMENTS.md` — SEC-05

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `DOMPurify` already in use for chat messages (`assets/app-workspace.js:1216`)
- `esc()` helper exists across frontend JS — to be replaced, not extended

### Established Patterns
- Frontend JS uses IIFEs in `assets/features/` for feature isolation
- No module system, no build step — all scripts loaded via `<script>` tags
- Template literal HTML construction is the dominant pattern

### Integration Points
- Every `assets/*.js` file that constructs DOM via innerHTML
- `views/*.html` — 16 pages to visually verify after changes
- Chat rendering, file tree, graph labels, settings UI, terminal output

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

*Phase: 21-security-frontend-xss-hardening*
*Context gathered: 2026-04-16*
