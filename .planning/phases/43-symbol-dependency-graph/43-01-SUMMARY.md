---
phase: 43-symbol-dependency-graph
plan: "01"
subsystem: compression
tags: [tree-sitter, ast, symbols, compression-core]

requires: []
provides:
  - symbols[] array on every workspace file record
  - callSites: [] placeholder on file records
  - MAX_CALL_SITES_PER_FILE constant (200, configurable)
  - symbolDeclarations extraction in buildBaseCapsule() and heuristic fallback
affects: [phase-44, phase-45]

tech-stack:
  added: []
  patterns:
    - "symbolDeclarations[] co-populated during walkTree AST traversal"
    - "heuristic fallback also populates symbolDeclarations via regex"

key-files:
  created:
    - test/symbol-index.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs

key-decisions:
  - "MAX_CALL_SITES_PER_FILE = 200 (configurable via MESH_CAPSULE_MAX_CALL_SITES)"
  - "symbolDeclarations built in same walkTree pass as symbolsSection — no duplicate AST work"
  - "Heuristic fallback uses regex to populate symbols for unsupported grammars"

requirements-completed:
  - SYM-01

duration: included in phase commit
completed: 2026-04-18
---

# Phase 43 Plan 01: Symbol Extraction — Data Model and Per-File symbols[]

**AST-based symbol declaration extraction added to every file record — `symbols[]` with name, kind, lineStart, lineEnd, signature fields**

## Performance

- **Duration:** part of combined phase execution
- **Completed:** 2026-04-18
- **Tasks:** 4 (W0 stub + 3 wave tasks)
- **Files modified:** 2

## Accomplishments

- `buildWorkspaceFileRecord()` returns `symbols[]` on every file record
- Each entry: `{ name, kind, lineStart, lineEnd, signature }` (1-based line numbers)
- `MAX_CALL_SITES_PER_FILE = 200` constant added alongside `MAX_SYMBOL_DISCOVERY`
- Heuristic fallback (`buildTextFallbackCapsule`) also populates `symbolDeclarations` from regex
- `callSites: []` placeholder added to all file records (populated by Plan 43-02)
- Test suite: 3 passing tests in `test/symbol-index.test.cjs`

## Files Created/Modified

- `mesh-core/src/compression-core.cjs` — Added `MAX_CALL_SITES_PER_FILE`, `symbolDeclarations[]` in `buildBaseCapsule()` and heuristic path, `symbols` and `callSites` fields in `buildWorkspaceFileRecord()` return
- `test/symbol-index.test.cjs` — 3 real assertion tests for symbol extraction

## Decisions Made

- None beyond what CONTEXT.md specified — plan executed as specified

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Plan 43-02 can proceed: `symbols[]` is populated on file records, ready for workspace-wide symbol map build

---
*Phase: 43-symbol-dependency-graph*
*Completed: 2026-04-18*
