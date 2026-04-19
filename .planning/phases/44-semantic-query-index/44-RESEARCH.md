# Phase 44: Semantic Query Index — Research

## RESEARCH COMPLETE

**Researched:** 2026-04-18
**Phase:** 44 — Semantic Query Index
**Requirements:** IDX-01, IDX-02, IDX-03, IDX-04

---

## Key Findings

### Existing Infrastructure Available

**1. `tokenizeQuery()` in `compression-core.cjs:1718`**
Already exists in compression-core.cjs (not exported, internal):
```javascript
function tokenizeQuery(query) {
  return String(query || "")
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/g)
    .filter(Boolean)
    .filter((token) => token.length >= 2);
}
```
This tokenizer (min 2 chars) can be adapted for index token generation, or `extractSearchTokens` from `src/core/workspace/utils.js` (min 3 chars, stop words filtered) can be imported into workspace-operations.js — it's already imported via `assistantCoreNamespace`.

**2. `extractSearchTokens()` in `src/core/workspace/utils.js:101`**
Used in `buildWorkspaceQueryContext()` in workspace-operations.js. Splits on non-alphanumeric, filters stop words (`FILE_QUERY_STOP_WORDS`), min 3 chars. This is the correct tokenizer for the query side (consistent with existing search behavior). For the **index side** (building the inverted map), the same function can be used to keep query/index token normalization consistent.

**3. Two-pass enrichment anchor: `enrichWorkspaceRecords()` at `workspace-operations.js:863`**
Pass 1 (symbolMap build) ends at line ~955. Pass 2 (callSite resolution) runs from ~957. Pass 3 (queryIndex) inserts after Pass 2 completion (~997) and before `persistWorkspaceState()` at line 999.

**4. `workspaceState.symbolMap` pattern (Phase 43)**
`mesh-state.js` holds `symbolMap: new Map()`. The pattern is: reset on workspace clear/select, populate in enrichment, update incrementally in `localWorkspaceSave()`. `queryIndex` follows the same lifecycle.

**5. `searchWorkspace()` at `workspace-operations.js:1616`**
Returns `{ ok, query, limit, matches[], total }`. Two code paths: upload workspace (metadata store) and local workspace (in-memory). Both return the same shape. Adding `snippets[]` requires augmenting both paths.

**6. `scoreItemForQuery()` in `compression-core.cjs:1726`**
Internal scoring function for capsule sections. Uses token overlap. The Phase 44 scorer is similar but adds kind-based boosting (+40 function/class, +25 exported, +15 string_literal).

**7. `symbols[]` on file records (Phase 43)**
Every file record now has `symbols: [{name, kind, lineStart, lineEnd, signature}]`. The `signature` field (up to 140 chars) is the snippet text for symbol hits. No additional extraction needed for the symbol side.

**8. `buildTextFallbackCapsule()` in compression-core.cjs**
Heuristic path (no tree-sitter AST). Already populates `heuristicSymbolDeclarations[]`. Phase 44 adds `heuristicStringLiterals[]` here via regex for the text fallback path.

---

## Implementation Map

### Files to create/modify (in order)

| File | Change | Scope |
|------|--------|-------|
| `mesh-core/src/mesh-state.js` | Add `queryIndex: new Map()` to `workspaceState` | 1 line |
| `mesh-core/src/compression-core.cjs` | Add `extractQueryTokens()`, `stringLiterals[]` extraction in `buildCodeCapsule`, `MAX_QUERY_TOKENS_PER_FILE` constant, `buildQueryIndexEntries()` helper | ~60 lines |
| `mesh-core/src/tree-sitter-worker.cjs` | Add `stringLiterals[]` extraction (worker path, self-contained) | ~40 lines |
| `mesh-core/src/workspace-operations.js` | Pass 3 in `enrichWorkspaceRecords()`, augment `searchWorkspace()` with `snippets[]`, `MAX_QUERY_SNIPPETS` constant | ~60 lines |
| `src/core/workspace/files.js` | Incremental `queryIndex` update in `localWorkspaceSave()` | ~30 lines |

### New test files

| File | Tests |
|------|-------|
| `test/query-index-build.test.cjs` | Index built from symbols[], string literals extracted |
| `test/query-index-search.test.cjs` | Query resolves to ranked snippets, type boosts work |
| `test/query-index-incremental.test.cjs` | Incremental update removes old entries, adds new |

---

## Critical Patterns to Follow

### Worker/Inline Duality
`buildCodeCapsule` in `tree-sitter-worker.cjs` cannot import from `compression-core.cjs`. String literal extraction must be duplicated — same `STRING_NODE_TYPES` set, same filtering logic. Pattern already established in Phase 43 for `symbolDeclarations` and `callSitesRaw`.

