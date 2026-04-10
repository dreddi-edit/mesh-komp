# Claude Overview: Mesh-Komp System Architecture

Last updated: 2026-04-06
Audience: engineers working on try-mesh.com (gateway, worker, frontend, compression, auth, deploy)

---

## 1) What this project is

Mesh-Komp is a browser-based AI workbench that lets a user:

- authenticate,
- select a local workspace folder,
- index files into a compressed/capsule representation,
- query/edit files through AI,
- run terminal actions through controlled assistant runs,
- review/apply code changes,
- monitor operations/deployments/policies/logs.

At runtime it is split into:

- a **gateway app** (main web + API),
- a **worker app** (mesh tunnel for workspace/compression operations),
- a shared **compression core** and helper libraries.

---

## 2) Runtime topology (current production shape)

### 2.1 Apps

- Gateway app service: `mesh-gateway-303137`
- Worker app service: `mesh-worker-303137`
- Public domain: `try-mesh.com`

### 2.2 Plans

- Gateway plan: `mesh-plan` (P3v3, capacity 1)
- Worker plan: `mesh-worker-plan` (P3v3, capacity 4)

Reason for split:

- gateway auth/session persistence currently uses SQLite-backed storage and is kept single-instance for reliability,
- worker is scaled separately for indexing/compression throughput.

### 2.3 Cross-service call

- Gateway calls worker tunnel endpoint via `MESH_CORE_URL`.
- Worker exposes `/mesh/tunnel` using brotli-compressed action envelopes.

---

## 3) Repository map (important files and folders)

## 3.1 Root

- `server.js`: gateway API, auth, chat orchestration, workspace fallback, run engine, terminal sessions.
- `secure-db.js`: encrypted SQLite persistence for users/sessions/user_store.
- `assistant-core.js`: shared scoring/ranking/path-safety/plan/action utilities.
- `app.html`: main AI workbench UI and large client runtime script.
- `llm-compress.js`: heuristic fallback compressor used by compression pipeline.
- `DEPLOY.md`: canonical deployment runbook.
- `package.json`: dependencies/scripts.

## 3.2 Worker

- `mesh-core/src/server.js`: worker process, `/mesh/tunnel`, workspace CRUD/search/grep/chat mock.
- `mesh-core/src/compression-core.cjs`: core compression, capsule generation, transport envelope, recovery.
- `mesh-core/src/MeshServer.js`: brotli transport helper + optional minification.

## 3.3 Frontend assets

- `assets/assistant-workbench.js`: VS Code-like shell integration over `app.html` bridge.
- `assets/assistant-workbench.css`: integrated workbench visual/layout layer.
- `assets/workspace.js`: additional workspace page interactions (quick actions/ranges/sidebar behaviors).
- `assets/app.js`, `assets/settings.js`, etc.: page-specific scripts.

## 3.4 Tests

- `test/assistant-core.test.js`
- `test/assistant-integration.test.js`
- `test/compression-core.test.js`
- `test/compression-benchmark.test.js`

---

## 4) End-to-end architecture

## 4.1 Browser -> Gateway

`app.html` is the main orchestrator and talks to gateway endpoints via `requestJson(...)`.

Key responsibilities in frontend runtime:

- auth session bootstrap (`/api/auth/session`),
- workspace upload/indexing with manifest + chunking,
- optional Azure blob offload bootstrap and ingest path,
- file tree/explorer rendering,
- editor/diff rendering (Monaco),
- chat send/decode flows,
- operations/policies/deployments views.

`window.meshAssistantWorkbenchBridge` exposes frontend capabilities to `assets/assistant-workbench.js` so the integrated workbench can call:

- request helpers,
- workspace open/refresh,
- diff preview,
- preference reads/writes,
- state snapshots.

## 4.2 Gateway -> Worker

Gateway method `meshTunnelRequest(action, data)`:

- wraps `{action,data}` JSON,
- brotli-compresses payload,
- posts to `MESH_CORE_URL` as `application/octet-stream` + `X-Mesh-Encoding: brotli`,
- decompresses worker response,
- throws on non-OK / `ok:false`.

Worker `/mesh/tunnel` dispatches actions like:

