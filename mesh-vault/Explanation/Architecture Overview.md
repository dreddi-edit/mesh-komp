---
tags: [explanation, intro, architecture]
---

# Architecture Overview

> A simplified walkthrough of how Mesh is built — for someone familiar with web apps but new to this codebase.

---

## Big Picture

```
Browser (you)
    │
    │  HTTPS + WebSocket
    ▼
EC2 Gateway (Node.js / Express 5)
    │
    ├──► Auth + Sessions  →  DynamoDB
    │
    ├──► AI Chat          →  AWS Bedrock (Claude Sonnet 4.6)
    │                          uses capsule context from workspace
    │
    ├──► Voice            →  Amazon Transcribe (speech → text)
    │                     →  AWS Bedrock (tool loop)
    │                     →  Amazon Polly (text → speech)
    │
    ├──► Workspace Ops    →  mesh-core worker (compression, indexing)
    │
    └──► File Storage     →  S3 (optional workspace offload)
```

Everything runs on a single EC2 t2.micro. The "gateway" and "worker" are the same process — `MESH_CORE_URL` points to `localhost` in production.

---

## The Two Moving Parts

### Gateway (`src/server.js`)
Handles HTTP and WebSocket traffic. It:
- Serves all HTML pages (`views/`)
- Handles login, sessions, user data via DynamoDB
- Proxies AI and workspace requests to the worker
- Runs the voice WebSocket at `/api/realtime`

### Worker (`mesh-core/`)
Does the heavy computation:
- Parses source files with tree-sitter
- Builds and serializes capsules
- Handles focused capsule queries
- Compresses wire payloads (zstd/Brotli)

---

## Request Flow: AI Chat

1. You type a message in the editor chat panel
2. Browser sends `POST /api/assistant/chat` with your message + active workspace path
3. Gateway loads the capsule for the workspace (calls worker)
4. Capsule context is prepended to the system prompt
5. Request goes to AWS Bedrock (Claude Sonnet 4.6)
6. Response streams back to the browser via SSE
7. If the AI requests a specific file span, the gateway fetches it from the worker and continues the tool loop

---

## How Capsules Are Stored

Each indexed file produces three artifacts stored in memory (and optionally on S3):

| Artifact | Contents | Size |
|----------|----------|------|
| Capsule | Tiered structural summary | ~5–10% of raw |
| Span index | Byte offset map for recovery | tiny |
| Transport bundle | zstd/Brotli compressed capsule | ~8–12% of raw |

These are generated once when a workspace is imported and updated when files change.

---

## Auth and User Data

- Login creates a session stored in DynamoDB (`mesh-sessions` table)
- User settings and encrypted API keys live in `mesh-stores`
- API keys are encrypted with AES-256-GCM before storage
- The encryption key (`MESH_DATA_ENCRYPTION_KEY`) lives only in the server's `.env` — never in code

---

## What's Not Here

Mesh is intentionally simple:
- **No database besides DynamoDB** — no Postgres, no Redis
- **No microservices** — one Node process, managed by PM2 in cluster mode
- **No build step for the frontend** — vanilla HTML/CSS/JS, served directly
- **No Docker** — rsync deploy directly to EC2, PM2 handles restarts

---

*Previous: [[What is Mesh]]*
*Next: [[../Architecture/System Architecture]] — full technical architecture*
*Deep dive: [[../Architecture/Compression Pipeline]] — capsule generation internals*
