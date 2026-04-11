---
tags: [backend]
---

# Core Orchestrator

## Overview

`src/core/index.js` is the gateway's main backend brain.

It is a **thin aggregator**: requires the submodules, destructures their exports into scope, and re-exports everything via `module.exports`. `src/server.js` receives the `core` export and passes it explicitly to each route factory — no `global.*` is used.

## Module Map

```
src/core/index.js
  ├─ requires: src/core/auth.js
  ├─ requires: src/core/model-providers.js
  ├─ requires: src/core/assistant-runs.js
  ├─ requires: src/core/workspace-infrastructure.js
  ├─ requires: src/core/workspace-context.js
  ├─ requires: src/core/workspace-ops.js
  ├─ requires: src/core/deployments.js
  ├─ requires: assistant-core.js
  ├─ requires: secure-db.js
  └─ requires: mesh-core/src/compression-core.cjs
               workspace-metadata-store.cjs

src/core/startup-checks.js  ← called by src/server.js at boot, not by index.js
```

## Submodule Breakdown

### `src/core/auth.js`
- Password hashing (bcrypt)
- Session lifecycle (create, validate, destroy)
- `requireAuth` Express middleware
- BYOK credential normalization
- User-store key allowlist

### `src/core/model-providers.js`
- Static model registry (all Anthropic/OpenAI/Gemini models and versions)
- `runModelChat()` — unified call function for all providers
- Mesh model codec: `encodeModel()` / `decodeModel()` / `injectModelConfig()`
- BYOK call routing (Anthropic SDK, OpenAI SDK, Gemini SDK)

### `src/core/assistant-runs.js`
- Run record lifecycle (create, update, read, delete)
- Plan/proposal generation
- Batch execution across files
- Diff extraction from run results
- Run continuation logic

Receives deps via the `core` object passed through from `src/server.js` — no direct requires to avoid circular deps.

### `src/core/workspace-infrastructure.js`
~50 functions:
- Tunnel request handling (`meshTunnelRequest`)
- Workspace provisioning
- Azure Blob operations (upload/download/delete)
- Offload config generation
- Azure Blob URL building
- Workspace metadata helpers
- Indexing perf tracking
- Concurrency mapping
- Indexability filtering

### `src/core/workspace-context.js`
~40 functions:
- Local workspace chunk compression
- Capsule/context building for assistant turns
- Assistant terminal session management
- Codec protocol utilities
- Diff-aware chunk compression for sync ingest

### `src/core/workspace-ops.js`
~35 functions:
- Local workspace select / open-local
- Delta ingest
- Background enrichment
- File I/O (read/write/create/rename/delete)
- Search and grep
- Batch apply
- Git operations (status/diff/commit/push/pull)
- Graph payload construction
- Assistant reply handling

### `src/core/deployments.js`
12 functions:
- Risk normalization
- Policy CRUD (create/read/update/delete)
- Deployment record management
- Policy enforcement

### `src/core/startup-checks.js`
Called once at server boot by `src/server.js` **before** routes or database connections.
- Validates all required and recommended env vars
- In production: missing critical vars are fatal (`process.exit(1)`)
- In all environments: missing recommended vars produce logged warnings
- Returns `{ ok: boolean, errors: string[], warnings: string[] }`

## Shared External Modules

| Module | Purpose |
|--------|---------|
| `assistant-core.js` | Shared assistant logic (used by gateway and worker) |
| `secure-db.js` | Encrypted SQLite for users/sessions/user-store |
| `workspace-metadata-store.cjs` | Workspace metadata persistence (Cosmos-backed) |
| `mesh-core/src/compression-core.cjs` | Capsule pipeline |

## Known Issues

- `src/core/index.js` is still very large — hard to reason about ownership boundaries; further split into focused submodules is the long-term goal
