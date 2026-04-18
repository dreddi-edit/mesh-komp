---
phase: 34-mesh-folder-improved-auto-generated-files
plan: 02
subsystem: infra
tags: [mesh, dead-code-removal, workspace-indexing]

requires:
  - phase: 34-mesh-folder-improved-auto-generated-files
    provides: provisionMeshFolder replaces all old generators
provides:
  - Clean workspace-operations.js with only provisionMeshFolder for .mesh generation
  - Clean state-provision.js without old metadata generator
  - Deduplicated FRAMEWORK_PATTERNS at module level
affects: []

tech-stack:
  added: []
  patterns: []

key-files:
  created: []
  modified: [mesh-core/src/workspace-operations.js, src/core/infrastructure/state-provision.js, src/core/infrastructure/job-queue.js, src/services/workspace-service.js]

key-decisions:
  - "Removed provisionMeshWorkspaceMetadata callers entirely rather than redirecting -- post-indexing hooks already trigger provisionMeshFolder"
  - "Removed helper functions (generateMeshWorkspaceTree, readPackageJsonSummary) since they had zero callers outside provisionMeshWorkspaceMetadata"

patterns-established: []

requirements-completed: [MESH-01]

duration: 5min
completed: 2026-04-18
---

# Phase 34 Plan 02: Dead Code Removal

**Removed 6 old generator functions (747 lines), intelligence queue, .mesh-Intelligence code, and provisionMeshWorkspaceMetadata from state-provision.js**

## Performance

- **Duration:** 5 min
- **Started:** 2026-04-18
- **Completed:** 2026-04-18
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Removed provisionDependencyMap, provisionMeshFile, buildMeshFileContent, buildIntelligenceArtifacts, provisionIntelligenceArtifacts from workspace-operations.js
- Removed intelligence queue mechanism (enqueueIntelligenceJob, drainIntelligenceQueue, queue state)
- Removed provisionMeshWorkspaceMetadata, MESH_SYSTEM_PROMPT import, and 3 helper functions from state-provision.js
- Removed caller in job-queue.js and updated workspace-service.js
- FRAMEWORK_PATTERNS now defined once at module level (was duplicated in 2 old functions)
- Net deletion: 747 lines

## Task Commits

1. **Task 1: Remove old generator functions** - `29215d7` (refactor)
2. **Task 2: Remove provisionMeshWorkspaceMetadata** - `29215d7` (refactor)

## Files Created/Modified
- `mesh-core/src/workspace-operations.js` - Removed 6 functions, intelligence queue, old exports
- `src/core/infrastructure/state-provision.js` - Removed provisionMeshWorkspaceMetadata, helpers, MESH_SYSTEM_PROMPT import
- `src/core/infrastructure/job-queue.js` - Removed import and call to provisionMeshWorkspaceMetadata
- `src/services/workspace-service.js` - Updated reindex() to no-op (was calling removed function)

## Decisions Made
- Removed callers entirely rather than redirecting to provisionMeshFolder -- the post-indexing hooks in workspace-operations.js already trigger provisionMeshFolder when indexing completes, making the separate calls redundant

## Deviations from Plan

### Auto-fixed Issues

**1. Additional caller in job-queue.js**
- **Found during:** Task 2
- **Issue:** job-queue.js imported and called provisionMeshWorkspaceMetadata after workspace select completes
- **Fix:** Removed import and call -- provisionMeshFolder is triggered by post-indexing hooks in the same flow
- **Files modified:** src/core/infrastructure/job-queue.js
- **Verification:** grep confirms zero references remain

**2. Additional caller in workspace-service.js**
- **Found during:** Task 2
- **Issue:** workspace-service.js reindex() delegated to provisionMeshWorkspaceMetadata
- **Fix:** Changed to return { ok: true } -- the function is unused (route uses meshTunnelRequest instead)
- **Files modified:** src/services/workspace-service.js
- **Verification:** grep confirms zero callers of workspaceService.reindex

---

**Total deviations:** 2 auto-fixed (additional callers not mentioned in plan)
**Impact on plan:** Necessary for correctness. Without fixing these, the app would crash at runtime when the removed function was called.

## Issues Encountered
None

## User Setup Required
None

## Next Phase Readiness
- Phase 34 complete -- .mesh folder generation is consolidated into a single function
- This is the last phase of milestone v2.1

---
*Phase: 34-mesh-folder-improved-auto-generated-files*
*Completed: 2026-04-18*
