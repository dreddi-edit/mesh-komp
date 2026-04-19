## RESEARCH COMPLETE

# Phase 8 Research: Compression Analytics + Dependency Graph

## Problem 1: Compression Analytics Showing Wrong Data

### Root Cause Analysis

**The bug was already partially fixed in the last session**, but may not be working end-to-end. Here's the full data flow:

#### Server-side record structure (compression-core.cjs:1794-1801)
```
record.rawStorage.rawBytes          — raw file bytes (confirmed field name)
record.capsuleCache.capsule.capsuleBytes  — compressed capsule size
```

#### `buildWorkspaceFileListingEntry` (src/core/index.js:651)
- **Was broken**: read from `meta?.compressionStats` (non-existent sub-object) → always 0
- **Fixed in session**: now reads from `meta.rawStorage.rawBytes` and `meta.capsuleCache.capsule.capsuleBytes`

#### Two population paths for `S.compressionMap`:

**Path A — Sync response (app-workspace.js:287-289):**
```js
// syncWorkspaceFiles() in src/core/index.js returns compressionStats array
// Built from packedEntries (files that were actually processed in that batch)
// Only contains files from THIS sync batch — not all files
syncResult.compressionStats.forEach(e => {
  if (e.rawBytes > 0) S.compressionMap.set(e.path, e);
});
```
- **Key limitation**: Only populates for files in the current sync batch. On page reload with an already-indexed workspace, the client syncs with `mode: 'background'` / `complete: false`, so many files may be skipped (skip gate: identical SHA-256).
- When files are skipped (content unchanged), `packedEntries` is empty → `compressionStats` is `[]` → `S.compressionMap` stays empty.

**Path B — `/api/app/compression` endpoint (app-workspace.js:1449):**
```js
// Reads ALL files from localAssistantWorkspace.files
// Uses buildWorkspaceFileListingEntry (now fixed)
// Called when: ops view opens OR mesh-indexing-complete fires
```
- This is the reliable fallback that reads the full server-side state.
- **After the fix to `buildWorkspaceFileListingEntry`**, this should return correct data.

#### Why tooltips still don't work

`buildTree()` in `app-workspace.js:961` calls `compressionTooltip()` at tree-build time. The tree is typically rendered right after a folder is opened — **before** `loadCompressionMap()` completes. So even if the API call succeeds, the tooltips are stamped before the data arrives.

**Fix needed**: After `loadCompressionMap()` resolves, call `renderTree()` again. The `mesh-indexing-complete` handler already does this (line 1695-1698), but the initial folder-open flow may not.

#### Explorer tooltip path matching

`compressionTooltip(path, isDir)` on line 938 uses `S.compressionMap.get(path)` for files and `e.path.startsWith(prefix)` for dirs. The `path` in the map comes from the server sync, which stores relative paths (e.g. `src/foo.js`). The tree items' `item.path` in `buildTree()` also appears to be relative. **Must verify these match exactly** — a leading slash mismatch would silently return nothing.

### Remaining issues to fix:

1. **Page reload with existing workspace**: sync batches may all be skipped → `S.compressionMap` never gets populated from sync. Need to ensure `/api/app/compression` is called after initial sync regardless.

2. **Tree render timing**: `renderTree()` must be called AFTER `loadCompressionMap()` completes on initial folder open.

3. **`loadCompressionMap` is only called when**: ops view opens OR `mesh-indexing-complete`. On fresh page reload with existing workspace, `mesh-indexing-complete` may not fire if no files changed.

4. **`buildWorkspaceFileListingEntry` fix**: Already applied in the session. Confirmed field path from `compression-core.cjs:1794`.

---

## Problem 2: Dependency Graph Animations + Live Updates

### Current Implementation (assets/app-graph.js)

**Library**: D3.js v7 (force simulation)
**File**: 571 lines, IIFE pattern
**Key function**: `window.initWorkspaceGraph(containerId)` — full rebuild on every call

