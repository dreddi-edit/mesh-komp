---
phase: 43
slug: symbol-dependency-graph
status: complete
completed: 2026-04-18
plans_executed: 3
tests_added: 9
---

# Phase 43 — Symbol Dependency Graph: Summary

## What Was Built

Phase 43 adds a full symbol dependency graph to the workspace compression pipeline.

### SYM-01: Per-file symbols[] array
- `buildWorkspaceFileRecord()` now returns `symbols[]` on every file record
- Each entry: `{ name, kind, lineStart, lineEnd, signature }` with 1-based line numbers
- AST extraction runs in both `tree-sitter-worker.cjs` (worker path) and `compression-core.cjs` (inline fallback)
- `buildTextFallbackCapsule()` (heuristic path) also populates `symbolDeclarations[]` from regex patterns
- `MAX_CALL_SITES_PER_FILE = 200` constant added (configurable via `MESH_CAPSULE_MAX_CALL_SITES`)

### SYM-02: Cross-file call site resolution
- `extractCallSites(tree, rawText, parserFamily)` traverses `call_expression` / `call` AST nodes
- `extractCalleeName()` handles: `identifier` (bare calls), `member_expression` (JS/TS `obj.method()`), `attribute` (Python), `selector_expression` (Go)
- Raw call sites `{ callerLine, calleeName }` stored on file record after indexing
- `enrichWorkspaceRecords()` restructured into two sequential passes:
  - Pass 1: extract symbols from all files, build `workspaceState.symbolMap: Map<name, [{file, lineStart, lineEnd, kind}]>`
  - Pass 2: resolve each file's callSites against symbolMap, store `{ callerLine, calleeName, resolvedFile, resolvedLine }`
- Unresolved call sites (callee not in workspace) are omitted

### SYM-03: AI context format
- `formatSymbolChain(startFile, callSites, symbolMap, maxHops)` produces readable chain strings
- Format: `"src/app.js:L24 → login() in src/auth.js:L58"`
- Exported from `compression-core.cjs`, ready for injection into AI chat context

### SYM-04: Incremental update on file save
- `localWorkspaceSave()` in `src/core/workspace/files.js` updates `symbolMap` incrementally
- Removes stale entries for the saved file, adds new symbols, re-resolves callSites
- Guarded by `instanceof Map` check — no-op if enrichment hasn't run yet
- `getWorkspaceGraph()` extended with `symbolEdges[]` (enabled via `includeSymbolEdges: true`)

## Test Coverage

| File | Tests | Status |
|------|-------|--------|
| `test/symbol-index.test.cjs` | 3 | ✅ pass |
| `test/call-site-resolution.test.cjs` | 3 | ✅ pass |
| `test/symbol-context-format.test.cjs` | 2 | ✅ pass |
| `test/symbol-incremental.test.cjs` | 1 | ✅ pass |

Full regression: 4001/4027 pass (24 fail — all pre-existing GSD framework tests unrelated to this phase).

## Files Modified

| File | Change |
|------|--------|
| `mesh-core/src/compression-core.cjs` | Added `MAX_CALL_SITES_PER_FILE`, `extractCallSites()`, `extractCalleeName()`, `formatSymbolChain()`, `symbolDeclarations` in all capsule builders, `symbols`/`callSites` in file record |
| `mesh-core/src/tree-sitter-worker.cjs` | Added `symbolDeclarations[]` and `callSitesRaw[]` extraction in worker `buildCodeCapsule()` |
| `mesh-core/src/mesh-state.js` | Added `symbolMap: new Map()` to `workspaceState` |
| `mesh-core/src/workspace-operations.js` | Two-pass enrichment in `enrichWorkspaceRecords()`, `symbolEdges` in `getWorkspaceGraph()`, `MAX_CALL_SITES_PER_FILE` import |
| `src/core/workspace/files.js` | Incremental `symbolMap` update in `localWorkspaceSave()` |

## Commit

`71a03ab` — feat(phase-43): symbol dependency graph — per-file symbols[] and callSites[]
