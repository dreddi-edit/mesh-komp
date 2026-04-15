## RESEARCH COMPLETE

# Phase 9 Research: In-Process Caching

## Standard Stack

Pure in-process `Map` with TTL — no external dependencies. Identical pattern to
`inferFilesCache` in `src/core/workspace-ops.js:1552-1605`. Zero infrastructure
changes. Two caches added to `src/core/auth.js`.

---

## Architecture Patterns

### The inferFilesCache Pattern (exact replication target)

```js
const THING_CACHE_TTL_MS = 30_000;   // configurable per cache
const THING_CACHE_MAX    = 50;        // prevents unbounded growth
const thingCache = new Map();         // key → { result, ts }

function pruneThingCache() {
  if (thingCache.size <= THING_CACHE_MAX) return;
  const cutoff = Date.now() - THING_CACHE_TTL_MS;
  for (const [key, entry] of thingCache) {
    if (entry.ts < cutoff || thingCache.size > THING_CACHE_MAX) {
      thingCache.delete(key);
    }
  }
}

async function expensiveFn(input) {
  const cached = thingCache.get(input);
  if (cached && Date.now() - cached.ts < THING_CACHE_TTL_MS) {
    return cached.result;
  }
  const result = await doExpensiveWork(input);
  thingCache.set(input, { result, ts: Date.now() });
  pruneThingCache();
  return result;
}
```

---

## Cache Design

### Cache 1: Session Resolution Cache

**Target function:** `resolveAuthUserFromRequest` in `src/core/auth.js:261`

**What it saves:** 2 DynamoDB calls per authenticated request
- `secureDb.readSession(token)` (line 266)
- `secureDb.getUserById(session.userId)` (line 281)

