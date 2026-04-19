# Phase 44: Semantic Query Index - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a pre-computed inverted token index over workspace symbols and string literals. At query time (when a user message triggers a workspace search), the index resolves query tokens to ranked `{file, lineStart, lineEnd, snippet, kind, score}` entries. Results are returned in the existing `searchWorkspace()` response as a `snippets[]` field alongside `matches[]`. No vector embeddings, no full-text content indexing — symbols and string literals only.

</domain>

<decisions>
## Implementation Decisions

### Index Storage Format
- **D-01:** Global inverted Map stored on `workspaceState` — `workspaceState.queryIndex: Map<token, [{file, lineStart, lineEnd, snippet, kind}]>`. Mirrors the `symbolMap` pattern from Phase 43. O(1) token lookup at query time. Initialized as `new Map()` in `mesh-state.js` alongside `symbolMap`.

### Index Content Scope
- **D-02:** Tokenize symbol names + signature text (from `symbols[]` already on each file record) AND string literals extracted from the AST. Comments skipped — too noisy. String literals extracted via new `extractQueryTokens()` function in `compression-core.cjs` reusing the `walkTree` pattern from Phase 43.
- **D-03:** String node types to traverse: `string`, `string_fragment`, `template_string`, `interpreted_string_literal` (Go). Skip strings shorter than 4 chars, numeric-only strings, pure punctuation. Max 80 chars per literal value.
- **D-04:** File records gain a `stringLiterals[]` array: `{value, lineStart, lineEnd}` alongside `symbols[]` and `callSites[]`. Populated during `buildCodeCapsule` in both `tree-sitter-worker.cjs` and `compression-core.cjs` (worker/inline duality preserved).

### Scoring Algorithm
- **D-05:** Token overlap count + kind-based type boost. Base score = count of query tokens present in index entry's token set. Boosts: `+40` for `function`/`class` kind, `+25` for `exported`, `+15` for `string_literal`. Final sort: `totalScore DESC`, `lineStart ASC`. Extends the existing `scorePathForQuery` pattern.

### Query Injection Point
- **D-06:** Augment the existing `searchWorkspace()` response — add `snippets[]` alongside `matches[]`. Backward-compatible: all callers (`run-lifecycle.js`, `voice-agent.js`, `realtime.routes.js`) receive snippets without code changes. Callers that ignore `snippets[]` are unaffected.
- **D-07:** Default Top-5 snippets per query. Configurable via `MESH_CAPSULE_MAX_QUERY_SNIPPETS` env var, clamped to 1–20. Same pattern as `MAX_CALL_SITES_PER_FILE`.

### Snippet Format
- **D-08:** Snippet content = `signature` field from `symbols[]` (up to 140 chars, already collected in Phase 43) for symbol hits. For string literal hits: the raw `value` field. No file I/O at query time — all content from the index.

### Index Build Timing
- **D-09:** Pass 3 in `enrichWorkspaceRecords()` — sequential after Phase 43's Pass 1 (symbolMap) and Pass 2 (callSite resolution). Iterates all files, tokenizes `symbols[]` + `stringLiterals[]`, populates `workspaceState.queryIndex`. Same enrichment call, no new entry points.

### Index Persistence
- **D-10:** RAM-only. `workspaceState.queryIndex` is reset to `new Map()` on workspace select and rebuilt during `enrichWorkspaceRecords`. Same lifecycle as `symbolMap`. No serialization to metadata store.

### Incremental Update
- **D-11:** `localWorkspaceSave()` in `src/core/workspace/files.js` updates `queryIndex` incrementally after the file is re-indexed: remove all entries for the saved file path, add new entries from updated `symbols[]` + `stringLiterals[]`. Guarded by `instanceof Map` check — no-op if enrichment hasn't run yet. Same guard pattern as Phase 43's symbolMap incremental update.

### Claude's Discretion
- Tokenization function for the index (`tokenizeForIndex`) — can reuse/extend `extractSearchTokens` from `src/core/workspace/utils.js` or implement inline in `compression-core.cjs`. Prefer reuse if the existing tokenizer (min 3 chars, stop words filter) is sufficient.
- Max string literals per file cap — follow `MAX_CALL_SITES_PER_FILE` pattern with a reasonable default (e.g., 300).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Architecture
- `.planning/REQUIREMENTS.md` §Semantic Query Index — IDX-01..IDX-04 acceptance criteria
- `.planning/ROADMAP.md` §Phase 44 — success criteria for the query index

