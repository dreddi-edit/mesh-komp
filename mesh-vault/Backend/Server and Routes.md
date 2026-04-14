---
tags: [backend]
---

# Server and Routes

## Entry Points

```
server.js           ← tiny bootstrap, starts src/server.js
src/server.js       ← main Express/http server
```

`server.js` just requires `src/server.js`. The real work happens there.

## `src/server.js` Responsibilities

- Express setup and middleware
- Security headers (`X-Content-Type-Options`, `X-Frame-Options`, `CSP`, `Referrer-Policy`)
- CSRF protection (Origin/Referer check for all state-mutating requests)
- Request ID middleware (attaches `req.requestId` UUID for log correlation)
- Static file serving from repo root (for `assets/`, `views/`)
- Clean URL routing via pre-built Map at startup (eliminates `fs.existsSync` on every request)
- Route module mounting (passes `core` to factory functions — no `global.*`)
- Terminal WebSocket setup via `setupTerminalRelay(server, { projectRoot, core })`
- Voice realtime WebSocket relay via `setupRealtimeRelay(server, core)`

## Route Modules

| File | Prefix | Purpose |
|------|--------|---------|
| `src/routes/auth.routes.js` | `/api/auth` | Login, session, logout, revoke |
| `src/routes/app.routes.js` | `/api/app`, `/api/user`, `/api/docs`, `/api/byok` | User store, billing, operations, logs, repo-docs, BYOK |
| `src/routes/assistant.routes.js` | `/api/assistant` | Workspace, context, graph, sync, file ops |
| `src/routes/assistant-chat.routes.js` | `/api/assistant` | Chat and run endpoints (extracted from assistant.routes.js) |
| `src/routes/assistant-git.routes.js` | `/api/assistant` | Git endpoints: status, diff, commit, push, pull (extracted from assistant.routes.js) |
| `src/routes/realtime.routes.js` | `/api/realtime` | Voice WebSocket session |

## Key API Endpoints

### Auth
```
POST /api/auth/login
GET  /api/auth/session
POST /api/auth/logout
GET  /api/auth/sessions
POST /api/auth/sessions/revoke
```

### User / Settings
```
GET  /api/user/store
PUT  /api/user/store/:key
GET  /api/app/billing/summary
GET  /api/app/billing/invoices/:id/download
POST /api/byok/validate
```

### Assistant / Workspace
```
GET  /api/assistant/status
GET  /api/assistant/workspace/offload-config
POST /api/assistant/workspace/select
POST /api/assistant/workspace/offload/ingest
GET  /api/assistant/workspace/files
GET  /api/assistant/workspace/graph
GET  /api/assistant/workspace/file
POST /api/assistant/workspace/sync
POST /api/assistant/workspace/recovery
POST /api/assistant/workspace/file/create
POST /api/assistant/workspace/file/save
POST /api/assistant/workspace/file/rename
DELETE /api/assistant/workspace/file
POST /api/assistant/workspace/batch
GET  /api/assistant/workspace/search
GET  /api/assistant/workspace/grep
GET  /api/assistant/workspace/context-budget
POST /api/assistant/chat
POST /api/assistant/run
```

### Voice
```
WS  /api/realtime    ← PCM audio stream, VAD, STT, TTS
WS  /terminal        ← pty shell session
```

### Repo Docs
```
GET /api/docs/index
GET /api/docs/file
```

## Security Layer

All security middleware runs before routes in `src/server.js`:

| Middleware | Purpose |
|-----------|---------|
| Request ID | UUID per request for log correlation (`req.requestId`) |
| Security headers | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| CSRF guard | Rejects cross-origin `POST/PUT/PATCH/DELETE` via Origin/Referer check |
| Rate limiter | `src/middleware/rate-limiter.js` — applied to auth and public endpoints |
| XSS sanitization | Input sanitization on user-facing endpoints |
| JSON body limit | Global 1 MB default; `/api/assistant/workspace/offload/ingest` overrides to 200 MB |

Configuration is centralized in `src/config/index.js` — validates all env vars at startup and exports typed values. No `process.env` reads in business logic.

Structured logging via `src/logger.js` (newline-delimited JSON, `LOG_LEVEL` env var, stdout/stderr by level).

## Terminal WebSocket

Server side uses `node-pty` to spawn a real shell.

CWD resolution:
1. If local-path workspace active → use real `rootPath`
2. If upload workspace active → materialize to temp dir under `MESH_TERMINAL_UPLOAD_ROOT`
3. Otherwise → fall back to project root

## `src/routes/assistant.routes.js` — Routing Logic

For most workspace operations:
1. Try `meshTunnelRequest(...)` to forward to Worker
2. If Worker unavailable → execute fallback from `src/core/index.js` locals

This means every workspace endpoint has a dual execution path.
