# Architecture

## Pattern

**Layered monolith** — single Express process serving both the API and static frontend. No microservices, no build step. Vanilla JS throughout.

```
Browser (HTML/JS/CSS)
   │
   ├── HTTP ──► Express (src/server.js)
   │              ├── Static assets (views/, assets/)
   │              ├── Auth routes (/api/auth/*)
   │              ├── App routes (/api/docs, /api/operations/*)
   │              ├── Assistant routes (/api/assistant/*)
   │              │     ├── Workspace CRUD
   │              │     ├── Git operations
   │              │     ├── Chat/streaming
   │              │     └── Terminal sessions
   │              └── Middleware (compression, rate-limit, CSRF, validation)
   │
   ├── WS ───► Terminal relay (/terminal)
   │              └── node-pty shell session
   │
   └── WS ───► Voice relay (/api/realtime)
                  └── Transcribe → Claude → Polly pipeline
```

## Layers

### 1. Entry Point (`src/server.js`, 240 lines)
- Creates Express app + HTTP server
- Registers middleware stack (request ID → security headers → CSRF → JSON body → rate limiter → compression)
- Builds asset hash map and view route map at startup
- Mounts route groups and WebSocket handlers
- Pre-warms tree-sitter worker pool

### 2. Routes (`src/routes/`, 8 files, ~3,551 lines)
- **`auth.routes.js`** (253 lines) — login, logout, register, session management, user store CRUD
- **`app.routes.js`** (604 lines) — repo docs browsing/rendering, operations/deployments/policies API
- **`assistant.routes.js`** (214 lines) — composer that mounts sub-routers + terminal sessions + runs
- **`assistant-workspace.routes.js`** (478 lines) — workspace select/open/files/graph/sync/batch/reindex
- **`assistant-chat.routes.js`** (768 lines) — chat, SSE streaming, codec, inline-complete
- **`assistant-git.routes.js`** (332 lines) — git status/branch/commit/push/pull/diff/log/stash/clone
- **`realtime.routes.js`** (573 lines) — WebSocket voice chat handler
- **`terminal.routes.js`** (307 lines) — WebSocket terminal handler

### 3. Core Logic (`src/core/`, 10 files, ~9,953 lines)
- **`index.js`** (1,200 lines) — wiring hub: imports all modules, assigns globals, builds `module.exports` facade
- **`auth.js`** (582 lines) — session cookies, password hashing (scrypt), session cache, credential cache
- **`model-providers.js`** (1,663 lines) — multi-provider AI calls, mesh codec encode/decode, model routing
- **`workspace-ops.js`** (1,723 lines) — workspace file CRUD, search, grep, git, batch operations
- **`workspace-infrastructure.js`** (1,191 lines) — path safety, metadata store, git wrapper, S3 blob ops, job queue
- **`workspace-context.js`** (1,146 lines) — file open cache, workspace fallback logic, terminal session management
- **`assistant-runs.js`** (1,130 lines) — assistant run lifecycle, proposal generation, batch editing
- **`voice-agent.js`** (851 lines) — voice chat agent with tool use (workspace read/write/search)
- **`voice-aws-audio.js`** (257 lines) — AWS Transcribe + Polly integration
- **`deployments.js`** (210 lines) — deployment queue, policy management

### 4. Data Layer
- **`secure-db.js`** (521 lines, root) — DynamoDB + SQLite dual-backend, AES-256-GCM encryption
- **`workspace-metadata-store.cjs`** (519 lines, root) — DynamoDB workspace file metadata store
- No ORM — direct DynamoDB Document Client operations

### 5. Shared Libraries (root-level)
- **`assistant-core.js`** (806 lines) — shared utilities for assistant features (structural edit, command guard, path scoring)
- **`llm-compress.js`** (499 lines) — LLM context compression logic

### 6. Mesh Core (`mesh-core/src/`, 7,232 lines)
- **`compression-core.cjs`** (2,568 lines) — workspace file compression pipeline (Brotli + capsule + transport)
- **`workspace-operations.js`** (2,326 lines) — mesh worker workspace operations
- **`workspace-helpers.js`** (875 lines) — workspace utility functions
- **`tree-sitter-worker.cjs`** (574 lines) — AST-based code analysis worker
- **`server.js`** (324 lines) — mesh-core microservice (separate process)

## Key Abstractions

### Global State Pattern
`src/core/index.js` assigns shared mutable state (e.g., `localAssistantWorkspace`, `workspaceMetadataStore`, `operationsStore`) to module-level variables that other core modules reference as globals. This avoids circular dependency chains but creates implicit coupling.

### Workspace Duality
Two workspace modes with shared interfaces:
1. **Upload workspace** — files stored in DynamoDB metadata + S3 blobs
2. **Local-path workspace** — files read directly from disk via `rootPath`

### Tunnel/Fallback Pattern
Routes try `meshTunnelRequest()` to the mesh-core worker first, then fall back to local implementations. This allows the gateway to operate standalone when the worker is unavailable.

### Credential Resolution
User API keys flow: DynamoDB (encrypted) → `getStoredCredentialsForUser()` → credential cache (60s TTL) → `mergeChatCredentials()` → provider call functions.