- `status`,
- `workspace.select`, `workspace.files`, `workspace.file.open`,
- `workspace.file.create`, `workspace.file.save`,
- `workspace.search`, `workspace.grep`,
- `workspace.file.rename`, `workspace.file.delete`,
- `workspace.batch`,
- `chat`.

## 4.3 Gateway local fallback

When worker is unreachable/network-failing, gateway can do local fallback using in-memory + persisted cache (`.mesh-workspace-cache.json`) with near-equivalent workspace APIs.

This keeps the app usable even if worker is down.

---

## 5) Auth and persistence

## 5.1 Auth model

Gateway auth routes:

- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `GET /healthz` (health + auth-store check)

Cookie/session behavior:

- HttpOnly cookie (`mesh_auth` by default),
- session TTL 14 days,
- token hashes stored (sha256), raw token not persisted in DB,
- periodic session touch throttled via `MESH_AUTH_SESSION_TOUCH_INTERVAL_MS`.

## 5.2 secure-db schema

`secure-db.js` creates and uses:

- `users`
- `sessions`
- `user_store`

Features:

- AES-256-GCM encrypted `user_store` payloads,
- email normalization,
- upsert semantics,
- legacy auth-store migration support,
- configurable DB path and journal mode.

## 5.3 SQLite safety hardening

Key hardening knobs now present:

- `MESH_SECURE_DB_FILE`
- `MESH_SECURE_DB_JOURNAL_MODE`
- `MESH_SECURE_DB_COPY_LEGACY`
- `MESH_SECURE_DB_BUSY_TIMEOUT_MS`

On Azure, journal default is designed to avoid unsafe WAL behavior under multi-instance contention.

---

## 6) Workspace indexing and file operations

## 6.1 Main flow from frontend

1. User selects folder.
2. Frontend builds and publishes a file manifest first.
3. Frontend sends content in chunks (parallel reads/chunks).
4. Gateway processes directly or via offload ingest.
5. Worker (or local fallback) compresses/indexes each file into workspace records.
6. Explorer shows indexed/pending states; file open can return indexing-in-progress.

## 6.2 Async queue mode

Gateway supports queued workspace indexing jobs:

- `POST /api/assistant/workspace/select` can return `202` with `queued:true` and `jobId`.
- `GET /api/assistant/workspace/jobs/:jobId` returns job snapshot/status.

Queue characteristics:

- pending cap,
- TTL/history pruning,
- per-user/per-folder scope key serialization,
- running/queued/completed/failed lifecycle.

## 6.3 Offload ingest mode

Routes:

- `GET /api/assistant/workspace/offload-config`
- `POST /api/assistant/workspace/offload/ingest`

If Azure offload is configured:

- browser uploads chunk JSON to blob,
- gateway downloads blob and forwards chunk into workspace.select path,
- can also enqueue ingestion jobs through queue logic.

## 6.4 Workspace CRUD/search APIs

Gateway exposes (auth protected):

- `GET /api/assistant/workspace/files`
- `GET /api/assistant/workspace/file`
- `POST /api/assistant/workspace/file`
- `PUT /api/assistant/workspace/file`
- `DELETE /api/assistant/workspace/file`
- `POST /api/assistant/workspace/recovery`
- `GET /api/assistant/workspace/search`
- `POST /api/assistant/workspace/grep`
- `POST /api/assistant/workspace/rename`
- `POST /api/assistant/workspace/batch`

Worker exposes equivalent actions via tunnel.

---

## 7) Compression system (core of Mesh)

Main implementation: `mesh-core/src/compression-core.cjs`

## 7.1 Record model

Each workspace file record carries multiple representations:

- raw storage (`rawStorage`) for canonical content,
- legacy brotli (`compressedBase64`) compatibility,
- transport envelope (`transportEnvelope`) for chunked compressed transport,
- capsule views (`capsuleBase`, focused capsule variants),
- compression stats and parser metadata.

## 7.2 Transport envelope

- envelope versioning (`mesh-envelope-v2`),
- chunked compression (zstd if available, otherwise brotli),
- digest + span/chunk index validation,
- recovery support from span IDs/ranges.

## 7.3 Capsule extraction

- language/file-type detection,
- tree-sitter parsing for code families,
- section/item extraction for symbols/signatures/structure,
- specialized capsules for config/sql/markup/docs/text fallback,
- focused capsule generation based on user query scoring.

