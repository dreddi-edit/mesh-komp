# Phase 33: Analytics & Graph — Real Data & Visual Consistency — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix two distinct surfaces in the Mesh IDE:
1. **Operations & Compression Analytics panel** — hide the fake/empty ops section, remove seeded log entries, polish compression empty states, and make the view title dynamic.
2. **Mesh dependency graph** — remap node colors to muted tonal variants, soften edge styling, add hover glow, and ensure all visual properties use CSS custom properties.

This phase does NOT add new analytics features, change the compression pipeline, restructure the D3 graph layout/forces, or modify deployment/policy business logic.

</domain>

<decisions>
## Implementation Decisions

### ANLY-01: Operations Panel Data Strategy

- **D-01:** The operations summary section (`renderOpsPanel`) hides entirely when no real data exists. "Real data" means: `pending.length > 0 || history.length > 0 || policies.length > 0 || logs.length > 0`. When all are empty, skip the summary cards and logs rendering. The compression analytics section below is always visible.
- **D-02:** View title is dynamic: show "Operations & Compression Analytics" when the ops section is visible (has data), show "Compression Analytics" when ops section is hidden (no data). This is a simple conditional on the `<h2>` text in `renderOps()`.

### ANLY-02: Log Entries Cleanup

- **D-03:** Remove the seeded fake log entry in `loadOperationsStore()` at `src/core/index.js:276-278`. When `operationsStore.logs` is empty after loading, leave it empty — do not create the `"Operational data store initialized."` entry. The logs section of `renderOpsPanel` already conditionally renders on `logs.length > 0`, so removing the seed log is sufficient.
- **D-04:** No filtering logic needed — the fix is purely removing the seed. Real user-triggered logs (deployment actions, policy changes) will still appear.

### GRPH-01: Graph Color Scheme

- **D-05:** Replace hardcoded `FILE_COLORS` hex values in `app-graph.js:569` with muted tonal variants that harmonize with the dark teal app palette. Still distinguishable per file type, but desaturated and cohesive. No bright yellow, orange, or coral.
- **D-06:** Suggested palette direction (Claude has flexibility on exact values): desaturated blues, teals, muted purples, and cool grays. The goal is "integrated, not foreign" — the graph should feel like a native surface, not a widget pasted from another app.

### GRPH-01: Graph Edge Styling

- **D-07:** Reduce edge opacity from 0.55 to ~0.3 and stroke width from 0.9px to ~0.6px. Muted nodes need subtler connections. Arrowhead markers stay but shrink slightly (markerWidth/markerHeight from 5 to 4).
- **D-08:** Hover behavior keeps the existing `var(--ac)` highlight on connected edges and dimming of others. Additionally, add a subtle glow ring around the hovered node itself (using the existing `#glow` filter or a new soft shadow) to make the interaction point clearer.

### GRPH-01: Graph Panel Chrome

- **D-09:** Minimal touch-ups only — do not restructure the SVG container or panel layout. Just ensure all visual properties (background, font, text colors, edge colors) consistently use CSS custom properties. The SVG already uses `var(--bg)`, `var(--tx2)`, `var(--tx3)`, `var(--f)`, and `var(--ac)` in most places — verify no hardcoded values remain outside of `FILE_COLORS`.

### Compression Empty States

- **D-10:** Replace the plain text placeholders (lines 1776-1790 in `app-workspace.js`) with a styled empty state: centered icon + message + subtle styling. Match the welcome screen pattern established in Phase 30. Two states to style: (a) no workspace open, (b) workspace open but compression data still indexing.

### Claude's Discretion

- Exact muted tonal color values for FILE_COLORS — should be harmonious with the dark palette, distinguishable from each other, and accessible
- Exact edge opacity and stroke width tuning — ~0.3 and ~0.6px are targets, not mandates
- How to implement the hover glow — reuse existing `#glow` SVG filter or add a CSS-style approach
- Empty state icon choice — use an SVG icon that matches existing app iconography patterns
- Whether `FILE_COLORS` should use CSS custom properties or remain as JS constants with new muted values

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Analytics Frontend
- `assets/app-workspace.js` lines 1685–1763 — `renderOpsPanel()`: summary cards (deploys, policies, logs) + log entries renderer
- `assets/app-workspace.js` lines 1769–1864+ — `renderOps()`: compression analytics section with summary cards, toolbar, and file table
- `assets/app-workspace.js` line 2312 — `refreshOps()`: fetches `/api/app/ops` and stores in `S.ops`

### Analytics Backend
- `src/core/index.js` lines 112, 191–280 — `operationsStore` definition, `defaultOperationsStore()`, `loadOperationsStore()` (including the fake seed log at line 276-278), `snapshotOperationsPayload()`
- `src/routes/app.routes.js` lines 395–473 — Operations API endpoints (`/api/app/ops`, deployments, policies, logs)

### Graph Frontend
- `assets/app-graph.js` — Full D3 graph module (851 lines): `FILE_COLORS` at line 569, SVG setup at 591, force simulation at 621, node/edge rendering at 646+, hover handlers at 710+

### Config
- `src/config/index.js` — Application config (no graph/analytics specific config currently)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `var(--bg)`, `var(--bg2)`, `var(--tx2)`, `var(--tx3)`, `var(--ac)`, `var(--f)`, `var(--m)` — CSS custom properties already used in graph and analytics code
- `ops-stats`, `ops-card`, `ops-lbl`, `ops-big`, `ops-sub` — CSS classes for summary card layout (reused in both ops and compression sections)
- `#glow` SVG filter in `app-graph.js:611` — existing gaussian blur filter that could be reused for hover glow
- Phase 30 welcome screen pattern — centered icon + message pattern for empty states

### Established Patterns
- `renderOpsPanel(container)` is called inside `renderOps()` — the ops panel is always rendered first, then compression below it
- `S.compressionMap` is the live data source for compression analytics — populated by workspace indexing
- `operationsStore` is persisted via `safeWriteJsonFile` to a local JSON file — removing the seed log just means not creating it when the file is empty
- `FILE_COLORS` is a plain JS object used in `getFileTypeColor()` — can be replaced with new values without structural changes

### Integration Points
- `renderOps()` in `app-workspace.js:1769` — entry point that calls `renderOpsPanel()` then renders compression section
- `loadOperationsStore()` in `src/core/index.js:266` — called at server startup, seeds the fake log
- `getFileTypeColor()` in `app-graph.js:581` — single function that maps file type → color, used by node rendering

</code_context>

<specifics>
## Specific Ideas

- "Muted tonal variants" — not monochrome, still distinguishable per file type, but desaturated and harmonized with the dark teal palette. Think "integrated dashboard" not "rainbow scatter plot."
- "Softer edges, thinner lines" — graph should feel less like a technical diagram and more like a native visualization surface.
- "Subtle node glow on hover" — makes the interaction point clearer without being flashy.
- "Dynamic title" — the view label should match what's actually showing, not promise ops data that isn't there.
- "Styled empty state with icon" — match the welcome screen pattern from Phase 30 so empty states feel consistent across the IDE.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 33-analytics-graph-real-data-visual-consistency*
*Context gathered: 2026-04-18*
