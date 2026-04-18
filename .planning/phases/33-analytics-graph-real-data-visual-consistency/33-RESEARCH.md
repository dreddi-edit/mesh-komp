# Phase 33 Research: Analytics & Graph — Real Data & Visual Consistency

**Researched:** 2026-04-18
**Phase:** 33-analytics-graph-real-data-visual-consistency
**Requirements:** ANLY-01, ANLY-02, GRPH-01

## Executive Summary

Phase 33 targets two distinct frontend surfaces: the Operations & Compression Analytics panel (`renderOpsPanel` + `renderOps` in `app-workspace.js`) and the D3 dependency graph (`app-graph.js`). The analytics fix is mostly subtractive (remove fake data, hide empty sections, style empty states), while the graph fix is a visual-only restyle (muted colors, softer edges, hover glow). One backend change: remove the seeded log entry in `loadOperationsStore()`.

## Surface 1: Operations & Compression Analytics

### Current Architecture

**Data flow:**
1. Server: `loadOperationsStore()` at `src/core/index.js:266` reads from JSON file, seeds fake log if empty (line 276-278)
2. Server: `snapshotOperationsPayload()` at line 313 serializes `operationsStore` for API
3. API: `GET /api/app/ops` in `app.routes.js` returns the payload
4. Frontend: `refreshOps()` at `app-workspace.js:2312` fetches and stores in `S.ops`
5. Frontend: `renderOps()` at line 1769 calls `renderOpsPanel(v)` first (ops section), then renders compression section

**`renderOpsPanel()` (lines 1685-1763):**
- Takes `container` parameter, creates a `div.fv-scr` wrapper
- Renders `<h2>` with static text "Operations & Compression Analytics"
- Renders 3 summary cards: Pending Deploys (yellow), Policies (blue), Log Entries (default)
- Conditionally renders pending deployments table if `pending.length > 0`
- Conditionally renders logs section if `logs.length > 0`
- Renders empty message if all arrays empty (lines 1756-1760)
- Appends everything to container

**`renderOps()` (lines 1769-1879+):**
- Entry point — clears `#opsView`, calls `renderOpsPanel(v)` first
- If no `S.dirName`: shows "Open a workspace folder..." plain text (lines 1775-1781)
- If `S.compressionMap` empty: shows "is open — compression data will appear..." plain text (lines 1782-1790)
- Otherwise: renders full compression analytics with summary cards, toolbar, file table

### The Fake Data Problem

1. **Seeded log entry:** `loadOperationsStore()` at `src/core/index.js:276-278` creates a fake "Operational data store initialized." log when `operationsStore.logs` is empty. This means the ops panel always shows at least 1 log entry, displaying misleading data.

2. **Default policies:** `defaultOperationPolicies()` at line 188 returns `[]` (empty array), so policies only appear if the store file had them. Line 275 re-seeds from defaults if empty — but since defaults are empty, this is a no-op.

3. **No real operations data:** In practice, `pending`, `history`, and `policies` are all empty unless the user has performed deployment actions. The only non-empty field is `logs` — which only contains the fake seed.

### Fix Strategy

**Backend (D-03):** Remove lines 276-278 in `src/core/index.js`. When `operationsStore.logs` is empty, leave it empty.

