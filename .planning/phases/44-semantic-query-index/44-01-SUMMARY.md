---
phase: "44"
plan: "01"
subsystem: compression-core
tags: [string-literals, query-index, tree-sitter, compression]
requires: []
provides: [stringLiterals-extraction, MAX_QUERY_TOKENS_PER_FILE]
affects: [compression-core, tree-sitter-worker, buildWorkspaceFileRecord]
tech-stack:
  added: []
  patterns: [walkTree-collect, worker-duality]
key-files:
  created:
    - test/query-index-build.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/tree-sitter-worker.cjs
key-decisions:
  - Worker path uses self-contained STRING_NODE_TYPES_W (cannot import compression-core) — same pattern as Phase 43 callSitesRaw
  - Filter: length < 4, numeric-only, and non-alpha strings excluded to keep index signal/noise high
requirements-completed: [IDX-01, IDX-03]
duration: "4 min"
completed: "2026-04-18"
---

# Phase 44 Plan 01: String Literal Extraction Summary

`stringLiterals[]` extraction added to every file record — AST-based for tree-sitter languages, regex-based heuristic for others. Both paths produce `{value, lineStart}` arrays capped by `MAX_QUERY_TOKENS_PER_FILE` (300, env-configurable).

**Duration:** 4 min | **Tasks:** 9 | **Files modified:** 2 | **Files created:** 1

## What Was Built

- `MAX_QUERY_TOKENS_PER_FILE` constant (compression-core.cjs) — env-configurable, clamped 10-5000
- `extractStringLiterals(tree, rawText)` — walks AST, collects non-trivial string values with line numbers
- `buildCodeCapsule` now produces `stringLiteralsRaw` in return object
- `buildWorkspaceFileRecord` exposes `stringLiterals` on file record (never undefined)
- `buildTextFallbackCapsule` — regex-based heuristic extraction for unsupported languages
- `tree-sitter-worker.cjs` — self-contained extraction block after callSitesRaw, `maxQueryTokens` passed via limits
- 3 tests in `test/query-index-build.test.cjs` — all pass

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

Ready for 44-02: `buildQueryIndexEntries()` and Pass 3 enrichment.

## Self-Check: PASSED
