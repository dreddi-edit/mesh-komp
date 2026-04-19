# Phase 46: Targeted Reads + Large File Chunking — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Add two new read primitives to the existing file-read pipeline:

1. **Targeted symbol read** (READ-01/03) — given a symbol name, extract only that function/class body from raw text using `symbols[]` line ranges + configurable context padding (±5 lines default). Returns exact line range in response.
2. **Large file chunking** (READ-02/04) — files >300 lines transparently return chunk 0 when `view="original"` is requested, along with `{chunked, chunkIndex, totalChunks, lineRange}` metadata. Chunks are sized at ~150 lines and snapped to top-level AST node boundaries. Subsequent chunks fetched by passing `chunkIndex=N` option.

No new indexing, no new data collection. Both features build on the existing `symbols[]` array (lineStart/lineEnd already present on every file record) and `rawText` already in memory.

</domain>

<decisions>
## Implementation Decisions

### API Surface (READ-01/03)
- **D-01:** Targeted read lives in `buildWorkspaceFileView()` as a new `view="targeted"` mode. Caller passes `options.symbolName` (string) and optionally `options.contextLines` (default 5). This is consistent with existing `"capsule"`, `"focused"`, and `"original"` modes — same route, same caller interface. No new route, no new exported function.
- **D-02:** Response shape: `{ok, path, view: "targeted", symbolName, lineRange: {start, end}, content, encoding: "plain-text"}`. If `symbolName` not found in `record.symbols`, fall back to returning the full file with a `fallback: true` flag (no error — AI can still proceed).

### Large File Chunking Behavior (READ-02/04)
- **D-03:** **Transparent auto-chunking** — `view="original"` on a file >300 lines automatically returns chunk 0 only, plus `{chunked: true, chunkIndex: 0, totalChunks: N, lineRange: {start, end}}` metadata. Small files (≤300 lines) are completely unaffected. Existing callers that only read small files see no behavior change.
- **D-04:** To fetch subsequent chunks, callers pass `options.chunkIndex=N` alongside `view="original"`. The chunk index is included in the response so AI knows which chunk it received.

### Chunk Sizing Strategy (READ-02/04)
- **D-05:** Fixed target of ~150 lines per chunk, snapped to the nearest top-level AST node boundary — never split inside a function or class body. Boundary snapping uses `symbols[]` `lineEnd` values: find the symbol whose `lineEnd` is closest to (but not exceeding) the target boundary.
- **D-06:** Each chunk gets a header: `## {filename} lines {start}-{end} (chunk {N}/{total})` — prepended to the content so AI can reference exact location without reading the metadata object.
- **D-07:** If no AST parse occurred (heuristic/fallback path), chunk on exact line boundaries (no snapping). Acceptable degradation — large minified/binary files rarely need chunking.

### Symbol Lookup for Targeted Read
- **D-08:** Symbol lookup uses `record.symbols[]` already on every file record from Phase 43. Lookup by `name` field (case-sensitive). For ambiguous names (same function name in different scopes), prefer the first match (lowest `lineStart`). `contextLines` extends the returned range: `max(1, lineStart - contextLines)` to `min(totalLines, lineEnd + contextLines)`.

### Claude's Discretion
- Whether chunk boundaries are pre-computed and cached on the record at build time (lazy cache recommended — compute on first `view="original"` call for files >300 lines, store as `record.chunkBoundaries`)
- Maximum `contextLines` cap for targeted reads (suggest 20 to prevent accidental large returns)
- Whether `view="targeted"` also returns the capsule section data for that symbol (suggest no — keep targeted view as plain-text extraction only)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Requirements
- `.planning/REQUIREMENTS.md` §Targeted Reads + Large File Chunking — READ-01..READ-04 acceptance criteria
- `.planning/ROADMAP.md` §Phase 46 — success criteria

### Prior Phase Context
- `.planning/phases/43-symbol-dependency-graph/43-CONTEXT.md` — establishes `symbols[] = {name, kind, lineStart, lineEnd, signature}` shape on every file record
- `.planning/phases/43-symbol-dependency-graph/43-SUMMARY.md` — what buildWorkspaceFileRecord returns after Phase 43

### Core Read Pipeline
- `mesh-core/src/compression-core.cjs` §buildWorkspaceFileView (line ~2533) — where `view="targeted"` and chunk logic go; existing view mode dispatch pattern to follow
- `mesh-core/src/compression-core.cjs` §recoverWorkspaceFileRecord (line ~2650) — existing span/line-range extraction via `sliceTextByLines(rawText, lineStarts, lineStart, lineEnd)` — reuse this for targeted read content extraction
- `mesh-core/src/compression-core.cjs` §buildLineStarts / sliceTextByLines — line-range text extraction utilities already present

### Workspace File Access
- `src/core/workspace/files.js` §localWorkspaceFile (line ~340) — calls `buildWorkspaceFileView(meta, viewMode, options)`; no changes needed here since new modes are inside the view function
- `mesh-core/src/workspace-helpers.js` — re-exports `buildWorkspaceFileView` from compression-core; no changes needed

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sliceTextByLines(rawText, lineStarts, lineStart, lineEnd)` (compression-core.cjs) — already slices raw text by 1-based line range; exact function for targeted read content extraction
- `buildLineStarts(rawText)` (compression-core.cjs) — converts raw text to byte-offset index for fast line slicing; already called in `recoverWorkspaceFileRecord`
- `record.symbols[]` — `{name, kind, lineStart, lineEnd, signature}` on every indexed file; provides the line range for `view="targeted"` without re-parsing
- `record.rawStorage` / `decodeRawStorage(record.rawStorage)` — how `buildWorkspaceFileView` accesses raw file text; same pattern for new view modes

### Established Patterns
- View mode dispatch: each `normalizedView === "..."` branch in `buildWorkspaceFileView` returns its own shape — add `"targeted"` and `"chunk"` as new branches after existing ones
- `base` object spread: every view returns `{...base, view, content, encoding, ...extra}` — new modes follow the same convention
- 300-line threshold: fixed by REQUIREMENTS.md (READ-02); implement as named constant `LARGE_FILE_CHUNK_THRESHOLD = 300`
- 150-line chunk target: implement as named constant `CHUNK_TARGET_LINES = 150`

### Integration Points
- `buildWorkspaceFileView()` is the single insertion point for both new features — no route changes needed
- `localWorkspaceFile()` in `src/core/workspace/files.js` passes `viewOptions` through to `buildWorkspaceFileView` — `symbolName`, `contextLines`, and `chunkIndex` can be passed as options from existing callers
- `recoverWorkspaceFileRecord()` pattern: study how it calls `buildLineStarts` + `sliceTextByLines` — targeted read reuses the same two-step pattern

</code_context>

<specifics>
## Specific Ideas

No specific references beyond REQUIREMENTS.md and the existing view mode pattern.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 46-targeted-reads-large-file-chunking*
*Context gathered: 2026-04-19*