**Frontend (D-01, D-02):** In `renderOpsPanel()`:
- Check if all data arrays are empty: `pending.length + history.length + policies.length + logs.length === 0`
- If empty: skip the entire ops section (don't render summary cards, tables, or logs)
- Dynamic title: If ops section visible → "Operations & Compression Analytics"; if hidden → "Compression Analytics"

**Implementation detail:** The `<h2>` title is currently created inside `renderOpsPanel()` at line 1694. Since D-01 says to skip the entire ops section when empty, and D-02 says the title should be dynamic, the simplest approach is:
1. Move the `<h2>` creation into `renderOps()` (the parent function)
2. `renderOpsPanel()` returns a boolean indicating whether it rendered anything
3. `renderOps()` sets the title text based on that boolean

### Compression Empty States (D-10)

**Current plain text placeholders (lines 1775-1790):**
- No workspace: `<h3>Compression Analytics</h3><p>Open a workspace folder...</p>`
- Workspace open, no data: `<h3>Compression Analytics</h3><p><strong>{name}</strong> is open — compression data will appear...</p>`

**Target:** Styled empty state matching Phase 30 welcome screen pattern.

**Phase 30 welcome screen pattern:** Uses `.welcome` class (CSS at line 182 of `app-workspace.css`) — `position:absolute;inset:0;display:grid;place-items:center;background:var(--bg)` with `.welcome-in` for centered content (max-width 380px, text-align center).

**Settings empty state pattern:** Uses `.empty-state` class in `mesh-settings.css:439` — icon + strong text + paragraph.

**Best fit for compression:** Create a centered container similar to welcome pattern but inline (not absolute positioned since it's inside the scrollable ops view). Use SVG icon + message text + subtle styling. Two variants:
1. No workspace: folder icon + "Open a workspace to view compression analytics"
2. Indexing: spinner/pulse icon + "{dirName} is open — indexing in progress..."

## Surface 2: Mesh Dependency Graph

### Current Architecture

**File:** `assets/app-graph.js` (851 lines, IIFE module)

**Color system (`FILE_COLORS` at line 569):**
```javascript
const FILE_COLORS = {
    directory: '#e8a838',   // bright orange-gold
    javascript: '#f7df1e',  // bright yellow
    typescript: '#4fc3f7',  // light blue
    html: '#ff7043',        // bright coral-orange
    css: '#40c4ff',         // bright cyan
    json: '#69f0ae',        // bright green
    python: '#80cbc4',      // medium teal
    markdown: '#ce93d8',    // light purple
    _default: '#b0bec5',    // blue-grey
};
```

**Problem:** These are high-saturation brand colors from the file type's canonical palettes (JS yellow, TS blue, etc.). They clash with the app's dark teal/muted palette. The graph looks like a foreign widget.

**Edge styling (lines 643-655):**
- Stroke: `var(--tx3)` — correct, uses CSS var
- Stroke-width: `0.9` — slightly thick
- Stroke-opacity: `0.55` — visible but not overwhelming
- Arrowhead markers: `markerWidth: 5`, `markerHeight: 5`

**Hover behavior (lines 710-730):**
- On mouseover: enlarges node radius +3, sets stroke to `var(--ac)`, highlights connected edges (opacity 0.9, stroke `var(--ac)`, width 1.5), dims others (opacity 0.1)
- On mouseout: restores original radius, stroke color, edge opacity/width
- No glow effect on the hovered node itself

**SVG filter `#glow` (line 611):**
```javascript
const glowFilter = defs.append('filter').attr('id', 'glow')
    .attr('x', '-60%').attr('y', '-60%')
    .attr('width', '220%').attr('height', '220%');
glowFilter.append('feGaussianBlur')
    .attr('in', 'SourceGraphic').attr('stdDeviation', '1.8').attr('result', 'blur');
```
Already applied to file circles via `.style('filter', 'url(#glow)')` at line 690. But not applied to directories (rectangles).

**Legend (lines 792-820):** Uses `FILE_COLORS` directly for legend chips + box-shadow glow. Must update when colors change.

**CSS variables already in use:**
- `var(--bg)` — SVG background (line 596)
- `var(--tx3)` — arrowhead fill (608), edge stroke (646)
- `var(--tx2)` — label fill (701)
- `var(--f)` — label font-family (704)
- `var(--ac)` — hover highlight (714, 718)
- `var(--bg2)` — toolbar/legend/stats background
- `var(--bd)` — toolbar/legend/stats border

### Muted Color Palette Design

**App palette context (from `tokens.css` → `app-workspace.css`):**
- Dark theme BG: `var(--color-bg-primary)` — deep dark (~#0d1820)
- Accent: teal variants (`#00bcd4`, `#00b0a0`, `#0097a7`)
- Text: muted whites/grays (`var(--tx)`, `var(--tx2)`, `var(--tx3)`)

**Target palette — desaturated, cool-toned, harmonious:**
```javascript
const FILE_COLORS = {
    directory: '#7a8a9e',   // cool slate blue (was bright orange)
    javascript: '#8e9d6b',  // muted olive-green (was bright yellow)
    typescript: '#6b9daa',  // desaturated teal (was light blue)
    html: '#9e7a6b',        // warm clay/muted terracotta (was bright coral)
    css: '#6b8a9e',         // steel blue (was bright cyan)
    json: '#7a9e8a',        // sage green (was bright green)
    python: '#7a8e9e',      // dusty blue (was medium teal)
    markdown: '#9e7a9e',    // muted mauve (was light purple)
    _default: '#7a8490',    // neutral slate (was blue-grey)
};
```

These values are distinguishable from each other (different hue families) but all sit in the 40-60% saturation range with similar lightness, creating a cohesive appearance against the dark background.

### Edge Styling Changes (D-07)

**Current → Target:**
- Stroke-opacity: `0.55` → `0.3`
- Stroke-width: `0.9` → `0.6`
- Arrowhead: `markerWidth: 5, markerHeight: 5` → `markerWidth: 4, markerHeight: 4`
- Mouseout restore: opacity `0.55` → `0.3`, width `0.9` → `0.6`

**Entrance animation** at line 744: `link.style('opacity', '0.4')` — should be lowered to `0.3` to match.

### Hover Glow Implementation (D-08)

**Approach: Reuse existing `#glow` filter with enhanced parameters for hover state.**

Create a second SVG filter `#hover-glow` with larger `stdDeviation` (e.g., 4.0 vs 1.8) for a more prominent glow:

```javascript
const hoverGlow = defs.append('filter').attr('id', 'hover-glow')
    .attr('x', '-80%').attr('y', '-80%')
    .attr('width', '260%').attr('height', '260%');
hoverGlow.append('feGaussianBlur')
    .attr('in', 'SourceGraphic').attr('stdDeviation', '4').attr('result', 'blur');
const hMerge = hoverGlow.append('feMerge');
hMerge.append('feMergeNode').attr('in', 'blur');
hMerge.append('feMergeNode').attr('in', 'SourceGraphic');
```

In the `mouseover` handler, add:
```javascript
d3.select(this).select('circle, rect').style('filter', 'url(#hover-glow)');
```

In the `mouseout` handler, restore:
```javascript
d3.select(this).select('circle').style('filter', 'url(#glow)');
d3.select(this).select('rect').style('filter', null);
```

### CSS Variable Audit (D-09)

**Already using CSS vars:** SVG background, arrowhead fill, edge stroke, label fill/font, hover highlight, toolbar/legend/stats chrome.

**Hardcoded values remaining:**
- `FILE_COLORS` — JS constants, not CSS vars. Per D-09 discretion, these can remain as JS constants with new muted values since they're used programmatically in `getFileTypeColor()` and the legend.
- Node `fill-opacity: 0.18` (directory) and `0.9` (file) — acceptable as these are visual tuning, not design tokens
- Node `stroke-width: 2` (directory) and `1` (file) — acceptable
- Legend chip `box-shadow: 0 0 5px ${color}88` — uses color variable inline, acceptable

**No remediation needed** — all design-token-level properties already use CSS vars.

## Dependency Analysis

### Files Modified

| File | Surface | Changes |
|------|---------|---------|
| `src/core/index.js` | Backend | Remove fake log seed (lines 276-278) |
| `assets/app-workspace.js` | Frontend | Hide ops section when empty, dynamic title, styled empty states |
| `assets/app-graph.js` | Frontend | Muted FILE_COLORS, softer edges, hover glow filter |
| `assets/app-workspace.css` | Frontend | Empty state styles (optional — could be inline) |

### No Shared Dependencies Between Surfaces

The analytics changes and graph changes are completely independent:
- Different files (except possibly CSS)
- Different data flows (ops API vs workspace indexing)
- No shared state between `renderOps()` and `initWorkspaceGraph()`

**This means both surfaces can be planned as separate plans in Wave 1 (parallel execution).**

### Risk Assessment

- **Low risk:** All changes are frontend-only except the 3-line backend deletion
- **No API changes:** `snapshotOperationsPayload()` structure unchanged — it just returns fewer logs
- **No data migration:** The persisted operations JSON file will have the seed log removed on next `persistOperationsStore()` call
- **Graph colors:** Pure visual change, no behavioral impact
- **Backward compatible:** Existing hover behavior preserved, just enhanced with glow

## Validation Architecture

### Automated Verification

**Analytics (ANLY-01, ANLY-02):**
- `grep -c "Operational data store initialized" src/core/index.js` → 0 (seed removed)
- `grep -c "renderOpsPanel" assets/app-workspace.js` → still present (function exists)
- `grep "Compression Analytics" assets/app-workspace.js` → title text appears in dynamic conditional

**Graph (GRPH-01):**
- `grep "'#e8a838'" assets/app-graph.js` → 0 (old bright orange gone)
- `grep "'#f7df1e'" assets/app-graph.js` → 0 (old bright yellow gone)
- `grep "stroke-opacity.*0.3" assets/app-graph.js` → present (new edge opacity)
- `grep "hover-glow" assets/app-graph.js` → present (new hover filter)

### Manual Verification

1. Open app with no workspace — see "Compression Analytics" title (not "Operations & Compression Analytics"), styled empty state with icon
2. Open workspace — see compression data, no fake "Operational data store initialized" log
3. Open graph view — nodes show muted colors, edges are subtle, hovering shows glow ring
4. Check legend — colors match new muted palette

---

*Research completed: 2026-04-18*
