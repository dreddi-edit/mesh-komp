---
phase: 43-symbol-dependency-graph
plan: "03"
subsystem: compression
tags: [symbol-chain, incremental-update, graph, workspace-operations, files]

requires:
  - phase: 43-02
    provides: callSites[] resolved with resolvedFile/resolvedLine, workspaceState.symbolMap

provides:
  - formatSymbolChain() — AI-readable call chain strings "file:L24 → callee() in file:L58"
  - getWorkspaceGraph() symbolEdges[] via includeSymbolEdges option
  - Incremental symbolMap update on single-file save in localWorkspaceSave()
affects: [phase-44, phase-45]

tech-stack:
  added: []
  patterns:
    - "formatSymbolChain produces AI-injectable chain strings capped at 20 entries"
    - "localWorkspaceSave updates symbolMap incrementally — stale entries removed, new added"
    - "instanceof Map guard prevents no-op errors before enrichment runs"

key-files:
  created:
    - test/symbol-context-format.test.cjs
    - test/symbol-incremental.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/workspace-operations.js
    - src/core/workspace/files.js

key-decisions:
  - "formatSymbolChain capped at 20 chain entries to control output size"
  - "Incremental update guards with instanceof Map — safe if enrichment hasn't run"
  - "symbolEdges only returned when includeSymbolEdges: true (opt-in)"

requirements-completed:
  - SYM-03
  - SYM-04

duration: included in phase commit
completed: 2026-04-18
---

# Phase 43 Plan 03: Incremental Update, Graph Extension, and AI Context Format

**`formatSymbolChain()` utility for AI context injection, `getWorkspaceGraph()` symbol edges, and incremental symbolMap update on file save**

## Performance

- **Duration:** part of combined phase execution
- **Completed:** 2026-04-18
- **Tasks:** 5 (W0 stubs + 4 wave tasks)
- **Files modified:** 4

## Accomplishments

- `formatSymbolChain(startFile, callSites, symbolMap, maxHops)` produces readable chain strings for AI context
- Format: `"src/app.js:L24 → login() in src/auth.js:L58"`, capped at 20 entries
- `getWorkspaceGraph()` extended with `symbolEdges[]` (enabled via `{ includeSymbolEdges: true }`)
- `localWorkspaceSave()` in `src/core/workspace/files.js` updates `symbolMap` incrementally
- Incremental update: removes stale entries, adds new symbols, re-resolves callSites for saved file
- Test suites: 2 tests in `test/symbol-context-format.test.cjs`, 1 test in `test/symbol-incremental.test.cjs`

## Files Created/Modified

- `mesh-core/src/compression-core.cjs` — `formatSymbolChain()` added and exported
- `mesh-core/src/workspace-operations.js` — `symbolEdges[]` in `getWorkspaceGraph()` return
- `src/core/workspace/files.js` — Incremental symbolMap update after file save
- `test/symbol-context-format.test.cjs` — 2 format tests
- `test/symbol-incremental.test.cjs` — 1 incremental update test

## Decisions Made

- None beyond what CONTEXT.md specified — plan executed as specified

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Phase 43 complete: all 4 SYM requirements met (SYM-01..04)
- Phase 44 (Semantic Query Index) can use `symbols[]`, `callSites[]`, and `symbolMap` directly
- Phase 45 (Capsule Rendering) can use `formatSymbolChain()` for outgoing refs in capsule text

---
*Phase: 43-symbol-dependency-graph*
*Completed: 2026-04-18*
