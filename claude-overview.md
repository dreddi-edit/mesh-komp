# Claude Overview: Mesh-Komp System Architecture

Last updated: 2026-04-15
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

- Gateway: EC2 t2.micro at `50.16.15.217`, managed by PM2
- Public domain: `try-mesh.com` (DNS via Cloudflare → EC2)

### 2.2 Infrastructure

- **Compute**: AWS EC2 t2.micro (us-east-1, free tier)
- **Database**: AWS DynamoDB — `mesh-users`, `mesh-sessions`, `mesh-stores`
- **AI**: AWS Bedrock (Claude Sonnet 4.6 via IAM user `mesh-bedrock-access`)
- **Voice**: Amazon Transcribe (STT) + Amazon Polly (TTS)
- **Storage**: S3 bucket `mesh-workspace-offload-960583973825` (offload optional)
- **CI/CD**: GitHub Actions → rsync to EC2 → PM2 restart

### 2.3 Cross-service call

- Gateway calls worker tunnel endpoint via `MESH_CORE_URL`.
- Worker exposes `/mesh/tunnel` using brotli-compressed action envelopes.

---

## 3) Repository map (important files and folders)

## 3.1 Root

- `server.js`: gateway API, auth, workspace fallback, terminal sessions.
- `src/server.js`: express app setup, global exposure, route mounting.
- `src/config/index.js`: centralized config validation (all env vars validated at startup).
- `secure-db.js`: DynamoDB-backed persistence for users/sessions/user_store (with in-memory fallback for dev).
- `assistant-core.js`: shared scoring/ranking/path-safety/plan/action utilities.
- `llm-compress.js`: heuristic compressor (modes: smart/skeleton/llm80), `pseudo()` for symbol summaries.
- `DEPLOY.md`: canonical deployment runbook.
- `package.json`: dependencies/scripts.

## 3.2 Core Modules (extracted April 2026)

- `src/core/index.js`: main backend aggregator.
- `src/core/model-providers.js`: AI model constants, provider calls (Anthropic/OpenAI/Gemini/BYOK/Azure BYOK), system prompt, codec.
- `src/core/mesh-codec.js`: ROT47 transforms, token dictionary encode/decode, codec session state.
- `src/core/workspace-context.js`: capsule context loading, prompt assembly, prefix stability, codec injection.
- `src/core/operations-store.js`: operations/deployments/policies state management.
- `src/core/assistant-runs.js`: run planning and execution.
- `src/core/auth.js`: authentication logic.
- `src/core/voice-agent.js`: voice agent tool loop.
- `src/core/voice-aws-audio.js`: AWS STT/TTS integration (Amazon Transcribe + Polly).

## 3.3 Routes (refactored April 2026)

- `src/routes/assistant.routes.js`: workspace CRUD, file ops, recovery, offload.
- `src/routes/assistant-chat.routes.js`: chat/run flows (extracted from assistant.routes.js).
- `src/routes/assistant-git.routes.js`: git operations (extracted from assistant.routes.js).
- `src/routes/auth.routes.js`: auth endpoints.
- `src/routes/app.routes.js`: app/settings page routes.
- `src/routes/realtime.routes.js`: voice websocket.
- `src/routes/terminal.routes.js`: terminal websocket.

## 3.4 Worker

- `mesh-core/src/server.js`: worker process, `/mesh/tunnel`, workspace CRUD/search/grep/chat mock.
- `mesh-core/src/compression-core.cjs`: core compression, capsule generation, transport envelope, recovery, workspace budget allocation.
- `mesh-core/src/workspace-operations.js`: workspace indexing, delta-rebuild, budget integration.
- `mesh-core/src/MeshServer.js`: brotli transport helper + optional minification.

## 3.5 Frontend assets

- `views/app.html`: main workbench shell (renamed from root `app.html`).
- `views/index.html`, `views/docs.html`, `views/how-it-works.html`: landing pages.
- `assets/app-workspace.js`: main browser runtime for the app shell.
- `assets/app-workspace.css`: app shell styling.
- `assets/app-graph.js`: dependency graph renderer.
- `assets/features/voice-chat.js`: voice surface browser runtime.
- `assets/settings.js`, `assets/settings-combined.js`: settings page scripts.

## 3.6 Tests

- `test/assistant-core.test.js`
- `test/assistant-integration.test.js`
- `test/compression-core.test.js`
- `test/compression-benchmark.test.js`
- `test/model-providers.test.js`
- `test/realtime-routes.test.js`

---

## 4) End-to-end architecture

## 4.1 Browser -> Gateway

`app.html` is the main orchestrator and talks to gateway endpoints via `requestJson(...)`.

Key responsibilities in frontend runtime:

- auth session bootstrap (`/api/auth/session`),
- workspace upload/indexing with manifest + chunking,
- optional S3 offload bootstrap and ingest path,
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

`secure-db.js` persists to DynamoDB (or in-memory in dev):

- `mesh-users` — users table with `email-index` GSI
- `mesh-sessions` — sessions table with `userId-index` GSI
- `mesh-stores` — per-user store with `userId-index` GSI

Features:

