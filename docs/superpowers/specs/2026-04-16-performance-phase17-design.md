# Phase 17: Performance — Request-Path Optimization

**Date:** 2026-04-16
**Status:** Approved
**Scope:** Five targeted performance improvements across the hot request path, static serving, workspace scanning, model provider resilience, and asset caching.

---

## 1. Request-Level File Dedup Cache

**Problem:** `loadCapsuleContextEntries` (workspace-context.js:826) and `loadRecoveredSpanEntries` (workspace-context.js:905) both call `openWorkspaceFileWithFallback` independently. In broad mode (3 capsule files + 2 span-recovery files), the same file can be fetched twice from DynamoDB/S3 within a single request.

**Solution:** Create a request-scoped `Map<string, Promise<result>>` memoizer that wraps `openWorkspaceFileWithFallback`. On first call for a path, the promise is stored; subsequent calls for the same path within the same request await the existing promise.

**Location:** `src/core/workspace-context.js`

**Design:**
```
function createFileOpenCache() {
  const cache = new Map();
  return function cachedOpen(path, viewMode, options) {
    const key = `${path}::${viewMode}::${options.query || ''}`;
    if (!cache.has(key)) {
      cache.set(key, openWorkspaceFileWithFallback(path, viewMode, options));
    }
    return cache.get(key);
  };
}
```

The cache is created per-request inside `resolveChatContext` (assistant-chat.routes.js) and passed into both `loadCapsuleContextEntries` and `loadRecoveredSpanEntries` via an optional `fileOpenFn` parameter. When not provided, the functions fall back to calling `openWorkspaceFileWithFallback` directly (backward compatible).

**Impact:** Eliminates 1-2 duplicate DynamoDB/S3 round-trips per broad-mode request (~50-150ms saved).

---

## 2. Scoped Static File Serving

**Problem:** `express.static(path.join(__dirname, '..'))` at server.js:163 exposes the entire repo root as the static directory. Every request that doesn't match a route (including bot probes, typos, favicon.ico on subpaths) triggers a filesystem stat against the full project tree — including `node_modules/`, `.git/`, `.env`, and source files.

**Solution:** Replace the single catch-all `express.static` with two targeted mounts:
1. `express.static('assets/', { maxAge, immutable })` for versioned assets
2. `express.static('views/', { maxAge })` for HTML if needed beyond the clean-URL map

The `buildViewRouteMap` already handles clean URLs via `res.sendFile`, so the static middleware only needs to serve actual static assets (JS, CSS, images, fonts).

**Location:** `src/server.js:163-174`

**Design:**
- Mount `express.static(path.join(REPO_ROOT, 'assets'), ...)` at `/assets`
- Mount `express.static(path.join(REPO_ROOT, 'pitch'), ...)` at `/pitch` (landing pages reference pitch assets)
- Mount `express.static(path.join(REPO_ROOT, 'ccmon-web'), ...)` at `/ccmon-web` if ccmon is served from the same process
- Remove the repo-root `express.static` mount entirely
- Verify no routes break by checking what the frontend actually requests (asset paths in app.html, index.html)

**Security bonus:** `.env`, `secure-db.js`, `package.json`, `node_modules/` are no longer served by the static middleware.

**Impact:** Eliminates filesystem scans across `node_modules/` (337 entries) on every 404. Reduces attack surface.

---

## 3. Parallel Directory Scanning

**Problem:** `scanLocalWorkspaceFiles` (workspace-infrastructure.js:474) uses a sequential while-loop with `await fs.promises.readdir()` per directory. For a project with 100+ directories, each readdir is a separate kernel call waited on sequentially.

**Solution:** Introduce bounded concurrency for directory reads using the existing `mapWithConcurrency` helper (already in workspace-infrastructure.js:63). Process up to 8 directories in parallel instead of one at a time.

**Location:** `src/core/workspace-infrastructure.js:474-513`

**Design:**
- Keep the BFS structure but accumulate discovered subdirectories in batches
- Process each batch of directories with `mapWithConcurrency(batch, 8, readAndFilter)`
- Each worker calls `readdir`, filters entries, returns `{ files, subdirs }`
- Collect results, queue subdirs for next batch
- This preserves the skip-dirs/skip-extensions filtering while parallelizing I/O

**Impact:** 3-5x faster workspace scan on deep project trees (100+ directories). Most impactful for the initial workspace open and re-index operations.

---

## 4. Model Provider Fetch Timeouts

