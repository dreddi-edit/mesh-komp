---
phase: "44"
plan: "03"
subsystem: workspace/files
tags: [incremental-update, queryIndex, localWorkspaceSave]
requires: [44-02-queryIndex-map]
provides: [incremental-queryIndex-update]
affects: [src/core/workspace/files.js]
tech-stack:
  added: []
  patterns: [incremental-map-update, instanceof-guard]
key-files:
  created:
    - test/query-index-incremental.test.cjs
  modified:
    - src/core/workspace/files.js
key-decisions:
  - Independent block from symbolMap update — queryIndex updates even if symbolMap check is skipped
  - Guard `instanceof Map` follows Phase 43 pattern exactly — no-op if enrichment hasn't run
  - Remove stale entries first (filter by file path), then add fresh entries from buildQueryIndexEntries
requirements-completed: [IDX-04]
duration: "4 min"
completed: "2026-04-18"
---

# Phase 44 Plan 03: Incremental queryIndex Update Summary

`localWorkspaceSave()` now maintains `queryIndex` incrementally — stale entries for the saved file are removed, then new entries from updated symbols + stringLiterals are inserted. No full re-enrichment needed on save.

**Duration:** 4 min | **Tasks:** 4 | **Files modified:** 1 | **Files created:** 1

## What Was Built

- `buildQueryIndexEntries` imported in `files.js`
- Incremental update block in `localWorkspaceSave()`:
  - Guard: `instanceof Map` (no-op before enrichment runs)
  - Stale removal: filter loop over queryIndex entries by file path
  - Fresh insert: `buildQueryIndexEntries({ path: requested, ...packed })`
- 2/2 tests in `test/query-index-incremental.test.cjs` pass
- Full regression suite: 3848/3874 pass (24 pre-existing GSD framework failures, no new failures)

## Deviations from Plan

None — plan executed exactly as written.

## Next Phase Readiness

Phase 44 complete. All 3 plans done. Ready for phase verification.

## Self-Check: PASSED