## 7.4 Performance controls

Important tunables include:

- `MESH_TRANSPORT_CHUNK_PARALLELISM`
- `MESH_CAPSULE_MAX_TREE_SITTER_BYTES`
- `MESH_CAPSULE_MAX_TREE_WALK_NODES`
- `MESH_CAPSULE_MAX_SYMBOLS`
- `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES`

These control throughput and parser workload boundaries.

---

## 8) AI chat pipeline

Main endpoint: `POST /api/assistant/chat`

## 8.1 High-level flow

1. Normalize incoming messages.
2. Resolve referenced files via worker `chat` action; fallback to local and heuristic ranking.
3. Build adaptive context budget (`single-file`, `active-file`, `balanced`, `broad`).
4. Load capsule context entries and optional recovery spans.
5. Inject compressed context block into model messages.
6. Optionally inject codec context marker per session.
7. Route to provider (`runModelChat`) using credentials from secure user store.
8. Decode model response; if invalid, server-side codec recovery path.
9. Re-encode guaranteed compressed response (`contentCompressed`) and return decoded `content` too.

## 8.2 Codec/decode

- decode endpoint: `POST /api/assistant/codec/decode`
- frontend can decode compressed assistant payload for rendering
- transport telemetry includes codec mode, provider token usage, context budget mode.

## 8.3 Provider credentials

Provider keys are resolved server-side from encrypted user store, not trusted from client payload.

---

## 9) Assistant run engine (Edit/Agent)

Run APIs:

- `POST /api/assistant/runs`
- `GET /api/assistant/runs/:runId`
- `POST /api/assistant/runs/:runId/actions/:actionId`

Core behavior:

- plans are sanitized to supported action types,
- actions can require approval depending on autonomy mode,
- run artifacts include proposal batches, searches, terminal session IDs, etc.,
- proposal batches can be accepted/rejected and applied to workspace files.

Terminal APIs used by runs:

- `POST /api/assistant/terminal/session`
- `GET /api/assistant/terminal/session/:id/output`
- `POST /api/assistant/terminal/session/:id/input`
- `DELETE /api/assistant/terminal/session/:id`

---

## 10) Workbench UI composition

## 10.1 Base UI

`app.html` already contains:

- topbar controls,
- chat shell,
- explorer pane,
- code pane,
- operations/logs views,
- authentication overlay,
- large runtime script for indexing/chat/editor/ops.

## 10.2 Integrated VS Code-like shell

`assets/assistant-workbench.js` transforms AI view into a structured layout:

- activity bar,
- primary sidebar (Explorer/Search/Changes/Mesh Ops),
- central editor area + bottom panel (Terminal/Activity/Changes/Logs),
- secondary assistant sidebar.

It consumes `window.meshAssistantWorkbenchBridge` from `app.html`.

## 10.3 Pane resizing

Current UI supports drag resizing for:

- bottom panel height (`mesh-panel-resizer`),
- primary files sidebar width (`mesh-primary-resizer`),
- secondary assistant sidebar width (`mesh-secondary-resizer`).

---

## 11) Operations and policy subsystem

Gateway routes:

- `GET /api/app/ops`
- `GET /api/app/deployments`
- `POST /api/app/deployments`
- `POST /api/app/deployments/:id/action`
- `GET /api/app/policies`
- `POST /api/app/policies`
- `PUT /api/app/policies/:id`
- `GET /api/app/logs`
- `POST /api/app/logs`

Store:

- in-memory operational state with persisted JSON mirror (`.mesh-operations-store.json`),
- normalized deployment/policy records,
- region/risk/status metadata,
- bounded log retention.

---

## 12) Config reference (grouped)

## 12.1 Core runtime

- `PORT`
- `NODE_ENV`
- `MESH_CORE_URL`

## 12.2 Auth/session/cookies

- `MESH_AUTH_COOKIE_NAME`
- `MESH_AUTH_COOKIE_PATH`
- `MESH_AUTH_COOKIE_SAMESITE`
- `MESH_AUTH_COOKIE_SECURE`
- `MESH_AUTH_SESSION_TOUCH_INTERVAL_MS`

## 12.3 Workspace and queue

