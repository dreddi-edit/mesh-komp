# Phase 33 Discussion Log

**Date:** 2026-04-18
**Phase:** 33-analytics-graph-real-data-visual-consistency

## Gray Areas Discussed

### Round 1 — Initial Gray Areas

#### 1. Operations Panel Data Strategy (ANLY-01)
**Question:** How should the ops panel behave when there's no real operations data?
**Options presented:**
- A) Hide when empty (Recommended)
- B) Show with placeholder/empty state
- C) Always show with mock data

**User selection:** A — Hide when empty
**Decision:** D-01 — Hide ops summary section entirely when `pending.length + history.length + policies.length + logs.length === 0`. Compression analytics section always visible.

#### 2. Log Entries Cleanup (ANLY-02)
**Question:** How to handle the fake seeded log entry in `loadOperationsStore()`?
**Options presented:**
- A) Remove seed log, hide section when empty (Recommended)
- B) Replace seed with informational message
- C) Keep seed but mark as system-generated

**User selection:** A — Remove seed log, hide section when empty
**Decision:** D-03, D-04 — Remove the seeded fake log at `src/core/index.js:276-278`. No filtering logic needed; the existing conditional render on `logs.length > 0` handles it.

#### 3. Graph Color Scheme (GRPH-01)
**Question:** What color direction for the dependency graph nodes?
**Options presented:**
- A) Muted tonal variants (Recommended)
- B) Monochrome with accent highlights
- C) Keep current colors but adjust saturation

**User selection:** A — Muted tonal variants
**Decision:** D-05, D-06 — Replace `FILE_COLORS` with desaturated blues, teals, muted purples, and cool grays. Still distinguishable per file type but harmonized with the dark teal palette.

#### 4. Graph Panel Chrome (GRPH-01)
**Question:** How much visual overhaul for the graph panel chrome?
**Options presented:**
- A) Full restyle to match app panels
- B) Minimal touch-ups only (Recommended)
- C) No changes, focus only on nodes/edges

**User selection:** B — Minimal touch-ups only
**Decision:** D-09 — Verify all visual properties use CSS custom properties. No structural changes to SVG container or panel layout.

### Round 2 — Additional Gray Areas

#### 5. Compression Empty States
**Question:** How should the compression section look when there's no data?
**Options presented:**
- A) Styled empty state with icon (Recommended)
- B) Simple text placeholder
- C) Hide entirely

**User selection:** A — Styled empty state with icon
**Decision:** D-10 — Replace plain text placeholders with centered icon + message matching the Phase 30 welcome screen pattern. Two states: no workspace open, workspace open but indexing.

#### 6. Graph Edge Styling
**Question:** How to adjust edge visibility to match muted node colors?
**Options presented:**
- A) Softer edges, thinner lines (Recommended)
- B) Keep current styling
- C) Dashed/dotted edges

**User selection:** A — Softer edges, thinner lines
**Decision:** D-07 — Reduce opacity from 0.55 to ~0.3, stroke width from 0.9px to ~0.6px. Arrowhead markers shrink from 5 to 4.

#### 7. Graph Tooltip/Hover Behavior
**Question:** Should hover interaction be enhanced?
**Options presented:**
- A) Add subtle node glow on hover (Recommended)
- B) Keep current highlight-only behavior
- C) Add tooltip with file details

**User selection:** A — Add subtle node glow on hover
**Decision:** D-08 — Add subtle glow ring around hovered node using existing `#glow` SVG filter or new soft shadow. Existing `var(--ac)` edge highlighting and dimming behavior stays.

#### 8. Ops View Section Title
**Question:** Should the view title be static or dynamic?
**Options presented:**
- A) Dynamic title (Recommended)
- B) Keep static title
- C) Remove title entirely

**User selection:** A — Dynamic title
**Decision:** D-02 — Show "Operations & Compression Analytics" when ops section visible, "Compression Analytics" when ops section hidden. Simple conditional on `<h2>` text.

## Deferred Ideas

None — all discussion stayed within phase scope.

---
*Discussion completed: 2026-04-18*
