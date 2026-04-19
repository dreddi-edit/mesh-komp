# Phase 38: Marketplace — CORS-Proxy & Extension Display — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add a server-side proxy for Open VSX search so the browser never calls `open-vsx.org` directly (fixes CSP `connectSrc: ["'self'"]` blocking), and wire the existing marketplace frontend to use the new proxy endpoint. Extension card display and install flow remain structurally the same — no new capabilities added.

</domain>

<decisions>
## Implementation Decisions

### Proxy Endpoint

- **D-01:** New standalone route `/api/marketplace/search?q=...` — not folded into `assistant.routes.js`. Clean separation, easy to find, mirrors `/api/assistant/extensions/install`.
- **D-02:** Server proxies to `https://open-vsx.org/api/-/search` and passes response through to client unchanged (no response reshaping needed since frontend already handles both `extensions` and `results` keys).
- **D-03:** In-memory cache with **5-minute TTL** — same query string = same cached response for 5 min. Simple Map-based cache, no Redis. Cache keyed on normalized query string (lowercased, trimmed).
- **D-04:** Timeout **8 seconds**, then 504 with structured JSON error `{ ok: false, error: "Open VSX Registry unavailable", code: "UPSTREAM_TIMEOUT" }`. No retry — fail fast and surface clearly.

### Extension Card Display

- **D-05:** Cards show: name, publisher, description, download count, version, install button — **no changes** to current card structure. Matches what's already rendered.
- **D-06:** Icon strategy unchanged: Open VSX `iconUrl` if present, fallback to `dicebear identicon` via `onerror`. Downstream agents: do not change icon logic.

### Error & Fallback

- **D-07:** When proxy returns error (upstream unavailable, timeout, etc.): show error text **+ Retry button** that re-runs `fetchExtensions()` with the current search query. No auto-retry.
- **D-08:** Loading state: replace the plain text "Fetching the global registry..." with a **spinner + loading skeleton** (3-4 card-shaped placeholders). Reduces layout shift, signals activity clearly.

### CSP Update

- **D-09:** `connectSrc` in `src/server.js` does NOT need `https://open-vsx.org` added — that's the whole point of the proxy. The browser only calls `/api/marketplace/search` (same origin). No CSP change needed.

### Claude's Discretion

- Route file placement: new `src/routes/marketplace.routes.js` or added to `src/routes/assistant.routes.js` — planner decides based on file size and cohesion
- Skeleton card exact markup: Claude decides, should match `.mp-card` dimensions roughly
- Cache eviction strategy: simple TTL expiry is fine, no LRU needed at this scale

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Marketplace Code
- `views/marketplace.njk` — Full frontend: search input, `fetchExtensions()`, `renderExtensions()`, `actualInstall()`, card markup. The proxy URL swap and retry button go here.
- `src/routes/assistant.routes.js` lines 164-207 — Existing `/api/assistant/extensions/install` endpoint. Pattern reference for how extension routes are structured.

### CSP Configuration
- `src/server.js` lines 52-65 — Helmet CSP config. `connectSrc: ["'self'", "ws:", "wss:"]` — confirms why browser-direct Open VSX calls break in production.

### Open VSX API
- No external spec file — API behavior: `GET https://open-vsx.org/api/-/search?q={query}&size=30` returns `{ extensions: [...] }` or `{ results: [...] }` depending on query presence. Both keys handled in existing frontend code.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `views/marketplace.njk:137-153` — `fetchExtensions(query)`: currently calls Open VSX directly. Only the URL needs to change from `https://open-vsx.org/api/-/search` to `/api/marketplace/search`.
- `.mp-card` CSS class — existing card styles, skeleton should match these dimensions
- `src/routes/assistant.routes.js` — install endpoint as pattern for new search proxy route

### Established Patterns
- Route pattern: `router.get('/api/...', requireAuth, async (req, res) => { ... })` with try/catch + `res.json()`
- Upstream fetch pattern: `fetch(url, { signal: AbortSignal.timeout(N) })` — already used in install endpoint
- Error response shape: `{ error: 'message string' }` + appropriate status code

### Integration Points
- `src/server.js` — new route file must be mounted here alongside other route groups
- `views/marketplace.njk` — `fetchExtensions()` URL is the only thing that changes in the frontend
- No auth required on the search proxy (Open VSX is a public API, and marketplace page itself is gated by session)

</code_context>

<specifics>
## Specific Ideas

- Cache key should normalize: `(query || '').toLowerCase().trim()` — empty string = "trending" bucket
- Proxy route should pass `size=30` to Open VSX (matches current hardcoded frontend value)
- Retry button label: "Try again" — visible below error message, teal accent color matching app style

</specifics>

<deferred>
## Deferred Ideas

- Extension ratings/stars display — requires separate Open VSX ratings API, out of scope
- Category tag filtering — new UI capability, belongs in a future phase
- Extension detail page / README preview — new surface, not in scope
- Auto-refresh of installed state across sessions — separate concern

None of the above block MKT-01 or MKT-02.

</deferred>

---

*Phase: 38-marketplace-cors-proxy-extension-display*
*Context gathered: 2026-04-19*
