---
tags: [architecture]
---

# System Architecture

## Two-Process Model

Mesh is not a monolith. It runs as two cooperating processes:

| Process | Entry Point | Role |
|---------|-------------|------|
| Gateway | `server.js` → `src/server.js` | HTTP, Auth, UI, API surface |
| Worker | `mesh-core/src/server.js` | Workspace ops, indexing, compression, git |

The gateway proxies most workspace requests to the worker via `meshTunnelRequest(...)`. If the worker is unreachable, the gateway falls back to local logic.

## Production Infrastructure (AWS)

| Resource | Details |
|----------|---------|
| Compute | EC2 t2.micro — `35.175.88.93` (us-east-1), PM2 process manager |
| Auth/Sessions | DynamoDB (`mesh-users`, `mesh-sessions`, `mesh-stores`) |
| AI | Bedrock — Claude Sonnet 4.6 via IAM user `mesh-bedrock-access` |
| Voice STT | Amazon Transcribe Streaming |
| Voice TTS | Amazon Polly (neural) |
| Workspace offload | S3 `mesh-workspace-offload-960583973825` (optional) |
| DNS | Cloudflare → EC2 |
| CI/CD | GitHub Actions → rsync → `pm2 restart mesh-gateway` |

## Two Domains

### Workbench Domain
What the user sees and interacts with.

- File explorer, Monaco editor
- Chat panel (typed assistant)
- Dependency graph
- Terminal surface
- Voice-Coding surface
- Settings

### Workspace Intelligence Domain
What compresses, indexes, recovers, and reasons over files.

- Workspace ingest and diff sync
- Tree-sitter AST parsing
- Capsule generation (ultra/medium/loose tiers)
- Dependency graph construction
- Search and grep
- Recovery from span IDs

## Request Flow (Workspace Operation)

```
Browser
  └─► Gateway (/api/assistant/*)
        └─► meshTunnelRequest → Worker (/mesh/tunnel)
              └─► workspace-operations.js
                    ├─► workspace-helpers.js
                    └─► compression-core.cjs
                          └─► tree-sitter-worker.cjs
```

If the worker is down, the gateway executes fallback logic inline from `src/core/index.js`.

## Frontend-to-Backend Contract

The browser communicates with the gateway over:
- **REST** under `/api/...`
- **WebSocket `/terminal`** — pty shell sessions
- **WebSocket `/api/realtime`** — voice PCM streaming

## Global State

`global.*` has been fully removed from the gateway. All route modules receive dependencies via explicit injection:

- HTTP routes (`auth.routes.js`, `app.routes.js`, `assistant.routes.js`, `assistant-chat.routes.js`, `assistant-git.routes.js`): factory functions — `createAuthRouter(core)`, `createAppRouter(core)`, `createAssistantRouter(core)`, etc.
- WebSocket modules (`terminal.routes.js`, `realtime.routes.js`): setup functions — `setupTerminalRelay(server, { projectRoot, core })`, `setupRealtimeRelay(server, core)`

`src/server.js` requires `src/core/index.js` once and passes it explicitly to all modules. No globals are written at startup.

## Worker Tunnel Actions

The worker exposes a single endpoint `/mesh/tunnel` that dispatches on `action`:

```
workspace.open-local      workspace.select
workspace.files           workspace.graph
workspace.file.open       workspace.capsule.open
workspace.transport.open  workspace.recovery.fetch
workspace.search          workspace.grep
workspace.file.create     workspace.file.save
workspace.file.rename     workspace.file.delete
workspace.batch           workspace.sync
git.status                git.diff
git.commit                git.push
git.pull                  chat
status
```

## HTTP Compression Middleware

`src/middleware/compression.js` — Brotli + gzip response compression applied at the Express layer. Skips streaming responses (SSE) and WebSocket upgrades. Registered globally in `src/server.js`.

## Known Weak Points

| Area | Issue |
|------|-------|
| Graph identity | Frontend may send wrong `workspaceId`; worker trusts it too much |
| Multiple workspace truths | `S.dirName`, worker state, metadata store, upload IDs — not yet unified |
| Backend core monolith | `src/core/index.js` is still large, though `operations-store.js` and `mesh-codec.js` have been extracted; further splits ongoing |
| Dual terminal model | Bottom-panel terminal + dedicated terminal surface coexist |

## Key Files by Layer

| Layer | Files |
|-------|-------|
| Entry points | `server.js`, `mesh-core/src/server.js` |
| Config | `src/config/index.js`, `src/config/env-utils.js` |
| Gateway core | `src/core/index.js`, `src/core/auth.js`, `src/core/model-providers.js`, `src/core/mesh-codec.js`, `src/core/operations-store.js` |
| Workspace ops | `src/core/workspace-ops.js`, `src/core/workspace-infrastructure.js`, `src/core/workspace-context.js` |
| Middleware | `src/middleware/rate-limiter.js`, `src/middleware/compression.js` |
| Worker core | `mesh-core/src/workspace-operations.js`, `mesh-core/src/workspace-helpers.js` |
| Compression | `mesh-core/src/compression-core.cjs`, `mesh-core/src/tree-sitter-worker.cjs` |
| Frontend shell | `views/app.html`, `assets/app-workspace.js`, `assets/app-workspace.css` |
