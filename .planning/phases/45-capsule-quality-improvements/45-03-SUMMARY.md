---
phase: 45-capsule-quality-improvements
plan: "03"
subsystem: compression
tags: [capsule, file-roles, buildFilesMd, workspace-operations]

requires:
  - phase: 45-01
    provides: exportsSection in capsuleBase.sections (makes API Surface block auto-populate)
  - phase: 45-02
    provides: resolvedImportsSection (no direct dependency but planned sequentially)

provides:
  - classifyFileRole(relPath) — pure function mapping file paths to 8 role buckets
  - File Roles markdown table in buildFilesMd() output — appended after API Surface block
  - .mesh/files.md automatically gets File Roles table via provisionMeshFolder → buildFilesMd
affects: []

tech-stack:
  added: []
  patterns:
    - "classifyFileRole: path-pattern matching in priority order — test → route-handler → middleware → entry-point → config → service → model → util"
    - "ROLE_ORDER array controls table row order (most-specific first, util last)"
    - "roleMap built fresh per buildFilesMd call — no shared state"

key-files:
  created:
    - test/file-roles.test.cjs
  modified:
    - mesh-core/src/workspace-operations.js

key-decisions:
  - "classifyFileRole placed immediately before buildFilesMd — not exported, internal to workspace-operations.js"
  - "File Roles table appended after API Surface block, not before — API Surface is higher-priority context"

requirements-completed:
  - CAP-04

duration: 5 min
completed: 2026-04-19
---

# Phase 45 Plan 03: File Roles Table in buildFilesMd

**`classifyFileRole()` utility + `## File Roles` markdown table added to `buildFilesMd()` output**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-04-19
- **Tasks:** 3 (W0 stub + 2 wave tasks)
- **Files modified:** 2

## Accomplishments

- `classifyFileRole(relPath)` pure function classifies workspace files into 8 role buckets: `entry-point`, `route-handler`, `service`, `model`, `middleware`, `config`, `test`, `util`
- Classification via path-pattern matching in priority order — more specific patterns (test, route-handler) checked before generic ones (util)
- `buildFilesMd()` extended with `## File Roles` markdown table: `| Role | Files |` with one row per non-empty bucket
- Files in each row sorted alphabetically and comma-separated
- Table appended after API Surface block
- Bonus: since Plan 45-01 added a real `exports` section to capsule output, the existing API Surface "Exports" block in `buildFilesMd` now auto-populates with actual exported symbols
- Test suite: `test/file-roles.test.cjs` — 3/3 passing

## Files Created/Modified

- `mesh-core/src/workspace-operations.js` — `classifyFileRole()` function + File Roles table in `buildFilesMd()`
- `test/file-roles.test.cjs` — 3 CAP-04 tests passing

## Decisions Made

- None beyond what CONTEXT.md specified

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None

## Self-Check: PASSED

- `test/file-roles.test.cjs` 3/3 ✓
- `grep -c "classifyFileRole" mesh-core/src/workspace-operations.js` → 3 ✓
- `grep -c "File Roles" mesh-core/src/workspace-operations.js` → 1 ✓
- Full suite (10 tests across 4 files): 10/10 pass ✓