### Prior Phase Context (read before touching Phase 43 files)
- `.planning/phases/43-symbol-dependency-graph/43-SUMMARY.md` — what symbols[], callSites[], symbolMap, and enrichWorkspaceRecords two-pass look like after Phase 43

### Key Implementation Files
- `mesh-core/src/compression-core.cjs` — add `extractQueryTokens()`, `stringLiterals[]` extraction in `buildCodeCapsule`, `queryIndex` build helpers
- `mesh-core/src/tree-sitter-worker.cjs` — add `stringLiterals[]` extraction (worker path — must be self-contained, cannot import from compression-core)
- `mesh-core/src/mesh-state.js` — add `queryIndex: new Map()` to `workspaceState`
- `mesh-core/src/workspace-operations.js` — add Pass 3 in `enrichWorkspaceRecords()`, augment `searchWorkspace()` response with `snippets[]`
- `src/core/workspace/files.js` — incremental `queryIndex` update in `localWorkspaceSave()`
- `src/core/workspace/utils.js` — `extractSearchTokens()` (reuse for tokenization), `scorePathForQuery()` (scoring pattern to extend)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `extractSearchTokens(input)` (`src/core/workspace/utils.js:101`) — splits on non-alphanumeric, filters stop words, min 3 chars. Reuse directly for query tokenization and index token generation.
- `compactAlphaNumeric(input)` (`src/core/workspace/utils.js:109`) — normalizes to lowercase alphanumeric. Used in scorePathForQuery for fuzzy matching.
- `scorePathForQuery()` (`src/core/workspace/utils.js:122`) — token overlap scoring with weighted bonuses. The scoring algorithm for snippet ranking should follow this pattern.
- `symbols[]` on every file record — already contains `{name, kind, lineStart, lineEnd, signature}`. Pass 3 consumes this directly.
- `workspaceState.symbolMap` (Phase 43) — established the Map<> pattern for global in-memory indexes.
- `MAX_CALL_SITES_PER_FILE` env-var pattern — use same pattern for `MESH_CAPSULE_MAX_QUERY_SNIPPETS`.

### Established Patterns
- **Worker/inline duality**: `buildCodeCapsule` exists in both `tree-sitter-worker.cjs` (execution path) and `compression-core.cjs` (fallback). Any additions must go in both.
- **Two-pass enrichment**: Phase 43 established sequential passes in `enrichWorkspaceRecords()`. Pass 3 appends to this.
- **Incremental guard**: `if (localAssistantWorkspace.symbolMap instanceof Map)` pattern in `localWorkspaceSave()`. Same guard for `queryIndex`.
- **`buildTextFallbackCapsule`**: heuristic path (no AST). Should populate `stringLiterals[]` from regex-matched quoted strings as a fallback.

### Integration Points
- `searchWorkspace()` (`mesh-core/src/workspace-operations.js:1616`) — add `snippets` field to return value
- `searchWorkspaceWithFallback()` (`src/core/context/file-cache.js:165`) — passes through to `meshTunnelRequest('workspace.search', ...)` — augmented response flows through automatically
- `enrichWorkspaceRecords()` (`mesh-core/src/workspace-operations.js`) — add Pass 3 after existing two passes

</code_context>

<specifics>
## Specific Ideas

- Index shape: `workspaceState.queryIndex: Map<token, [{file, lineStart, lineEnd, snippet, kind}]>` — exact field shape confirmed during discussion
- Snippet shape: `{file, lineStart, lineEnd, snippet, kind, score}` — `snippet` is signature text (symbols) or literal value (strings)
- Score boosts confirmed: `+40` function/class, `+25` exported, `+15` string_literal
- String node types confirmed: `string`, `string_fragment`, `template_string`, `interpreted_string_literal`
- String filter: skip < 4 chars, numeric-only, pure punctuation; max 80 chars per literal

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 44-semantic-query-index*
*Context gathered: 2026-04-18*
