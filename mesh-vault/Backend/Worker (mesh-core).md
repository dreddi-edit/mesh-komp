---
tags: [backend]
---

# Worker (mesh-core)

## Overview

The worker is the main execution engine for workspace operations. It lives entirely under `mesh-core/` and runs as a separate process on the same EC2 instance, reachable via `MESH_CORE_URL`.

**Entry point:** `node mesh-core/src/server.js`

## File Map

| File | Purpose |
|------|---------|
| `mesh-core/src/server.js` | Slim Express server, Auth validation, trace extraction, and route dispatch |
| `mesh-core/src/logger.js` | Structured JSON Logger, supporting distributed trace correlation via `requestId` |
| `mesh-core/src/mesh-state.js` | Shared mutable workspace state, constants, promisified utils |
| `mesh-core/src/workspace-helpers.js` | ~50 helpers: state I/O, blob ops, git utils, indexing pipeline |
| `mesh-core/src/workspace-operations.js` | ~31 high-level async operations |
| `mesh-core/src/compression-core.cjs` | Main capsule pipeline |
| `mesh-core/src/compression-utils.cjs` | Self-contained text/span utilities |
| `mesh-core/src/tree-sitter-worker.cjs` | AST parsing with tree-sitter + fallbacks |
| `mesh-core/src/MeshServer.js` | Transport/server logic for worker communication |
| `mesh-core/src/mesh-dictionary.js` | Shared compression dictionary |

## Tunnel Endpoint

The worker exposes a single `/mesh/tunnel` endpoint, which is protected via the `x-mesh-worker-secret` header.
Authentication is validated against the `MESH_WORKER_SECRET` environment variable or bypassed if the gateway uses local fallback logic.

The gateway calls `meshTunnelRequest(action, payload, requestId)` which dispatches here and propagates tracing.

### Supported Actions

```
status

workspace.open-local        workspace.select
workspace.files             workspace.graph
workspace.file.open         workspace.capsule.open
workspace.transport.open    workspace.recovery.fetch
workspace.search            workspace.grep
workspace.file.create       workspace.file.save
workspace.file.rename       workspace.file.delete
workspace.batch             workspace.sync

git.status    git.diff
git.commit    git.push    git.pull

chat
```

## `mesh-state.js` — Shared State

```javascript
workspaceState           // current active workspace (in-memory)
workspaceBlobConfig      // S3 offload config for upload workspaces (optional)
workspaceMetadataStore   // Workspace metadata store reference
```

Also exports:
- `brotliCompress`, `brotliDecompress` (promisified)
- `execFileAsync` (promisified)
- Worker constants for indexing/enrichment concurrency
- Initial/full compression tuning parameters
- Blob size limits
- Perf logging helpers

## `workspace-operations.js` — High-Level Operations

Key operations:

| Function | Purpose |
|----------|---------|
| `openLocalWorkspace()` | Open a local-path workspace from disk |
| `selectWorkspaceFolder()` | Select an upload workspace by ID |
| `diffAwareUploadIngest()` | Process incoming sync payload (changed files only) |
| `backgroundIndexEnrich()` | Enrich initial records to full records |
| `listWorkspaceFiles()` | Return file list for active workspace |
| `getWorkspaceGraph()` | Return dependency graph edges |
| `purgeWorkspace()` | Remove all workspace records |
| `handleChat()` | Run an assistant chat turn with workspace context |
| `provisionMeshFile()` | Generate `.mesh` intelligence file at workspace root |
| `buildMeshFileContent()` | Build the content of the `.mesh` file |

## `workspace-helpers.js` — Low-Level Helpers

Provides:
- Workspace state read/write
- Path resolution and normalization
- Blob read/write/delete for upload workspaces
- Git utilities (wrappers around `git` CLI)
- Individual file indexing pipeline
- Incoming file normalization
- Indexability filtering (skip binaries, large files, etc.)
- Perf/concurrency tracking helpers

## `compression-core.cjs` — Capsule Pipeline

See [[Architecture/Compression Pipeline]] for full detail.

High-level: takes a file record, uses tree-sitter for AST analysis, produces `ultra`/`medium`/`loose` capsule tiers, focused capsules, and span index.

## `compression-utils.cjs` — Text Utilities

Self-contained. No tree-sitter or capsule deps. Safe to import anywhere.

Provides:
- `sha256(text)` — deterministic hash
- `SpanManager` — named span tracking
- `buildLineStartIndex(text)` — fast line number lookup
- `estimateTokens(text)` — token count estimation
- Whitespace normalization helpers
- `concurrencyMapper(items, fn, limit)` — bounded parallel execution

## Two Workspace Modes

| Mode | What the worker does |
|------|---------------------|
| `local-path` | Reads from server filesystem directly. Git ops on real `rootPath`. |
| `upload` | Acts as coordinator. Files in S3 (when offload enabled) or in-memory. Worker seeds manifest and processes capsules inline. |

## Worker Package

`mesh-core/package.json` is a separate package with its own dependencies. Install separately:
```bash
cd mesh-core && npm install
```