### Metadata Store Path (upload workspaces)
`searchWorkspace()` has two branches:
1. `workspaceMetadataStore.enabled && isUploadWorkspace()` — queries DynamoDB. After `docs.map(...)`, snippets can be built by iterating `docs` and calling `queryIndex` lookup.
2. Local in-memory path — `sortedWorkspacePaths()` + `workspaceState.files.get(pathValue)`. Same snippet lookup from `workspaceState.queryIndex`.

For the metadata store path, `workspaceState.queryIndex` may not be available. The fallback: iterate `docs`, collect `doc.symbols`, build snippets inline at query time (slower but correct). Or: always build queryIndex in workspaceState regardless of upload mode (the index is keyed by path, which is consistent).

### `buildWorkspaceFileRecord()` return shape
In `compression-core.cjs`, `buildWorkspaceFileRecord()` calls `buildBaseCapsule()` which returns `{symbolDeclarations, callSitesRaw, ...}`. The return already passes `symbols: baseCapsule.symbolDeclarations.slice(0, MAX_SYMBOL_DISCOVERY)` and `callSites: ...`. Phase 44 adds:
```javascript
stringLiterals: Array.isArray(baseCapsule.stringLiteralsRaw) ? baseCapsule.stringLiteralsRaw : [],
```

### String Literal Extraction Position
In `buildCodeCapsule()`, extraction happens **after** the symbol walkTree (line ~831 in current code: `const callSitesRaw = extractCallSites(...)`). String literal extraction similarly runs as a second walkTree pass after symbols:
```javascript
const stringLiteralsRaw = extractStringLiterals(tree, rawText);
```
Or combined into one walk as a new `extractQueryTokens()` function that returns both string literals and populates an index-ready structure.

### `MAX_QUERY_TOKENS_PER_FILE` constant
Follow `MAX_CALL_SITES_PER_FILE` pattern — env var `MESH_CAPSULE_MAX_QUERY_TOKENS`, default 300, clamped 10–5000.

### `MAX_QUERY_SNIPPETS` for search response
Separate from `MAX_QUERY_TOKENS_PER_FILE`. This controls how many ranked snippets appear in the search response. Default 5, env var `MESH_CAPSULE_MAX_QUERY_SNIPPETS`, clamped 1–20.

---

## Edge Cases

1. **Empty queryIndex at search time**: If `enrichWorkspaceRecords()` hasn't run yet (workspace just selected), `workspaceState.queryIndex` is `new Map()`. `searchWorkspace()` returns `snippets: []` — acceptable, callers handle empty arrays.

2. **Duplicate tokens in index**: Same token may appear in multiple symbols in the same file. Each creates a separate entry in the inverted index. At query time, results are deduped by `{file, lineStart}` composite key before ranking.

3. **Upload workspace (DynamoDB)**: `workspaceState.queryIndex` is populated by `enrichWorkspaceRecords()` using `workspaceMetadataStore.listWorkspaceFiles()` which returns full records including `symbols[]`. The same Pass 3 loop applies to both local and upload paths.

4. **`extractSearchTokens` vs `tokenizeQuery`**: The query side uses `extractSearchTokens` (min 3 chars, stop words filtered). The index build side should use the same function (or a compatible one) so query tokens match index tokens. Using `tokenizeQuery` (min 2 chars) would produce more tokens in the index that never match query tokens — waste. Use `extractSearchTokens` for both.

5. **String literals cap per file**: Without a cap, template-heavy files (e.g., React components with many JSX strings) could produce thousands of entries. Cap at 300 per file via `MAX_QUERY_TOKENS_PER_FILE`.

---

## Validation Architecture

### Nyquist Validation Requirements

**IDX-01: Index built at workspace index time**
- Verify: after calling `enrichWorkspaceRecords()` on a workspace with known symbols, `workspaceState.queryIndex` is a populated Map with entries for known symbol names
- Test: call `enrichWorkspaceRecords()` with a file containing `function handleLogin()`, then `queryIndex.get('handlelogin')` (lowercased) returns a non-empty array

**IDX-02: Query resolves to ranked file:line snippets**
- Verify: `searchWorkspace({ q: 'login' })` returns `snippets[]` with `{file, lineStart, lineEnd, snippet, score}` objects
- Test: given index with login-related entries, query returns snippets containing the login symbol

**IDX-03: Coverage of function names, class names, exported identifiers, string literals**
- Verify: index contains entries from both `symbols[]` (kind: function/class) and `stringLiterals[]` (kind: string_literal)
- Test: workspace with `class LoginForm` and string `'Login failed'` — index has entries for both 'login' and 'failed' tokens

**IDX-04: Incremental update on file save**
- Verify: after `localWorkspaceSave()`, old entries for the saved file are removed and new entries added
- Test: save file with changed function name — old function no longer in index, new one is