**Cache key:** Raw token string (already a secret stored in httpOnly cookie — no
additional hashing needed; hashing adds ~0.1ms CPU with no security benefit since
we're operating server-side in trusted memory).

**TTL:** 30 seconds — safe because:
- Session TTL is 14 days; a 30s window is negligible
- The expiry check MUST still run on every cache hit (see Security note below)
- `touchSession` side effect must still run when the touch interval has elapsed

**Cache value:** `{ token, user, session }` — the full resolved object returned by
`resolveAuthUserFromRequest`, identical shape to current return value.

**Security requirement — expiry check on cache hit:**
```js
// Even on cache hit, must re-validate expiry:
if (Number(cached.result.session.expiresAt || 0) <= Date.now()) {
  sessionCache.delete(token);        // evict stale entry
  await secureDb.deleteSession(token);
  return null;
}
```
A 30s TTL cache can serve a session whose DynamoDB record was deleted (logout from
another tab) or whose expiresAt just passed. The expiry re-check on every cache hit
closes this window without a DB call.

**touchSession side effect — must be preserved:**
`resolveAuthUserFromRequest` lines 276-279 touch the session in DynamoDB when
`nowMs - lastSeenAt >= AUTH_SESSION_TOUCH_INTERVAL_MS`. On a cache hit we have
the cached session object which still carries `lastSeenAt`. The touch logic must
still execute against the real DB when the interval has elapsed. This is acceptable
— the touch is infrequent (default interval is large) and correctness requires it.

**Max entries:** 100 (generous; in practice ≤ concurrent active users)

---

### Cache 2: Credential Cache

**Target function:** `getStoredCredentialsForUser` in `src/core/auth.js:371`

**What it saves:** 1 DynamoDB GSI Query per `/api/assistant/chat` call
- `secureDb.getUserStoreValues(userId, [...5 keys...])` (line 372) — scans
  `DYNAMO_STORES_TABLE` with a GSI query, fetches up to 5 store items.

**Cache key:** `userId` string — credentials are per-user and change only on
explicit settings update.

**TTL:** 60 seconds — credentials change rarely (user opens settings and saves);
60s stale window is acceptable. If user updates credentials, the cache must be
immediately invalidated (see Invalidation Points below).

**Cache value:** The full normalized credentials object returned by
`getStoredCredentialsForUser`.

**Max entries:** 100

---

## Invalidation Points

### Session cache invalidation

The session cache must be invalidated (entry deleted by token) at:

| Location | Event | How |
|----------|-------|-----|
| `src/routes/auth.routes.js:229` | `POST /api/auth/logout` | `deleteSession(token)` already called — add `invalidateSessionCache(token)` after |
| `src/routes/auth.routes.js:193` | `POST /api/auth/sessions/revoke` mode="all" | After `deleteSessionsByUser` — must clear ALL session cache entries for this user. Need `invalidateSessionCacheForUser(userId)` helper |
| `src/routes/auth.routes.js:199` | `POST /api/auth/sessions/revoke` mode="others" | Same — clear all session cache entries for user except current |
| `src/routes/auth.routes.js:210` | `POST /api/auth/sessions/revoke` mode="single" | Clear single entry: `invalidateSessionCache(token by sessionId)` — but we only have sessionId, not token. Safest: `invalidateSessionCacheForUser(userId)` (clears all for user) |

**Implementation:** Export two helpers from `auth.js`:
```js
function invalidateSessionCache(token) {
  sessionCache.delete(String(token || ''));
}
function invalidateSessionCacheForUser(userId) {
  for (const [key, entry] of sessionCache) {
    if (entry.result?.user?.id === userId) sessionCache.delete(key);
  }
}
```

### Credential cache invalidation

**Single invalidation point:**

`src/routes/app.routes.js:360` — `PUT /api/user/store/:key`

This is the ONLY route that writes to the user store. It calls
`secureDb.setUserStoreValue(req.authUser.id, key, value)` at line 388.

The credential cache must be invalidated when `key` is one of the BYOK credential
keys: `meshAiAnthropic`, `meshAiOpenAI`, `meshAiGoogle`, `meshAiByok`,
`meshByokModelRegistry`.

Since `normalizeUserStoreKey` already validates the key, and ANY store write could
affect credentials, the simplest correct approach is: always call
`invalidateCredentialCache(req.authUser.id)` after every successful
`setUserStoreValue` call, regardless of key. This is safe and avoids a secondary
key-filter.

**Export from auth.js:**
```js
function invalidateCredentialCache(userId) {
  credentialCache.delete(String(userId || ''));
}
```

---

## New Exports from auth.js

Three new exports needed:

```js
module.exports = {
  // ... all existing exports ...
  invalidateSessionCache,        // (token: string) => void
  invalidateSessionCacheForUser, // (userId: string) => void
  invalidateCredentialCache,     // (userId: string) => void
};
```

These need to be available in:
- `src/routes/auth.routes.js` — via the `core` object passed to `createAuthRouter`
- `src/routes/app.routes.js` — via the `core` object passed to `createAppRouter`

Both routers receive `core` (the export of `src/core/index.js`), which re-exports
everything from `auth.js`. So the chain is:
`auth.js` → `src/core/index.js` exports → `createAuthRouter(core)` / `createAppRouter(core)`

---

## Don't Hand-Roll

- **Do NOT use `node-cache`, `lru-cache`, or any npm package** — the `inferFilesCache`
  Map pattern is sufficient, already established in the codebase, and adds zero deps.
- **Do NOT use `setTimeout` for TTL cleanup** — the prune-on-set approach is correct
  and already proven.
- **Do NOT skip the expiry re-check on session cache hits** — this is a security
  requirement, not a performance choice.

---

## Common Pitfalls

1. **Skipping expiry re-check on cache hit** — stale cache would serve expired
   sessions. Always re-check `session.expiresAt > Date.now()` on every hit.

2. **Forgetting touchSession on cache hit** — the `lastSeenAt` touch keeps sessions
   alive and tracks activity. Must still fire when `nowMs - cachedSession.lastSeenAt
   >= AUTH_SESSION_TOUCH_INTERVAL_MS`.

3. **Not invalidating session cache on revoke-all** — `POST /api/auth/sessions/revoke`
   with `mode=all` calls `deleteSessionsByUser` which removes all DB records, but
   without cache invalidation those tokens would still resolve for up to 30s.

4. **Token collision in credential cache** — credential cache key is `userId` (not
   token). Multiple active sessions for the same user share one credential cache
   entry. This is correct: credentials are per-user, not per-session.

5. **Cache not exported to route handlers** — the invalidation functions must be
   exported from `auth.js` and re-exported from `src/core/index.js` so route handlers
   can call them. Easy to miss.

---

## Test Approach

Without mocking DynamoDB internals:

**Strategy: call counter instrumentation**

Add a module-level call counter to `secureDb.readSession` in tests using a wrapper
function, call the cached function twice with the same token, assert the counter is
1 not 2.

```js
// In test: wrap secureDb to count calls
let callCount = 0;
const origReadSession = secureDb.readSession.bind(secureDb);
secureDb.readSession = async (token) => {
  callCount++;
  return origReadSession(token);
};

// Call resolveAuthUserFromRequest twice
await resolveAuthUserFromRequest(mockReq);
await resolveAuthUserFromRequest(mockReq);

assert.equal(callCount, 1, 'readSession should only be called once (cache hit on second call)');
```

**Invalidation test:** after calling `invalidateSessionCache(token)`, assert that
the next call to `resolveAuthUserFromRequest` increments the counter again.

**TTL expiry test:** set `CACHE_TTL_MS` to a short value (e.g., 10ms) in test
environment, wait 15ms, assert that the next call goes to DynamoDB again.

---

## Validation Architecture

### Nyquist Validation Dimensions

| Dimension | Check |
|-----------|-------|
| D1 — Functional | Session cache returns correct user/session object on hit |
| D2 — Functional | Credential cache returns correct normalized credentials on hit |
| D3 — Security | Expired session evicted and returns null even on cache hit |
| D4 — Security | Logout invalidates session cache immediately |
| D5 — Security | Credential update (PUT /api/user/store/:key) invalidates credential cache |
| D6 — Performance | Zero DynamoDB calls on second resolveAuthUserFromRequest within TTL |
| D7 — Performance | Zero DynamoDB calls on second getStoredCredentialsForUser within TTL |
| D8 — Regression | Existing auth tests (test/security-integration.test.js) still pass |
