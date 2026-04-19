---
phase: 27
plan: "01"
title: "OpenAPI Documentation"
status: complete
started: 2026-04-17T02:30:00Z
completed: 2026-04-17T03:00:00Z
---

# Summary: 27-01 OpenAPI Documentation

## What was built

### Task 1: Create OpenAPI spec — DONE
- `src/api-docs/openapi.yaml`: Full OpenAPI 3.0 spec covering all /api/* routes:
  - **Auth** (6 routes): login, logout, session, list sessions, revoke sessions, CSRF token
  - **Workspace** (12 routes): status, select, jobs, files, file CRUD, graph, sync, rename, batch, reindex, search, grep
  - **Chat** (4 routes): non-streaming chat, SSE streaming, codec decode, inline complete
  - **Git** (12 routes): status, branches, diff, log, checkout, stage, commit, push, pull, stash, clone, create-branch, delete-branch
  - **Health** (1 route): /healthz
- Components: reusable schemas (OkTrue, ErrorResponse, User, Session, WorkspaceStatus, ChatMessage, GitStatus)
- Security schemes: cookieAuth (httpOnly cookie) and csrfToken (header)
- Response envelopes match actual `{ ok: true/false }` API format

### Task 2: Serve Swagger UI — DONE
- Installed `swagger-ui-express` and `yamljs` — added to package.json dependencies
- `src/api-docs/serve.js`: `mountApiDocs(app)` loads the spec via YAML.load and mounts at /api/docs
- `src/server.js`: `mountApiDocs(app)` called before route handlers

## Key files
- `src/api-docs/openapi.yaml` — OpenAPI 3.0 specification
- `src/api-docs/serve.js` — Swagger UI mount helper
- `src/server.js` — `mountApiDocs` call added

## Self-Check: PASSED
- `grep "openapi: 3" src/api-docs/openapi.yaml` — matches
- `grep "/api/auth/login" src/api-docs/openapi.yaml` — matches
- `grep "/api/assistant/workspace" src/api-docs/openapi.yaml` — 12 matches
- `grep "/api/assistant/chat" src/api-docs/openapi.yaml` — 3 matches
- `grep "/api/assistant/git" src/api-docs/openapi.yaml` — 13 matches
- `grep "swagger-ui-express" package.json` — matches
- `grep "mountApiDocs" src/server.js` — 2 matches (require + call)
- npm test: 3858 pass, 22 fail (all pre-existing)
