---
phase: 34-mesh-folder-improved-auto-generated-files
plan: 01
subsystem: infra
tags: [mesh, code-generation, workspace-indexing]

requires:
  - phase: 33-analytics-graph-real-data-visual-consistency
    provides: stable workspace state and indexing pipeline
provides:
  - provisionMeshFolder() function with 3 helpers (buildProjectJson, buildFilesMd, buildRulesMd)
  - .mesh/ folder outputs: project.json, files.md, rules.md
  - Post-indexing hooks wired to new consolidated generator
  - REPO_DOCS_KNOWN_FILES updated to new file names
affects: [34-02, workspace-indexing, mesh-core]

tech-stack:
  added: []
  patterns: [consolidated-mesh-generation, secret-scrubbing, yaml-frontmatter-in-generated-md]

key-files:
  created: []
  modified: [mesh-core/src/workspace-operations.js, src/routes/app.routes.js, src/core/infrastructure/state-provision.js]

key-decisions:
  - "FRAMEWORK_PATTERNS defined as module-level constant (superset of both old definitions)"
  - "Secret scrubbing via regex on package.json scripts before writing to project.json"
  - "Cloud workspace support via workspaceMetadataStore.upsertWorkspaceFileRecord for all 3 files"

patterns-established:
  - "Consolidated generator: single provisionMeshFolder() replaces 3 scattered generators"
  - "YAML frontmatter on generated .md files for machine parseability"

requirements-completed: [MESH-01]

duration: 8min
completed: 2026-04-18
---

# Phase 34 Plan 01: Consolidated .mesh Folder Generator

**New provisionMeshFolder() outputs project.json (structured JSON), files.md (directory tree + API surface), and rules.md (coding conventions) -- replaces 3 scattered generators**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-18
- **Completed:** 2026-04-18
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Created provisionMeshFolder() with 3 builder helpers (buildProjectJson, buildFilesMd, buildRulesMd)
- Wired new generator into both local and cloud post-indexing hooks
- Updated REPO_DOCS_KNOWN_FILES to reference .mesh/project.json, .mesh/files.md, .mesh/rules.md
- Removed early-return guard from provisionMeshWorkspaceMetadata so .mesh regenerates on every index
- Added secret scrubbing for package.json script commands

## Task Commits

Both tasks committed atomically in a single commit:

1. **Task 1: Create consolidated provisionMeshFolder function** - `f607443` (feat)
2. **Task 2: Wire new generator into post-indexing hooks** - `f607443` (feat)

## Files Created/Modified
- `mesh-core/src/workspace-operations.js` - New provisionMeshFolder() + 3 helpers, updated post-indexing hooks, new exports
- `src/routes/app.routes.js` - REPO_DOCS_KNOWN_FILES updated to new .mesh file names
- `src/core/infrastructure/state-provision.js` - Early-return guard removed from provisionMeshWorkspaceMetadata

## Decisions Made
- Combined both tasks into single commit since they're tightly coupled (can't wire hooks without the function)
- Used module-level FRAMEWORK_PATTERNS constant (superset from both old definitions including Jest, Vitest, Playwright, Webpack, Vite, esbuild)
- Kept provisionMeshWorkspaceMetadata callers intact for Plan 02 cleanup

## Deviations from Plan
None - plan executed as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- provisionMeshFolder is live and wired -- Plan 02 can now safely remove the 6 old generator functions
- Old functions still exist as dead code but are no longer called from post-indexing hooks

---
*Phase: 34-mesh-folder-improved-auto-generated-files*
*Completed: 2026-04-18*