#### Current behavior:
- Nodes pre-seeded by directory cluster (`seedNodeLayout`)
- Simulation runs 420 ticks synchronously (warmup) then pins all nodes (`d.fx = d.x; d.fy = d.y`)
- Result: static graph — nodes appear instantly at final positions, no animation
- Drag: unpins node, runs simulation, re-pins on drop
- Live update trigger: `mesh-indexing-initial-ready` and `mesh-indexing-complete` → calls `refreshVisibleGraph()` → full `initWorkspaceGraph()` rebuild

#### Problems:
1. **No entrance animation**: nodes/edges appear at final positions with no transition
2. **Full rebuild on every update**: expensive, jarring when the graph is visible during background indexing
3. **No incremental diff**: can't detect added/removed nodes/edges between renders

### Animation Strategy

**anime.js is already loaded** on the app page (non-deferred, loaded before other scripts). Available as `window.anime`.

#### Node entrance animation:
D3 nodes are SVG `<g>` elements. After creating them, set initial `opacity: 0` and `transform: translate(x,y) scale(0.3)`, then animate to `opacity: 1, scale(1)` using `anime.stagger()`.

```js
// After node creation:
node.style('opacity', 0);
anime({
  targets: node.nodes(),  // D3 selection.nodes() returns DOM array
  opacity: [0, 1],
  scale: [0.3, 1],
  duration: 400,
  delay: anime.stagger(8, { from: 'center' }),
  easing: 'spring(1, 80, 12, 0)'
});
```

#### Edge entrance animation:
SVG lines — animate `stroke-opacity` and `stroke-dashoffset`:
```js
link.style('opacity', 0);
anime({ targets: link.nodes(), opacity: [0, 0.6], duration: 300, delay: anime.stagger(4), easing: 'easeOutQuad' });
```

#### Live update (incremental diff):
Full rebuild is the safest approach given the current architecture. The simulation warmup takes ~0ms (synchronous), and the container is small enough. The issue is the jarring flash — solve with a cross-fade:

1. Render new graph into an off-screen `<div>` (or hidden layer)
2. Fade out old SVG (`opacity: 0, 200ms`)
3. Fade in new SVG (`opacity: 1, 300ms`)

**Alternative**: True incremental D3 update using `.join()` with enter/update/exit selections. More complex but smoother. Feasible for node changes, harder for edge changes due to force simulation restart.

**Recommendation**: Cross-fade full rebuild. Simple, reliable, looks polished.

#### Event for file-save live update:
`mesh-indexing-background-progress` fires during background re-indexing (e.g. after a file save). The graph currently only listens to `mesh-indexing-complete`. Adding a debounced refresh on `mesh-indexing-background-progress` would give near-real-time updates.

```js
let graphRefreshTimer = null;
window.addEventListener('mesh-indexing-background-progress', () => {
  clearTimeout(graphRefreshTimer);
  graphRefreshTimer = setTimeout(() => {
    if ($('#graphView')?.style.display === 'block') {
      window.initWorkspaceGraph('graphView');
    }
  }, 1500); // debounce 1.5s to batch rapid saves
});
```

---

## Architecture Summary

### Files to modify:
1. **`assets/app-workspace.js`** — fix compression map population timing + ensure `renderTree()` is called after map loads
2. **`assets/app-graph.js`** — add entrance animations, cross-fade on rebuild, debounced live update
3. **`views/app.html`** — version bump on app-workspace.js (already at `?v=20260415d`)
4. **`src/core/index.js`** — `buildWorkspaceFileListingEntry` fix already applied

### Plan structure:
- **Plan 1**: Fix compression analytics data pipeline (server + client, tooltips, ops view)
- **Plan 2**: Add dependency graph animations + live update debounce

---

## Validation Architecture

### Compression Analytics:
- Open folder → wait for indexing → check `S.compressionMap.size > 0` in browser console
- Switch to ops view → verify table shows non-zero file sizes and ratios
- Hover a file in explorer → verify tooltip shows `XX% compressed`
- Hover a folder → verify tooltip shows `XX% avg compression (N files)`

### Graph animations:
- Navigate to graph view → nodes/edges should fade/spring in over ~400ms
- Save a file in the workspace → after 1.5s, graph should cross-fade to updated version with new node/edge if applicable
- Performance: full rebuild should complete in < 100ms for < 200 nodes
