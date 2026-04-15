---
tags: [architecture]
---

# Authentication

## Files

| File | Role |
|------|------|
| `src/core/auth.js` | Password hashing, session lifecycle, `requireAuth` middleware, BYOK normalization, user-store key allowlist |
| `src/routes/auth.routes.js` | Login, session inspection, logout, session-revoke endpoints |
| `secure-db.js` | DynamoDB-backed persistence for users, sessions, and user store values |

## Session Model

- Sessions created at login, stored in DynamoDB (`mesh-sessions`)
- `requireAuth` middleware protects all `/api/assistant/*` and settings routes
- Session passed via `httpOnly` cookie
- Session revocation available via `POST /api/auth/sessions/revoke`
- DynamoDB native TTL handles session expiry automatically (no manual pruning)

## Auth Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Login with email + password |
| `GET` | `/api/auth/session` | Inspect current session |
| `POST` | `/api/auth/logout` | Destroy session |
| `POST` | `/api/auth/sessions/revoke` | Revoke a specific session |

## Secure Database (`secure-db.js`)

DynamoDB-backed persistence for:
- Users (`mesh-users`) — email, password hash, role
- Sessions (`mesh-sessions`) — token hash, userId, created, last seen, TTL
- Per-user store values (`mesh-stores`) — AES-256-GCM encrypted key-value pairs

**DynamoDB tables** (all in `us-east-1`):

| Table | PK | GSI |
|-------|-----|-----|
| `mesh-users` | `id` | `email-index` (email → item) |
| `mesh-sessions` | `id` | `userId-index` (userId → sessions) |
| `mesh-stores` | `id` | `userId-index` (userId → store rows) |

Controlled by env vars:
- `MESH_DYNAMO_ENABLED=true` — enable DynamoDB (in-memory fallback if false)
- `MESH_DYNAMO_TABLE_PREFIX=mesh` — table name prefix

**Encryption key:** `MESH_DATA_ENCRYPTION_KEY` — must never be rotated casually. Rotating it makes all existing encrypted user store rows unreadable.

## BYOK (Bring Your Own Key)

Users can supply their own AI provider keys:
- Anthropic, OpenAI, Google, Azure OpenAI (user-side BYOK)
- Stored encrypted in the user store (`mesh-stores`)
- `auth.js` normalizes BYOK credentials at call time
- Validation endpoint: `POST /api/byok/validate`

User-store keys for AI:
```
meshAiAnthropic
meshAiOpenAI
meshAiGoogle
meshAiByok
meshAiBehaviour
meshByokModelRegistry
```

## Auth Overlay

`views/app.html` contains an auth overlay with:
- Login form (email + password)
- Mesh logo
- Error display

The overlay resolves on successful login; the main app shell renders behind it.