**Problem:** Every `fetch()` call in model-providers.js (lines 387, 429, 525, 609, 737) has no timeout. A hanging upstream provider (Anthropic, OpenAI, Azure, Gemini, Bedrock) blocks the Node.js worker thread indefinitely. Under pm2 cluster mode, enough hanging requests can exhaust all workers.

**Solution:** Add `AbortController` with a configurable timeout to every outbound model provider fetch. Use a shared helper to avoid repetition.

**Location:** `src/core/model-providers.js`

**Design:**
```
const MODEL_PROVIDER_TIMEOUT_MS = Number(process.env.MESH_MODEL_TIMEOUT_MS) || 120_000;

function fetchWithTimeout(url, options, timeoutMs = MODEL_PROVIDER_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}
```

Replace all `fetch(url, { method, headers, body })` calls in provider functions with `fetchWithTimeout(url, { method, headers, body })`. The Bedrock SDK (`client.send(cmd)`) needs `AbortController` passed via `abortSignal` in the command config.

**Timeout value:** 120s default (LLM responses can take 60-90s for long completions). Configurable via `MESH_MODEL_TIMEOUT_MS` env var.

**Impact:** Prevents indefinite worker thread blocking. Failing fast on hung providers allows the user to retry or switch providers.

---

## 5. Asset Cache-Busting via Content Hash

**Problem:** Static assets are served with `Cache-Control: public, max-age=86400` but filenames have no content hash. After a deploy, returning users see stale JS/CSS for up to 24 hours. Hot assets (app-workspace.js, etc.) use `no-cache` as a workaround, which means zero caching even when nothing changed.

**Solution:** Generate content hashes for key assets at server startup and inject them into HTML responses via a lightweight URL-rewriting middleware.

**Location:** `src/server.js` (new startup function + middleware)

**Design:**
- At startup, compute MD5 hashes (first 8 hex chars) for each file in `assets/` that matches `*.js` or `*.css`
- Build a `Map<originalPath, hashedPath>` — e.g., `app-workspace.js` -> `app-workspace.a1b2c3d4.js`
- Approach A (symlink): Create symlinks `app-workspace.a1b2c3d4.js -> app-workspace.js` in the assets directory. Serve with `immutable, max-age=31536000`. The symlinks are recreated on each server start.
- Approach B (URL rewrite in HTML): Use a lightweight middleware that rewrites `<script src="/assets/app-workspace.js">` to `<script src="/assets/app-workspace.js?v=a1b2c3d4">` in HTML responses. Simpler, no filesystem changes, but query-string cache-busting is slightly less robust than filename hashing.

**Recommended: Approach B** (query-string) — simpler implementation, no filesystem side effects, and query-string busting works with CloudFront when `QueryString: true` is set in the cache policy (which the existing infra already uses for pre-signed S3 URLs).

- Remove the `HOT_ASSETS` no-cache regex — all assets get `max-age=31536000, immutable` with the hash query string
- HTML responses remain `no-cache` (they're small and must always be fresh to pick up new hashes)

**Impact:** Returning users get cached assets indefinitely (until content changes), while deploys are reflected immediately via new hash query strings. Eliminates the HOT_ASSETS workaround.

---

## Success Criteria

| # | Optimization | Verification |
|---|-------------|-------------|
| 1 | File dedup cache | `grep "createFileOpenCache" src/core/workspace-context.js` exits 0 |
| 2 | Scoped static serving | No `express.static` mount on repo root in server.js |
| 3 | Parallel dir scan | `scanLocalWorkspaceFiles` uses `mapWithConcurrency` or equivalent |
| 4 | Fetch timeouts | `grep "AbortController\|fetchWithTimeout" src/core/model-providers.js` exits 0 |
| 5 | Asset cache-busting | HTML responses include `?v=` query strings on asset URLs |
| All | No regressions | `npm test` passes with 0 failures |

---

## Implementation Order

1. **Fetch timeouts** (safety-critical, independent, low risk)
2. **File dedup cache** (highest latency impact per request)
3. **Scoped static serving** (security + performance, independent)
4. **Parallel dir scan** (latency improvement for workspace open)
5. **Asset cache-busting** (depends on scoped static serving being in place)

---

## Out of Scope

- `BROAD_CHANGE_INTENT_RE` regex tuning (flagged in Phase 16 audit, separate concern)
- `entries.sort` alphabetical vs. relevance ordering (flagged in Phase 16 audit)
- Request-level dedup for `openWorkspaceFileWithFallback` across multiple requests (session-level cache — too complex for this phase)
- HTTP/2 push or preload hints (requires ALB/CloudFront config changes)
