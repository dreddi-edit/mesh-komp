---
phase: 24
plan: "02"
title: "Infrastructure + Context + Runs Splits"
status: complete
started: 2026-04-16T23:00:00Z
completed: 2026-04-16T23:45:00Z
---

# Summary: 24-02 Infrastructure + Context + Runs Splits

## What was built

Split `src/core/workspace-infrastructure.js` (1,191 lines), `src/core/workspace-context.js` (1,146 lines), and `src/core/assistant-runs.js` (1,130 lines). All originals are now thin re-export facades.

### infrastructure/ (6 files)
- `path-utils.js` — toSafePath, ensureWorkspaceOwnedPath, path validation, meshTunnelRequest, mapWithConcurrency, createWorkspacePerfTracker (148 lines)
- `s3-config.js` — S3 SDK lazy loading, singleton client, workspaceOffloadConfig (95 lines)
- `s3-ops.js` — S3 blob read/write/copy/delete, compress/decompress, normalizeWorkspaceBlobStorage (230 lines)
- `state-meta.js` — Workspace state queries (localWorkspaceSummary, toWorkspacePath, isLocalPathWorkspaceState, etc.) (173 lines)
- `state-provision.js` — Workspace provisioning (provisionMeshWorkspaceMetadata, scanLocalWorkspaceFiles, runLocalGit, etc.) (331 lines)
- `job-queue.js` — Workspace select job queue (enqueueWorkspaceSelectJob, executeWorkspaceSelectWithFallback, etc.) (280 lines)
- `index.js` — Re-exports all (21 lines)

### context/ (4 files)
- `file-cache.js` — File open cache (openWorkspaceFileWithFallback, createFileOpenCache, etc.) (379 lines)
- `terminal-sessions.js` — Terminal session management (createAssistantTerminalSession, etc.) (194 lines)
- `workspace-fallback.js` — Codec context injection, compressed context loading, model response transport (690 lines)
- `index.js` — Re-exports all (15 lines)

### assistant/ (5 files, split of assistant-runs.js)
- `run-lifecycle.js` — Run create/execute/complete/fail lifecycle (463 lines)
- `run-model.js` — Model call orchestration within runs (241 lines)
- `run-planner.js` — Plan parsing and execution (152 lines)
- `run-proposals.js` — Proposal generation and batch editing (378 lines)
- `index.js` — Re-exports all

## Key files
- `src/core/workspace-infrastructure.js` — thin facade
- `src/core/workspace-context.js` — thin facade
- `src/core/assistant-runs.js` — thin facade
- `src/core/providers/utils.js` — `toSafePath` deduplication: removed local definition, imports from `../infrastructure/path-utils`

## Decisions
- `workspace-fallback.js` at 690 lines — too tightly coupled to split further without circular deps; merits its own future decomposition
- `run-lifecycle.js` at 463 lines — acceptable overage; lifecycle logic is cohesive and splitting would fragment a single responsibility
- `file-cache.js` imports from `../workspace-infrastructure` (the facade), not from infrastructure sub-modules directly — avoids deeper coupling
- `state-provision.js` imports `MESH_SYSTEM_PROMPT` from `../model-providers` — safe (model-providers has no infra imports)

## Self-Check: PASSED
- `node -e "require('./src/core/workspace-infrastructure')"` — no throw
- `node -e "require('./src/core/workspace-context')"` — no throw
- `node -e "require('./src/core/assistant-runs')"` — no throw
- npm test: 3906 pass, 24 fail (all 24 pre-existing GSD framework failures, unchanged)
