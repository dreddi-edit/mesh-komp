---
phase: 45-capsule-quality-improvements
plan: "02"
subsystem: compression
tags: [capsule, calls, resolved-imports, enrichment, workspace-operations]

requires:
  - phase: 45-01
    provides: callsSection already created in buildCodeCapsule; isExported on symbolDeclarations

provides:
  - callsSection (P1) in both capsule builders — pre-enrichment shows callee:line, post-enrichment shows callee→file:line
  - resolvedImportsSection (P1) in buildWorkspaceFileRecord — workspace-internal imports with resolved paths
  - Post-enrichment calls rebuild in enrichWorkspaceRecords Pass 2 — upgrades calls section to resolved file:line
affects: [phase-45-03]

tech-stack:
  added: []
  patterns:
    - "resolvedImportsSection injected after record build; dedup guard prevents double-push when capsuleBase/capsuleCache share same array reference"
    - "Post-enrichment calls rebuild: updatedSection replaces existing calls entry or appends"
    - "tree-sitter-worker: reuse existing sig variable instead of redeclaring (SyntaxError fix)"

key-files:
  created:
    - test/capsule-calls.test.cjs
    - test/capsule-imports.test.cjs
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/tree-sitter-worker.cjs
    - mesh-core/src/workspace-operations.js

key-decisions:
  - "resolvedImportsSection built in buildWorkspaceFileRecord (not buildCodeCapsule) — only place with workspaceFilePaths"
  - "Dedup guard: cacheSections !== capsuleBase.sections check prevents double-push for passthrough-mode files"
  - "Worker sig variable clash fixed: existing sig var reused as sigTrimmed to avoid duplicate const declaration"

requirements-completed:
  - CAP-02
  - CAP-03

duration: 10 min
completed: 2026-04-19
---

# Phase 45 Plan 02: Calls Section + Resolved-Imports Section

**`callsSection` (P1) + `resolvedImportsSection` (P1) added to capsule output; post-enrichment calls upgraded to resolved file:line**

## Performance

- **Duration:** 10 min
- **Completed:** 2026-04-19
- **Tasks:** 5 (W0 stubs + 4 wave tasks)
- **Files modified:** 5

## Accomplishments

- `callsSection` (P1) was already in both capsule builders from Plan 45-01 — verified and extended with post-enrichment rebuild
- `resolvedImportsSection` (P1) added to `buildWorkspaceFileRecord` — built after dependencies[] using same `resolveWorkspacePath` utility
- Post-enrichment rebuild in `enrichWorkspaceRecords` Pass 2: replaces pre-enrichment callee-name-only entries with resolved `callee → file:line` format
- Dedup guard prevents double-push when `capsuleBase.sections` and `capsuleCache.capsule.sections` share the same array reference (passthrough-mode for tiny files)
- Bug fix: worker had `const sig` re-declared inside the `walkTree` callback — renamed to `sigTrimmed`
- Test suites: `test/capsule-calls.test.cjs` (2/2), `test/capsule-imports.test.cjs` (2/2)

## Files Created/Modified

- `mesh-core/src/compression-core.cjs` — resolvedImportsSection injection + dedup guard
- `mesh-core/src/tree-sitter-worker.cjs` — sig variable rename fix
- `mesh-core/src/workspace-operations.js` — post-enrichment calls section rebuild
- `test/capsule-calls.test.cjs` — 2 CAP-02 tests passing
- `test/capsule-imports.test.cjs` — 2 CAP-03 tests passing

## Decisions Made

- Dedup guard: `cacheSections !== capsuleBase.sections` reference equality check rather than deep comparison — simpler and correct for the shared-reference case.

## Deviations from Plan

- Task 45-02-01 (callsSection) was already complete from Plan 45-01 execution. Verified rather than re-implemented.
- Worker `sig` variable conflict was a bug introduced by Plan 45-01 edits — fixed here as part of implementation.

## Issues Encountered

- Worker syntax error (`Identifier 'sig' has already been declared`) caused worker to fail silently and fall back to inline path, stripping `metadata` from import items. Fixed by renaming to `sigTrimmed`.
- Passthrough-mode files (tiny <150 tokens) share `capsuleBase.sections` and `capsuleCache.capsule.sections` as the same array — required reference equality guard on push.

## Next Phase Readiness

- Plan 45-03 can proceed: `exportsSection` is in `capsuleBase.sections` for all file types

## Self-Check: PASSED

- `test/capsule-calls.test.cjs` 2/2 ✓
- `test/capsule-imports.test.cjs` 2/2 ✓
- `grep -c "resolved-imports" mesh-core/src/compression-core.cjs` → 3 ✓
- `grep -c "Rebuild calls section" mesh-core/src/workspace-operations.js` → 1 ✓
