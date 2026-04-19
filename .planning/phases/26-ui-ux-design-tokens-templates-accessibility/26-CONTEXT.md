# Phase 26: UI/UX — Design Tokens + Templates + Accessibility - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract CSS design tokens, convert 16 standalone HTML pages to nunjucks template inheritance, bundle frontend assets with esbuild, add accessibility (ARIA, keyboard nav), and implement responsive design.

</domain>

<decisions>
## Implementation Decisions

### CSS Design Tokens
- **D-01:** Define `:root` CSS custom properties for all colors, spacing, typography, shadows
- **D-02:** Replace all hardcoded values in stylesheets with token references
- **D-03:** Current CSS: 4 files (`app-workspace.css`, `mesh-docs.css`, `mesh-settings.css`, `repo-docs.css`) totaling ~1,837 lines plus extensive inline styles in `views/index.html` (2,067 lines)
- **D-04:** Inline styles in HTML views — extract to CSS files using tokens

### Nunjucks Templates
- **D-05:** Create shared base layout with head, nav, scripts, footer
- **D-06:** Convert all 16 HTML pages from standalone to nunjucks template inheritance
- **D-07:** Key pages: `app.html` (679 lines), `terminal.html` (827 lines), `index.html` (2,067 lines), `statistics.html` (714 lines), `docs.html` (409 lines), 6 settings pages
- **D-08:** Shared HTML structure (nav, head, scripts, footer) extracted into partials — eliminates duplication

### Frontend Build Pipeline
- **D-09:** Bundle frontend JS and CSS via esbuild
- **D-10:** Feature scripts lazy-loaded on demand (not all upfront)
- **D-11:** `animejs` vendored into the bundle — no longer served from `node_modules/` via Express static
- **D-12:** Content-hash cache busting must continue working through the build pipeline (currently `src/server.js:147-174`)

### Accessibility
- **D-13:** Custom UI chrome (tabs, panels, modals, context menus) gets ARIA roles and keyboard navigation
- **D-14:** Visible focus indicators on all interactive elements
- **D-15:** Terminal and code editor are already keyboard-accessible (xterm.js / Monaco) — focus on custom chrome only

### Responsive Design
- **D-16:** CSS custom property breakpoints
- **D-17:** All pages usable at 768px width minimum
- **D-18:** Mobile-first approach where practical

### Claude's Discretion
- Design token naming convention (semantic vs. primitive)
- Nunjucks template structure (single base vs. multiple layout variants)
- esbuild configuration details (output format, splitting, minification)
- Specific ARIA role assignments
- Responsive breakpoint values

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Frontend Architecture
- `.planning/codebase/CONCERNS.md` §4 (UI/UX) — No framework, no build step, 16 standalone pages, inline styles, no CSS custom properties
- `.planning/codebase/CONCERNS.md` §4 (UI/UX → Accessibility) — No ARIA attributes, custom chrome lacking keyboard support
- `.planning/codebase/CONCERNS.md` §4 (UI/UX → Asset Pipeline) — Content hashing, no lazy loading, animejs from node_modules

### CSS
- `.planning/codebase/CONCERNS.md` §4 (UI/UX → CSS) — 4 CSS files, inline styles, no tokens, no responsive framework

### File Locations
- `.planning/codebase/STRUCTURE.md` §views — All 16 HTML pages with line counts
- `.planning/codebase/STRUCTURE.md` §assets — Frontend JS/CSS files
- `.planning/codebase/STACK.md` §Frontend — animejs dependency

### Requirements
- `.planning/REQUIREMENTS.md` — UI-01, UI-02, UI-03, UI-04, UI-05, UI-06

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server.js:147-174` — Asset hash map and content-hash cache busting logic; must be preserved or adapted for esbuild output
- `src/server.js:195-196` — Static file caching (`IMMUTABLE_CACHE`, `STATIC_CACHE`)
- Phase 20 CSP nonces — templates must support nonce injection

### Established Patterns
- Views are standalone Express-served HTML files — nunjucks requires Express integration
- Asset references use hashed filenames — esbuild must produce hashed output
- Frontend JS uses IIFEs, no module system — esbuild can bundle these

### Integration Points
- `src/server.js` — HTML serving, static asset routing, hash map; all change with esbuild + nunjucks
- `views/` — 16 HTML files converted to `.njk` templates
- `assets/` — JS/CSS bundled by esbuild instead of served raw
- `package.json` — new build script, esbuild + nunjucks dependencies
- Phase 21 XSS hardening — must be complete before this phase touches frontend JS

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

*Phase: 26-ui-ux-design-tokens-templates-accessibility*
*Context gathered: 2026-04-16*
