---
phase: 43-symbol-dependency-graph
plan: "02"
subsystem: compression
tags: [tree-sitter, ast, call-sites, enrichment, workspace-operations]

requires:
  - phase: 43-01
    provides: symbols[] array on file records

provides:
  - extractCallSites() function — AST call_expression traversal
  - extractCalleeName() helper — handles identifier, member_expression, attribute, selector_expression
  - callSites[] per file record with { callerLine, calleeName } (raw, pre-resolution)
  - Two-pass enrichWorkspaceRecords() — Pass 1 builds symbolMap, Pass 2 resolves call sites
  - workspaceState.symbolMap: Map<name, [{file, lineStart, lineEnd, kind}]>
  - Resolved callSites[] with { callerLine, calleeName, resolvedFile, resolvedLine }
affects: [phase-44, phase-45]

tech-stack:
  added: []
  patterns:
    - "Two-pass enrichment: declarations pass then cross-file resolution pass"
    - "call_expression / call node traversal for JS/TS/Go/Python"
    - "Member expression method name extraction for obj.method() patterns"

key-files:
  created:
    - test/call-site-resolution.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/workspace-operations.js

key-decisions:
  - "Unresolved call sites omitted (not stored as null entries)"
  - "callSites[] capped at MAX_CALL_SITES_PER_FILE per file"
  - "workspaceState.symbolMap persists after enrichment for incremental use"
  - "Self-calls (callee in same file) resolved using same-file preference"

requirements-completed:
  - SYM-02

duration: included in phase commit
completed: 2026-04-18
---

# Phase 43 Plan 02: Call Site Resolution — Two-Pass Enrichment

**Cross-file call site extraction via AST traversal + two-pass enrichment builds workspace-wide symbolMap and resolves call chains**

## Performance

- **Duration:** part of combined phase execution
- **Completed:** 2026-04-18
- **Tasks:** 5 (W0 stub + 4 wave tasks)
- **Files modified:** 3

## Accomplishments

- `extractCallSites(tree, rawText, parserFamily)` traverses `call_expression` / `call` AST nodes
- `extractCalleeName()` handles all major grammar patterns (JS identifier, JS/TS member_expression, Python attribute, Go selector_expression)
- `enrichWorkspaceRecords()` restructured into two sequential passes via separate `mapWithConcurrency` blocks
- `workspaceState.symbolMap` built after Pass 1, persisted on workspace state
- Pass 2 resolves each file's raw call sites to `{ callerLine, calleeName, resolvedFile, resolvedLine }`
- Test suite: 3 passing tests in `test/call-site-resolution.test.cjs`

## Files Created/Modified

- `mesh-core/src/compression-core.cjs` — `extractCallSites()`, `extractCalleeName()`, `callSitesRaw` from `buildBaseCapsule()`, added to module.exports
- `mesh-core/src/workspace-operations.js` — Two-pass enrichment, `workspaceState.symbolMap`, `MAX_CALL_SITES_PER_FILE` import, `symbolEdges` in `getWorkspaceGraph()`
- `test/call-site-resolution.test.cjs` — 3 tests for call site extraction and pre-enrichment state

## Decisions Made

- None beyond what CONTEXT.md specified — plan executed as specified

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Plan 43-03 can proceed: symbolMap is populated, callSites are resolved, graph extension ready

---
*Phase: 43-symbol-dependency-graph*
*Completed: 2026-04-18*
