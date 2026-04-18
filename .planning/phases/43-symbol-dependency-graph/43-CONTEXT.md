# Phase 43: Symbol Dependency Graph — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Build a symbol-level cross-file index at workspace index time: function/class declarations with exact file:line ranges, AST-based caller/callee resolution, 1-hop edges stored per file record, and n-hop resolution at query time. Expose the chain as a hybrid surface: outgoing refs in capsules (Phase 45) + query-time symbol context block injection (Phase 44).

This phase builds the data layer. Phase 44 builds the query resolver on top of it. Phase 45 enriches capsule rendering from it.

</domain>

<decisions>
## Implementation Decisions

### Symbol Index Storage
- **D-01:** Symbol declarations are stored per file record in a `symbols[]` array, parallel to the existing `dependencies[]` array in `buildWorkspaceFileRecord()`. Each entry: `{ name, kind, lineStart, lineEnd, signature }`. No global symbol map, no separate SQLite — consistent with how `dependencies[]` already works and incremental by default.

### Call Resolution Strategy
- **D-02:** AST `call_expression` traversal — walk tree-sitter AST for call sites during enrichment, match callee identifiers against the workspace-wide symbol index to resolve `{ callee: name, resolvedFile, resolvedLine }`. Falls back to import-graph inference (existing `dependencies[]`) for languages where the tree-sitter grammar does not expose `call_expression` nodes.
- Each file record stores a `callSites[]` array: `{ callerLine, calleeSymbol, resolvedFile, resolvedLine }`. Unresolved calls (callee name not found in index) are omitted.

### Chain Traversal Depth
- **D-03:** 1-hop edges stored at index time. N-hop chains resolved at query time by following stored `callSites[]` edges across file records. This keeps enrichment time bounded (no dependency-order constraint, no cross-file joins at index time) while supporting arbitrarily deep chains when the AI needs them.

### AI Context Surface Format
- **D-04:** Hybrid — Phase 43 builds the raw data layer only (`symbols[]` and `callSites[]` on file records). Phase 45 uses `symbols[]` to add outgoing call refs to capsule text. Phase 44 uses `callSites[]` edges to resolve query-triggered chains and injects a `Symbol Context` block into the chat prompt. Phase 43 does NOT modify capsule rendering or prompt assembly — those are Phase 44/45 concerns.

### Claude's Discretion
- How many call sites to store per file before truncating (suggest MAX_CALL_SITES = 200 per file)
- Whether to deduplicate call sites to the same (callee, resolvedFile) pair by keeping only the first occurrence
- Node type list for `call_expression` equivalents across languages (JS `call_expression`, Python `call`, Go `call_expression`, Rust `call_expression` — research the correct tree-sitter node type names per grammar)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Core Compression Pipeline
- `mesh-core/src/compression-core.cjs` §buildWorkspaceFileRecord (line ~2145) — where `symbols[]` and `callSites[]` must be added to the file record
- `mesh-core/src/compression-core.cjs` §buildBaseCapsule / walkTree (line ~589-730) — existing symbol extraction (declarations only); call_expression traversal must be added here or as a second pass
- `mesh-core/src/compression-core.cjs` §resolveWorkspacePath (line ~532) — already resolves import strings to workspace file paths; reuse for call site resolution

### Workspace Enrichment Pipeline
- `mesh-core/src/workspace-operations.js` §enrichWorkspaceRecords (line ~838) — async enrichment queue; symbol index build happens here
- `mesh-core/src/workspace-operations.js` §getWorkspaceGraph (line ~664) — current file-level graph; symbol-level edges will extend this or live alongside it

### Requirements
- `.planning/REQUIREMENTS.md` — SYM-01..04 define the acceptance criteria for this phase

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resolveWorkspacePath(sourcePath, importString, workspaceFilePaths)` (compression-core.cjs:532) — resolves import strings to workspace paths; reuse to resolve call site callee locations
- `walkTree(rootNode, visitor)` (compression-core.cjs) — existing AST traversal helper; add call_expression branch
- `importsSection` + `importItems` regex (compression-core.cjs:598-626) — already extracts and resolves import sources; reuse `metadata.source` for callee-file resolution
- `enqueueWorkspaceEnrichment()` / `enrichWorkspaceRecords()` — existing background enrichment queue; incremental file save should call this for the saved file only

### Established Patterns
- File record fields are plain JS objects — add `symbols: []` and `callSites: []` alongside `dependencies: []`
- `MAX_SYMBOL_DISCOVERY` constant pattern — use same pattern for `MAX_CALL_SITES` cap
- `createSection()` / `pushSectionItem()` — use for any new capsule sections in Phase 45; not needed in Phase 43 (data layer only)

### Integration Points
- `buildWorkspaceFileRecord()` (compression-core.cjs:2145) — add `symbols[]` and `callSites[]` to the returned record object
- `workspaceMetadataStore.upsertWorkspaceFileRecord()` — must persist new fields (verify DynamoDB item size limits with ~200 call sites per file)
- `workspaceState.files` Map — in-memory records also need `symbols[]` and `callSites[]`; local-path workspaces never hit DynamoDB

</code_context>

<specifics>
## Specific Ideas

- Target chain output the AI sees: `"button onClick in LoginForm.tsx:24 → authService.login() in auth-service.ts:58 → POST /api/auth in auth.routes.js:14"` — this is the format to aim for
- The call site resolution loop: for each `call_expression` node, extract the callee identifier name, look it up in the workspace-wide `symbols[]` across all files, resolve to `{ file, lineStart }`
- The workspace-wide symbol lookup must happen at enrichment time — not per-file in isolation. enrichWorkspaceRecords() has access to all files; use a two-pass approach: pass 1 extract declarations, pass 2 resolve call sites

</specifics>

<deferred>
## Deferred Ideas

- Vector embeddings on symbol names for fuzzy matching (symbol lookup is name-exact in Phase 43)
- Real-time symbol streaming to connected clients on file save
- Cross-workspace symbol resolution (monorepo support)
- Type inference / return type tracking (requires TypeScript compiler, out of scope)

</deferred>

---

*Phase: 43-symbol-dependency-graph*
*Context gathered: 2026-04-18*
