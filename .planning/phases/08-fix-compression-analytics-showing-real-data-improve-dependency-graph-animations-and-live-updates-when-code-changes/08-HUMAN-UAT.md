---
status: partial
phase: "08-fix-compression-analytics-showing-real-data-improve-dependency-graph-animations-and-live-updates-when-code-changes"
source: ["08-VERIFICATION.md"]
started: 2026-04-15T00:00:00Z
updated: 2026-04-15T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Compression tooltips — skip-gate path
expected: Hard-reload page with already-indexed workspace → compression data populates WITHOUT re-indexing. Hover a file → tooltip shows e.g. `42% compressed (1.2KB → 0.7KB)`.
result: [pending]

### 2. Ops view real data
expected: Switch to ops view after folder open → "Compressed" and "Ratio" columns show non-zero values.
result: [pending]

### 3. Graph stagger entrance animation
expected: Navigate to graph view → nodes fade in progressively (not all at once) over ~300–400ms.
result: [pending]

### 4. Graph live update cross-fade
expected: With graph view open, save a file → after ~1.5s the graph cross-fades (old fades out, new fades in) rather than flashing.
result: [pending]

### 5. Cache bust in network tab
expected: Browser network tab shows `app-graph.js` and `app-workspace.js` loading with `?v=20260415e` (no 304 for old version).
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
