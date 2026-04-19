# Phase 23: Performance — Prompt Caching + Remaining Optimizations - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Ship Anthropic prompt caching, Bedrock singleton, maxTokens fix, async HTML serving, and parallel workspace enrichment. Independent of Phases 19-22 — can run anytime.

</domain>

<decisions>
## Implementation Decisions

### Anthropic Prompt Caching
- **D-01:** Add `anthropic-beta: prompt-caching-2024-07-31` header to native Anthropic stream requests
- **D-02:** Add `cache_control` blocks on system messages in Anthropic native streaming
- **D-03:** All Anthropic provider logic lives in `src/core/model-providers.js` (1,663 lines) — specifically the `streamAnthropicNative` function

### Bedrock Prompt Caching + Singleton
- **D-04:** Add `cache_control` array on system block in Bedrock streaming payload
- **D-05:** `BedrockRuntimeClient` must be instantiated once per process (module-level singleton), not per request
- **D-06:** Current Bedrock client creation is in `src/core/model-providers.js` — look for per-request instantiation

### maxTokens Fix
- **D-07:** `streamAnthropicNative` must respect `storedCredentials.anthropic.maxTokens` user preference
- **D-08:** Default to 4096 if user hasn't set a preference
- **D-09:** Credential flow: DynamoDB → `getStoredCredentialsForUser()` → credential cache → `mergeChatCredentials()` → provider call

### Async HTML Serving
- **D-10:** Replace `fs.readFileSync` in `sendHtmlWithHashes()` (`src/server.js:177`) with async `fs.promises.readFile`
- **D-11:** Add in-memory cache for rendered HTML (read once, serve from RAM)
- **D-12:** Startup-time sync reads (`buildAssetHashMap`, `buildViewRouteMap`) are fine — only fix the request-path sync reads

### Parallel Workspace Enrichment
- **D-13:** `enrichLocalWorkspaceRecords()` in `src/core/workspace-ops.js:40-51` processes files serially within batch
- **D-14:** Add bounded concurrency for parallel file processing (e.g., `Promise.all` with batch limit)
- **D-15:** Respect system resources — don't open too many file handles simultaneously

### Claude's Discretion
- Exact prompt caching header format and system message structure
- HTML cache invalidation strategy (TTL vs. file watcher vs. startup-only)
- Concurrency limit for parallel enrichment (4? 8? configurable?)
- Bedrock singleton initialization pattern

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Performance Bottlenecks
- `.planning/codebase/CONCERNS.md` §2 (Performance → Bottlenecks) — Sync `readFileSync` on request path, serial workspace enrichment, rate limiter memory
- `.planning/codebase/CONCERNS.md` §2 (Performance → Current Optimizations) — Existing caching (session cache, asset hash map, view route map)

### AI Provider Architecture
- `.planning/codebase/INTEGRATIONS.md` §AI Model Providers — Anthropic (direct + Bedrock), credential resolution flow
- `.planning/codebase/ARCHITECTURE.md` §Key Abstractions → Credential Resolution — User API key flow through the system

### File Locations
- `.planning/codebase/STRUCTURE.md` — `src/core/model-providers.js` (1,663 lines), `src/server.js` (240 lines), `src/core/workspace-ops.js` (1,723 lines)

### Requirements
- `.planning/REQUIREMENTS.md` — PERF-01, PERF-05, PERF-06, PERF-07, PERF-08, PERF-09

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server.js:147-161` — `buildAssetHashMap()` pattern demonstrates startup-time caching
- `src/server.js:117-141` — `buildViewRouteMap()` pattern for pre-computing at startup
- `src/core/auth.js:53-66` — `sessionCache` with TTL logic, pattern for caching

### Established Patterns
- PM2 cluster mode (`ecosystem.config.js`) — singletons must be per-process, not per-cluster
- Credential cache has 60s TTL (`src/core/auth.js:91-104`)
- Tree-sitter worker pool pre-warmed at startup — model for singleton initialization

### Integration Points
- `src/server.js:177` — `sendHtmlWithHashes()` sync file read to replace
- `src/core/model-providers.js` — Anthropic and Bedrock streaming functions
- `src/core/workspace-ops.js:40-51` — `enrichLocalWorkspaceRecords()` serial processing
- `src/config/index.js` — maxTokens default and enrichment concurrency config

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-performance-prompt-caching-optimizations*
*Context gathered: 2026-04-16*
