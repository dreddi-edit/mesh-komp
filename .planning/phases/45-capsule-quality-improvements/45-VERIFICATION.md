---
status: passed
phase: 45-capsule-quality-improvements
verified: 2026-04-19
verifier: inline (gsd-verifier subagent unavailable — model resolution bug in Claude Code)
---

# Phase 45: Capsule Quality Improvements — Verification

## Phase Goal

Enrich the capsule rendering pipeline with four new data surfaces drawn from Phase 43's symbol/call data: export surfaces (CAP-01), outgoing call references (CAP-02), resolved imports (CAP-03), and concrete file roles in the workspace summary (CAP-04).

## Must-Have Verification

### CAP-01: Export surfaces in capsule

| Check | Command | Result |
|-------|---------|--------|
| `exportsSection` in compression-core.cjs | `grep -c "exportsSection" mesh-core/src/compression-core.cjs` | ✓ 8 matches |
| `exportsSection` in tree-sitter-worker.cjs | `grep -c "exportsSection" mesh-core/src/tree-sitter-worker.cjs` | ✓ 5 matches |
| `isExported` on symbolDeclarations | `grep -c "isExported" mesh-core/src/compression-core.cjs` | ✓ 5 matches |
| isExported in heuristic path | `grep -n "isExported.*line.trim" mesh-core/src/compression-core.cjs` | ✓ present at line ~1358 |
| Runtime: exports section with exported fn | `buildWorkspaceFileRecord('auth.js', 'export function login(){}')` | ✓ exports section has `login` |
| Runtime: no exports section for non-exported | `buildWorkspaceFileRecord('util.js', 'function helper(){}')` | ✓ no exports section |
| Tests: CAP-01 suite | `node --test --test-force-exit test/capsule-exports.test.cjs` | ✓ 3/3 pass |

**Status: ✓ PASSED**

### CAP-02: Outgoing call references

| Check | Command | Result |
|-------|---------|--------|
| `callsSection` in compression-core.cjs | `grep -c "callsSection" mesh-core/src/compression-core.cjs` | ✓ 4 matches |
| `callsSection` in tree-sitter-worker.cjs | `grep -c "callsSection" mesh-core/src/tree-sitter-worker.cjs` | ✓ 4 matches |
| Post-enrichment rebuild | `grep -c "Rebuild calls section" mesh-core/src/workspace-operations.js` | ✓ 1 match |
| Runtime: calls section for function with calls | `buildWorkspaceFileRecord('app.js', 'function main(){login();logout();}')` | ✓ calls section has `login`, `logout` |
| Tests: CAP-02 suite | `node --test --test-force-exit test/capsule-calls.test.cjs` | ✓ 2/2 pass |

**Status: ✓ PASSED**

### CAP-03: Resolved imports

| Check | Command | Result |
|-------|---------|--------|
| `resolved-imports` section injection | `grep -c "resolved-imports" mesh-core/src/compression-core.cjs` | ✓ 2 matches |
| resolvedImportPairs logic | `grep -n "resolvedImportPairs" mesh-core/src/compression-core.cjs` | ✓ 4 matches |
| Dedup guard for shared section arrays | `grep -n "cacheSections !== record.capsuleBase.sections" mesh-core/src/compression-core.cjs` | ✓ present |
| Runtime: resolved-imports with workspace path | `buildWorkspaceFileRecord('src/app.js', "require('./auth-service')", {workspaceFilePaths:['src/auth-service.js']})` | ✓ resolved-imports section with `'./auth-service' → src/auth-service.js` |
| Runtime: no section for npm-only imports | `buildWorkspaceFileRecord('app.js', "require('express')", {workspaceFilePaths:['src/auth.js']})` | ✓ no resolved-imports section |
| Tests: CAP-03 suite | `node --test --test-force-exit test/capsule-imports.test.cjs` | ✓ 2/2 pass |

**Status: ✓ PASSED**

### CAP-04: File roles in workspace summary

| Check | Command | Result |
|-------|---------|--------|
| `classifyFileRole()` function | `grep -c "function classifyFileRole" mesh-core/src/workspace-operations.js` | ✓ 1 match |
| File Roles table in buildFilesMd | `grep -c "File Roles" mesh-core/src/workspace-operations.js` | ✓ 1 match |
| Runtime: File Roles table output | `buildFilesMd([{path:'ws/server.js',...},{path:'ws/auth.routes.js',...}], 'ws')` | ✓ output includes `## File Roles` with `entry-point` and `route-handler` rows |
| Role buckets: test, route-handler | path pattern matching | ✓ `.test.cjs` → test, `.routes.js` → route-handler |
| Tests: CAP-04 suite | `node --test --test-force-exit test/file-roles.test.cjs` | ✓ 3/3 pass |

**Status: ✓ PASSED**

## Test Suite Results

```
node --test --test-force-exit test/capsule-exports.test.cjs test/capsule-calls.test.cjs test/capsule-imports.test.cjs test/file-roles.test.cjs

# tests 10
# pass 10
# fail 0
```

## Regression Check

Prior phase tests (phases 43 and 44):
```
node --test --test-force-exit test/symbol-index.test.cjs test/call-site-resolution.test.cjs test/symbol-context-format.test.cjs test/symbol-incremental.test.cjs test/query-index-build.test.cjs test/query-index-search.test.cjs test/query-index-incremental.test.cjs

# tests 17
# pass 17
# fail 0
```

## Requirements Coverage

| Requirement | Plan | Status |
|-------------|------|--------|
| CAP-01 | 45-01 | ✓ Verified |
| CAP-02 | 45-02 | ✓ Verified |
| CAP-03 | 45-02 | ✓ Verified |
| CAP-04 | 45-03 | ✓ Verified |

## Notable Issues Encountered

- Worker `sig` variable conflict (SyntaxError) caused silent fallback to inline path, stripping import `metadata`. Fixed in Plan 45-02.
- Passthrough-mode files share `capsuleBase.sections` and `capsuleCache.capsule.sections` as the same array reference — required reference equality guard to prevent double-push of `resolvedImportsSection`.

## Verdict

**PASSED** — All 4 CAP requirements met. Capsule rendering pipeline now exposes:
- Which symbols a file exports (with signatures)
- Which external functions it calls (pre-enrichment: callee+line; post-enrichment: callee→file:line)
- Which workspace files it depends on (via resolved-imports section)
- Which role each file plays in the workspace (in .mesh/files.md File Roles table)
