---
phase: 15-compression-engine-full-language-coverage-pipeline-quality
plan: "02"
subsystem: compression
tags: [tree-sitter, grammar, worker-threads, language-support]

requires:
  - phase: "15-01"
    provides: "tree-sitter ^0.22 + 8 grammar packages installed in node_modules"
provides:
  - All 8 new languages registered in compression-core.cjs (main thread)
  - All 8 new languages registered in tree-sitter-worker.cjs (worker thread)
  - .rs/.cpp/.cc/.h/.hpp/.cs/.java/.rb/.php/.kt/.kts/.swift → capsuleType "structure"
  - definitionLike node type list extended for Rust, C++, C#, Java, Ruby, PHP, Kotlin, Swift
affects: [15-03-heuristic-fallback, 15-04-tests]

tech-stack:
  added: []
  patterns: [worker-thread mirror pattern, PHP export shape handling with tsPhp?.php || tsPhp]

key-files:
  created: []
  modified:
    - mesh-core/src/compression-core.cjs
    - mesh-core/src/tree-sitter-worker.cjs

key-decisions:
  - "PHP grammar exports { php, php_only } — used tsPhp?.php || tsPhp for forward compat"
  - "Duplicate node type strings in definitionLike are harmless (includes short-circuits on first match)"
  - "Worker file updated identically to main thread — V8 isolate isolation requires full duplication"

patterns-established:
  - "Grammar registration: safeRequire → treeSitterLanguages → CODE_LANGUAGE_MAP → definitionLike — all 4 must be updated together for a new language"

requirements-completed: []

duration: 20min
completed: 2026-04-16
---

# Phase 15 Plan 02: Grammar Registration

**Registered 8 new language grammars in both the main-thread and worker-thread compression engines — Rust, C++, C#, Java, Ruby, PHP, Kotlin, and Swift now produce `capsuleType: "structure"` with full symbol extraction.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-04-16T13:05:00Z
- **Completed:** 2026-04-16T13:25:00Z
- **Tasks:** 3 completed (02-01, 02-02, 02-03)
- **Files modified:** 2

## Accomplishments

### Task 02-01: compression-core.cjs
- Added 8 `safeRequire()` calls after existing grammar imports
- Extended `CODE_LANGUAGE_MAP` with 12 new extension entries (rs, cpp, cc, h, hpp, cs, java, rb, php, kt, kts, swift)
- Extended `treeSitterLanguages` map with 8 new language keys
- Extended `definitionLike` array with 20 new node types across all 8 languages

### Task 02-02: tree-sitter-worker.cjs
- Mirrored all 8 `safeRequire()` calls
- Updated `treeSitterLanguages` map identically

### Task 02-03: definitionLike in worker
- Extended worker's `definitionLike` array identically to main thread

## Verification

- `node -e "require('./mesh-core/src/compression-core.cjs')"` → loads cleanly, no errors
- `buildWorkspaceFileRecord('src/main.rs', ...)` → `fileType: "code/rust"` ✓
- `buildWorkspaceFileRecord('Main.java', ...)` → `fileType: "code/java"` ✓
- `buildWorkspaceFileRecord('app.swift', ...)` → `fileType: "code/swift"` ✓
- `buildWorkspaceFileRecord('main.cpp', ...)` → `fileType: "code/cpp"` ✓

## Self-Check: PASSED