- `MESH_WORKSPACE_BROTLI_QUALITY`
- `MESH_TUNNEL_BROTLI_QUALITY`
- `MESH_WORKSPACE_INDEX_PARALLELISM`
- `MESH_WORKSPACE_SELECT_ASYNC_MODE`
- `MESH_WORKSPACE_SELECT_ASYNC_ENABLED`
- `MESH_WORKSPACE_SELECT_MAX_PENDING`
- `MESH_WORKSPACE_SELECT_JOB_TTL_MS`
- `MESH_WORKSPACE_SELECT_MAX_JOB_HISTORY`

## 12.4 Offload

- `MESH_AZURE_OFFLOAD_ENABLED`
- `MESH_AZURE_BLOB_BASE_URL`
- `MESH_AZURE_BLOB_CONTAINER`
- `MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN`
- `MESH_AZURE_BLOB_SAS_TOKEN`
- `MESH_AZURE_BLOB_INGEST_SAS_TOKEN`
- `MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES`
- `MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES`
- `MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS`
- `MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS`

## 12.5 Compression/capsules

- `MESH_TRANSPORT_CHUNK_PARALLELISM`
- `MESH_CAPSULE_MAX_TREE_SITTER_BYTES`
- `MESH_CAPSULE_MAX_TREE_WALK_NODES`
- `MESH_CAPSULE_MAX_SYMBOLS`
- `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES`

## 12.6 Secure DB

- `MESH_SECURE_DB_FILE`
- `MESH_SECURE_DB_JOURNAL_MODE`
- `MESH_SECURE_DB_COPY_LEGACY`
- `MESH_SECURE_DB_BUSY_TIMEOUT_MS`
- `MESH_DATA_ENCRYPTION_KEY`
- `AUTH_SECRET` (fallback source)

## 12.7 Provider keys

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

---

## 13) Deployment and operations workflow

Canonical source: `DEPLOY.md`

Standard pattern:

1. preflight checks (`node --check ...`),
2. verify secure-db settings (`MESH_SECURE_DB_FILE`, encryption key),
3. full zip deploy gateway (`--clean false`),
4. deploy worker if worker/compression changed,
5. smoke test auth/session/status/chat,
6. verify persistence marker survives restart.

Current practical hardening from this project state:

- gateway health check path `/healthz`,
- always-on + 64-bit worker process,
- gateway and worker split into separate plans for stability + throughput.

---

## 14) Test coverage snapshot

- `test/assistant-core.test.js`:
  path safety, query ranking, plan sanitization, structural edit fallback.
- `test/compression-core.test.js`:
  workspace record generation, legacy migration, transport recovery, tamper rejection.
- `test/assistant-integration.test.js`:
  fallback and worker-backed end-to-end workspace/run contracts.
- `test/compression-benchmark.test.js`:
  benchmark fixture coverage and baseline metrics.

Run all tests:

- `npm test`

---

## 15) Typical change map (where to edit what)

If you need to change auth/cookies/session behavior:

- `server.js` + `secure-db.js`

If you need to change workspace queueing/offload:

- `server.js` (queue/offload routes + helpers)
- `app.html` (chunk uploader + offload client logic)

If you need to change compression/capsules/recovery:

- `mesh-core/src/compression-core.cjs`
- possibly `mesh-core/src/server.js` and gateway fallback wrappers in `server.js`

If you need to change worker action handling:

- `mesh-core/src/server.js`

If you need to change main AI workbench behavior:

- `app.html` (bridge + base runtime)
- `assets/assistant-workbench.js` (integrated shell behavior)
- `assets/assistant-workbench.css` (layout/theme)

If you need to change shared ranking/path logic:

- `assistant-core.js`

---

## 16) Known constraints and trade-offs

- Gateway auth currently depends on SQLite persistence; multi-instance write contention is risky without moving to external session store.
- Worker is where horizontal scale pays off most (indexing/compression/mesh operations).
- The system intentionally has worker-unavailable fallbacks to keep UX operational.
- Compression/capsule quality vs throughput is governed by explicit env tunables.

---

## 17) Suggested next architectural step

For fully stateless horizontal gateway scale:

- move sessions from SQLite to Redis (or similar),
- keep user/profile store in managed SQL/Postgres,
- preserve encrypted-at-rest semantics and server-side key management.

This would remove single-instance gateway dependency while keeping current worker scale model.
