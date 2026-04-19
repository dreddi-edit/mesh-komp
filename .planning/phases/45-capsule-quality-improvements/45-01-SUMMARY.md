---
phase: 45-capsule-quality-improvements
plan: "01"
subsystem: compression
tags: [capsule, exports, isExported, tree-sitter, worker]

requires:
  - phase: 43
    provides: symbols[], symbolDeclarations, callSitesRaw in buildCodeCapsule

provides:
  - isExported flag on every symbolDeclarations entry (both AST and heuristic paths)
  - exportsSection (P0) in buildCodeCapsule — lists exported symbols with signatures
  - callsSection (P1) in buildCodeCapsule — lists outgoing call sites
  - Both sections mirrored in tree-sitter-worker.cjs (parallel worker path)
  - exportsSection in buildTextFallbackCapsule (heuristic path via sig text scan)
affects: [phase-45-02, phase-45-03]

tech-stack:
  added: []
  patterns:
    - "isExported: EXPORT_PARENT_TYPES.has(node.parent?.type) || /^export\\s/.test(sig)"
    - "exportsSection P0 placed after symbolsSection in flatMap; absent when no exports"
    - "callsSection P1 from callSitesRaw, callee-name + caller line pre-enrichment"
    - "Heuristic path uses /^export\\s/.test(line.trim()) on raw line text"

key-files:
  created:
    - test/capsule-exports.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/tree-sitter-worker.cjs

key-decisions:
  - "isExported uses both AST parent type check AND signature text fallback — handles JS/TS and other grammars"
  - "callsSection built pre-enrichment with callee-name only; post-enrichment rebuild in plan 45-02"
  - "exportsSection and callsSection added to BOTH compression-core.cjs (inline) and tree-sitter-worker.cjs (worker) simultaneously"

requirements-completed:
  - CAP-01

duration: 5 min
completed: 2026-04-19
---

# Phase 45 Plan 01: Export Surface — isExported Flag + exportsSection

**`isExported` flag on symbolDeclarations + `exportsSection` (P0) and `callsSection` (P1) in both capsule builders**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-04-19
- **Tasks:** 5 (W0 stub + 4 wave tasks)
- **Files modified:** 3

## Accomplishments

- `isExported: boolean` added to every `symbolDeclarations` entry in both `compression-core.cjs` inline path and `tree-sitter-worker.cjs` worker path
- Detection: `EXPORT_PARENT_TYPES.has(node.parent?.type)` (AST) with `/^export\s/.test(sig)` signature text fallback
- `exportsSection` (P0) added to `buildCodeCapsule` in both files — only appears when at least one exported symbol exists
- `callsSection` (P1) added to `buildCodeCapsule` in both files — lists outgoing calls as `calleeName — line N`
- `buildTextFallbackCapsule` (heuristic path): `isExported` via `/^export\s/.test(line.trim())`, `exportsSection` added
- Test suite: `test/capsule-exports.test.cjs` — 3/3 passing

## Files Created/Modified

- `mesh-core/src/compression-core.cjs` — isExported in walkTree, exportsSection/callsSection declared + populated, flatMap updated, heuristic path updated
- `mesh-core/src/tree-sitter-worker.cjs` — identical changes mirrored in worker path
- `test/capsule-exports.test.cjs` — 3 CAP-01 tests passing

## Decisions Made

- `callsSection` built from `callSitesRaw` pre-enrichment (callee-name + caller line only). Post-enrichment rebuild with resolved file:line handled in Plan 45-02.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None

## Next Phase Readiness

- Plan 45-02 can proceed: `callSitesRaw` flows through; post-enrichment rebuild will upgrade calls section
- Plan 45-03 can proceed: `exportsSection` is now part of `capsuleBase.sections`, so `buildFilesMd` API Surface block will pick it up automatically

## Self-Check: PASSED

- `test/capsule-exports.test.cjs` exists ✓
- `grep -c "exportsSection" mesh-core/src/compression-core.cjs` → 6 ✓
- `grep -c "isExported" mesh-core/src/compression-core.cjs` → 5 ✓
- `grep -c "exportsSection" mesh-core/src/tree-sitter-worker.cjs` → 5 ✓
- git log shows 3 commits for 45-01 ✓
