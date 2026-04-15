---
tags: [data]
---

# DynamoDB Data Model

Account: `960583973825`
Region: `us-east-1`

## Tables

| Table | Purpose | Partition Key | GSI |
|-------|---------|---------------|-----|
| `mesh-users` | User accounts | `id` | `email-index` (email → item) |
| `mesh-sessions` | Auth sessions | `id` | `userId-index` (userId → sessions) |
| `mesh-stores` | Per-user encrypted store | `id` | `userId-index` (userId → store rows) |

All tables use native DynamoDB TTL on the `ttl` attribute (epoch seconds). No manual pruning needed.

---

## `mesh-users` — User Accounts

```json
{
  "id": "user-edgar-demo",
  "userId": "user-edgar-demo",
  "email": "edgar@test.com",
  "name": "Edgar",
  "role": "operator",
  "passwordHash": "<salt_hex>:<scrypt_hash_hex>",
  "createdAt": "2026-04-15T13:17:04Z",
  "updatedAt": "2026-04-15T13:17:04Z"
}
```

Password hashing: `crypto.scryptSync(password, salt, 64)`, stored as `saltHex:hashHex`.

---

## `mesh-sessions` — Auth Sessions

```json
{
  "id": "<sha256 of raw token>",
  "userId": "user-edgar-demo",
  "createdAt": 1744723024000,
  "lastSeenAt": 1744723024000,
  "expiresAt": 1745327824000,
  "ttl": 1745327824,
  "userAgent": "Mozilla/5.0 ...",
  "ipAddress": "1.2.3.4",
  "label": ""
}
```

- Raw session token is never stored — only its SHA-256 hash
- `ttl` is epoch seconds → DynamoDB auto-deletes expired sessions
- Session TTL: 14 days from login

---

## `mesh-stores` — Per-User Encrypted Store

```json
{
  "id": "user-edgar-demo:meshAiAnthropic",
  "userId": "user-edgar-demo",
  "storeKey": "meshAiAnthropic",
  "payloadEnc": "<AES-256-GCM encrypted base64>",
  "updatedAt": "2026-04-15T13:17:04Z"
}
```

- `payloadEnc` is AES-256-GCM encrypted JSON, keyed from `MESH_DATA_ENCRYPTION_KEY`
- Encryption format: `[version_byte][iv_12b][auth_tag_16b][ciphertext]` → base64
- Store keys (storeKey values): `meshAiAnthropic`, `meshAiOpenAI`, `meshAiGoogle`, `meshAiByok`, `meshAiBehaviour`, `meshByokModelRegistry`, `meshApiKeys`, `meshAppearance`, `meshSwitches`, `meshAccountProfile`, `meshWorkspaceConfig`, `meshSecurityBaseline`, `meshBillingContact`, `meshBillingState`, `meshIntegrations`

---

## GSI Requirements

Both `mesh-sessions` and `mesh-stores` require a `userId-index` GSI for listing sessions/store by user:

```
GSI: userId-index
  Partition key: userId (String)
  Projection: ALL
```

`mesh-users` requires an `email-index` GSI for login lookups:

```
GSI: email-index
  Partition key: email (String)
  Projection: ALL
```

---

## Implementation

`secure-db.js` is the abstraction layer:

- `getUserByEmail(email)` — queries `mesh-users` via `email-index` GSI
- `getUserById(id)` — `GetCommand` on `mesh-users` by `id`
- `upsertUser(user)` — `PutCommand` to `mesh-users`
- `createSession(userId, ttlMs)` — `PutCommand` to `mesh-sessions`
- `readSession(rawToken)` — `GetCommand` on `mesh-sessions` by hashed token
- `listSessionsByUser(userId)` — queries `mesh-sessions` via `userId-index` GSI
- `getUserStoreValues(userId, keys)` — queries `mesh-stores` via `userId-index` GSI
- `setUserStoreValue(userId, key, value)` — `PutCommand` to `mesh-stores`
