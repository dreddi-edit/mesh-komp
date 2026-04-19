---
phase: 15-compression-engine-full-language-coverage-pipeline-quality
plan: "01"
subsystem: compression
tags: [tree-sitter, grammar, npm, workspace]

requires: []
provides:
  - tree-sitter ^0.22.0 core binding installed
  - 8 new language grammar packages installed (Rust, C++, C#, Java, Ruby, PHP, Kotlin, Swift)
  - LOCAL_WORKSPACE_SKIP_EXTENSIONS extended with wasm/map/wav/ogg
  - isWorkspaceIndexablePath guards .min.js and .min.css paths
affects: [15-02-grammar-registration, 15-03-heuristic-fallback, 15-04-tests]

tech-stack:
  added: [tree-sitter-rust, tree-sitter-cpp, tree-sitter-c-sharp, tree-sitter-java, tree-sitter-ruby, tree-sitter-php, tree-sitter-kotlin, tree-sitter-swift]
  patterns: [--legacy-peer-deps for over-constrained grammar peer deps]

key-files:
  created: []
  modified:
    - mesh-core/package.json
    - mesh-core/package-lock.json
    - src/core/index.js
    - src/core/workspace-infrastructure.js

key-decisions:
  - "Used --legacy-peer-deps because tree-sitter-c-sharp@0.21.3 over-constrains peer to ^0.21.x; grammar works fine at runtime with ^0.22"
  - "Added wav/ogg to SKIP_EXTENSIONS alongside wasm/map — audio formats were missing from original list"
  - "min.js/css guard placed in isWorkspaceIndexablePath (workspace-infrastructure.js) not in the regex — regex change would be permanent but this guard is workspace-context-specific"

patterns-established:
  - "Grammar peer dep conflicts: use --legacy-peer-deps; tree-sitter grammars often over-constrain semver ranges"

requirements-completed: []

duration: 15min
completed: 2026-04-16
---

# Phase 15 Plan 01: Dependency Upgrade + Skip Extension Fix

**Foundation work: upgraded tree-sitter to ^0.22 and installed 8 new language grammar packages, enabling full Rust/C++/C#/Java/Ruby/PHP/Kotlin/Swift support in subsequent plans.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-16T12:50:00Z
- **Completed:** 2026-04-16T13:05:00Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments

### Task 01-01: Upgrade tree-sitter + grammar packages
- `tree-sitter` core binding bumped from `^0.21.1` → `^0.22.0` (unblocks cpp and php)
- Added 8 grammar packages to `mesh-core/package.json`
- `npm install --legacy-peer-deps` succeeded; all 8 packages present in `node_modules/`

### Task 01-02: Fix SKIP_EXTENSIONS + min file guard
- `LOCAL_WORKSPACE_SKIP_EXTENSIONS` in `src/core/index.js`: added `wasm`, `map`, `wav`, `ogg`
- `isWorkspaceIndexablePath` in `src/core/workspace-infrastructure.js`: added `/\.min\.(js|css)$/` guard

## Deviations

- `npm install` initially failed with ERESOLVE due to `tree-sitter-c-sharp@0.21.3` declaring `peerDep: tree-sitter@^0.21.0` (over-constrained). Resolved with `--legacy-peer-deps` — grammar works at runtime with ^0.22.

## Self-Check: PASSED

- All 8 grammar packages present in `mesh-core/node_modules/`
- wasm and map in `LOCAL_WORKSPACE_SKIP_EXTENSIONS`
- min guard in `isWorkspaceIndexablePath`
- 2 atomic commits created
