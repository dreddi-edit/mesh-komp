---
tags: [architecture]
---

# Authentication

## Files

| File | Role |
|------|------|
| `src/core/auth.js` | Password hashing, session lifecycle, `requireAuth` middleware, BYOK normalization, user-store key allowlist |
| `src/routes/auth.routes.js` | Login, session inspection, logout, session-revoke endpoints |
| `secure-db.js` | Encrypted SQLite persistence for users, sessions, and user store values |

## Session Model

- Sessions created at login, stored in `secure-db.js`
- `requireAuth` middleware protects all `/api/assistant/*` and settings routes
- Session passed via `httpOnly` cookie
- Session revocation available via `POST /api/auth/sessions/revoke`

## Auth Routes

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/login` | Login with email + password |
| `GET` | `/api/auth/session` | Inspect current session |
| `POST` | `/api/auth/logout` | Destroy session |
| `POST` | `/api/auth/sessions/revoke` | Revoke a specific session |

## Secure Database (`secure-db.js`)

Encrypted SQLite file for:
- Users (email, password hash)
- Sessions (token, userId, created, last seen)
- Per-user store values (API keys, settings, preferences)

**Production path:** `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`

The file must be on **persistent storage** (`/home/data/` on Azure App Service). If it resolves to the app root (`/home/site/wwwroot`), data will be lost on redeploy.

**Encryption key:** `MESH_DATA_ENCRYPTION_KEY` — must never be rotated casually. Rotating it makes all existing encrypted rows unreadable.

## BYOK (Bring Your Own Key)

Users can supply their own AI provider keys:
- Anthropic, OpenAI, Google, Azure OpenAI
- Stored encrypted in the user store
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