- AES-256-GCM encrypted `user_store` payloads,
- email normalization,
- upsert semantics,
- DynamoDB native TTL for session expiry,
- in-memory fallback when `MESH_DYNAMO_ENABLED=false`.

## 5.3 DynamoDB configuration

Key env vars:

- `MESH_DYNAMO_ENABLED` — set to `true` to use DynamoDB
- `MESH_DYNAMO_TABLE_PREFIX` — table name prefix (default: `mesh`)
- `MESH_DATA_ENCRYPTION_KEY` — AES-256 key for user store payloads; never rotate

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

If S3 offload is configured (`MESH_S3_OFFLOAD_ENABLED=true`):

- browser uploads chunk JSON to S3,
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
- `pseudo()` integration: symbols use LLM-readable pseudocode from `llm-compress.js` when available,
- specialized capsules for config/sql/markup/docs/text fallback,
- focused capsule generation based on user query scoring.

## 7.4 Compression optimizations (April 2026)

- **Tiny-passthrough**: files ≤150 tokens bypass capsule pipeline entirely, raw text with minimal header.
- **Compact header**: ultra-tier uses single-line `CAP` header (~12 tokens vs ~50 for 3-line CAPSULE header).
- **Delta-rebuild**: SHA-256 digest comparison skips unchanged files during workspace re-indexing.
- **Prefix stability**: capsule entries sorted alphabetically, stable/dynamic split for LLM KV-cache optimization.
- **Workspace budget**: global token budget (default 8000, `MESH_WORKSPACE_TOKEN_BUDGET`) distributed proportionally by file importance.
- **lean mode removed**: `llm-compress.js` modes are now `smart`, `skeleton`, `llm80`.

## 7.5 Performance controls

Important tunables include:

- `MESH_TRANSPORT_CHUNK_PARALLELISM`
- `MESH_CAPSULE_MAX_TREE_SITTER_BYTES`
- `MESH_CAPSULE_MAX_TREE_WALK_NODES`
- `MESH_CAPSULE_MAX_SYMBOLS`
- `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES`
- `MESH_WORKSPACE_TOKEN_BUDGET` (default 8000)

These control throughput, parser workload boundaries, and context budget allocation.

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

## 12.4 S3 Offload (optional)

- `MESH_S3_OFFLOAD_ENABLED`
- `MESH_S3_BUCKET`
- `MESH_S3_PREFIX`
- `MESH_S3_OFFLOAD_MAX_CHUNK_FILES`
- `MESH_S3_OFFLOAD_MAX_CHUNK_BYTES`
- `MESH_S3_OFFLOAD_MAX_PARALLEL_READS`
- `MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS`

## 12.5 Compression/capsules

- `MESH_TRANSPORT_CHUNK_PARALLELISM`
- `MESH_CAPSULE_MAX_TREE_SITTER_BYTES`
- `MESH_CAPSULE_MAX_TREE_WALK_NODES`
- `MESH_CAPSULE_MAX_SYMBOLS`
- `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES`
- `MESH_WORKSPACE_TOKEN_BUDGET` (default 8000)

## 12.6 DynamoDB / secure DB

- `MESH_DYNAMO_ENABLED`
- `MESH_DYNAMO_TABLE_PREFIX`
- `MESH_DYNAMO_USERS_TABLE`
- `MESH_DYNAMO_SESSIONS_TABLE`
- `MESH_DYNAMO_STORES_TABLE`
- `MESH_DATA_ENCRYPTION_KEY`
- `AUTH_SECRET` (fallback source)

## 12.7 AWS credentials

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION_BEDROCK`

## 12.8 Voice (AWS-native)

- `MESH_VOICE_TRANSCRIBE_LANGUAGE` (default: `en-US`)
- `MESH_VOICE_POLLY_VOICE` (default: `Joanna`)
- `MESH_VOICE_POLLY_ENGINE` (default: `neural`)

## 12.9 Provider keys

- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_API_KEY`

---

## 13) Deployment and operations workflow

Canonical source: `DEPLOY.md`

Standard pattern:

1. push to `main` — GitHub Actions rsync to EC2 + PM2 restart,
2. or manually: rsync + `pm2 restart mesh-gateway --update-env`,
3. smoke test: `curl https://try-mesh.com/healthz` — expect `authStoreOk: true`.

PM2 process manager:

- process name: `mesh-gateway`
- entry: `/home/ec2-user/app/src/server.js`
- node args: `--env-file /home/ec2-user/app/.env`
- cwd: `/home/ec2-user/app`
- data: `/home/ec2-user/data/mesh-secure-v2.db` (SQLite workspace fallback)

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

- Worker is where horizontal scale pays off most (indexing/compression/mesh operations).
- The system intentionally has worker-unavailable fallbacks to keep UX operational.
- Compression/capsule quality vs throughput is governed by explicit env tunables.

---

## 17) Suggested next architectural step

For fully stateless horizontal gateway scale:

- move sessions from DynamoDB to Redis (or similar) for sub-millisecond reads,
- keep user/profile store in DynamoDB,
- preserve encrypted-at-rest semantics and server-side key management.

This would remove single-instance gateway dependency while keeping current worker scale model.
