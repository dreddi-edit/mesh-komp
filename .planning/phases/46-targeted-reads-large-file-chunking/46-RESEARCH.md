# Phase 46: Targeted Reads + Large File Chunking — Research

## RESEARCH COMPLETE

---

## Key Findings

### 1. Insertion Point: `buildWorkspaceFileView()` in `compression-core.cjs`

The function is at line 2533 of `mesh-core/src/compression-core.cjs` and exported directly. It already dispatches on `normalizedView` with sequential `if` branches for `"compressed"`, `"transport"`, `"capsule"`, `"focused"`, and a final fallthrough `"original"`.

**Pattern for new modes:** Every branch does:
```js
const rawText = decodeRawStorage(record.rawStorage);
// compute content
return { ...base, view: "targeted", content, encoding: "plain-text", ...extras };
```

New `view="targeted"` and transparent chunking in `view="original"` both fit this exact pattern.

### 2. Line Extraction Utilities (Ready to Reuse)

**`buildLineStarts(text)`** — in `compression-utils.cjs` (line 82), already imported by `compression-core.cjs`. Returns array of char offsets for line starts. `lineStarts.length` = total line count.

**`sliceTextByLines(text, lineStarts, lineStart, lineEnd)`** — in `compression-utils.cjs` (line 120), already imported. Takes 1-based inclusive line numbers, returns the raw text slice. Works correctly:
```
sliceTextByLines(text, ls, 2, 4) → "line2\nline3\nline4"
```

**`recoverWorkspaceFileRecord()`** (line 2650) already uses this exact two-step pattern — build `lineStarts`, then `sliceTextByLines`. This is the direct reference implementation for targeted read.

### 3. Symbol Shape (Phase 43 Output)

`record.symbols[]` is populated by `buildWorkspaceFileRecord()` from the AST walk:
```json
{
  "name": "foo",
  "kind": "function_declaration",
  "lineStart": 2,
  "lineEnd": 5,
  "signature": "function foo(a)",
  "isExported": false
}
```

All fields confirmed working. `lineStart`/`lineEnd` are 1-based. Nested symbols (like `method_definition` inside a class, `lexical_declaration` inside a function) are also included — the targeted read lookup should prefer top-level symbols (function/class/arrow at top scope) when multiple names match.

### 4. Chunk Boundary Snapping Algorithm

For a file with N lines, target T=150 lines/chunk:
1. Build `lineStarts` once (length = total line count)
2. Compute ideal chunk boundaries: `[0, T, 2T, 3T, ...]` 
3. For each ideal boundary `b`, find the symbol in `record.symbols` whose `lineEnd` is closest to `b` from below (≤ b). Snap to that `lineEnd`.
4. If no symbol boundary found near `b` (sparse symbol map, or no symbols), fall back to exact line boundary.
5. Chunk 0 = lines 1 to snapped boundary 1. Chunk 1 = next boundary+1 to snapped boundary 2. Etc.

**Caching strategy:** Compute `chunkBoundaries` lazily on first `view="original"` request for files >300 lines, cache on `record.chunkBoundaries = [{start, end}, ...]`. Avoids recompute on repeated requests.

### 5. No Route Changes Needed

`/api/assistant/workspace/file` (line 193, `assistant-workspace.routes.js`) passes `req.query` options to `openWorkspaceFileWithFallback` → `buildWorkspaceFileView`. Adding `symbolName`, `contextLines`, and `chunkIndex` to the route just requires passing them through `options`:
```js
symbolName: String(req.query.symbolName || '').trim(),
contextLines: Number(req.query.contextLines) || 5,
chunkIndex: Number.isFinite(Number(req.query.chunkIndex)) ? Number(req.query.chunkIndex) : 0,
```
No new route file, no new endpoint.

### 6. Constants to Add

```js
const LARGE_FILE_LINE_THRESHOLD = 300;   // READ-02 requirement
const CHUNK_TARGET_LINES = 150;          // D-05 from CONTEXT.md
const MAX_CONTEXT_LINES = 20;            // D-discretion from CONTEXT.md
```

### 7. Chunk Header Format (READ-04)

Prepended to chunk content:
```
## {basename} lines {start}-{end} (chunk {N+1}/{total})
```
Example: `## server.js lines 1-148 (chunk 1/4)`

### 8. Response Shapes

**`view="targeted"` response:**
```json
{
  "ok": true,
  "path": "...",
  "view": "targeted",
  "symbolName": "login",
  "lineRange": { "start": 10, "end": 25 },
  "content": "function login(...) {\n  ...\n}",
  "encoding": "plain-text",
  "fallback": false
}
```
If symbol not found: `fallback: true`, returns full original content.

**`view="original"` on large file (transparent chunk 0):**
```json
{
  "ok": true,
  "path": "...",
  "view": "original",
  "content": "## server.js lines 1-148 (chunk 1/4)\n...",
  "encoding": "plain-text",
  "chunked": true,
  "chunkIndex": 0,
  "totalChunks": 4,
  "lineRange": { "start": 1, "end": 148 }
}
```

### 9. Test Strategy

Tests go in `test/` as CommonJS `.test.cjs` files, using `node:test` + `assert/strict`. Pattern matches existing tests: call `buildWorkspaceFileRecord(path, code)` to build a record, then call `buildWorkspaceFileView(record, "targeted", {symbolName: "foo"})`.

**READ-01:** Targeted view extracts correct lines for named symbol
**READ-02:** File >300 lines triggers transparent chunking (returns `chunked: true`)  
**READ-03:** Response includes `lineRange.start`/`lineRange.end`
**READ-04:** Chunk content starts with header line matching format `## filename lines X-Y (chunk N/total)`

### 10. Module.exports Update Required

After adding `LARGE_FILE_LINE_THRESHOLD` and `CHUNK_TARGET_LINES` as exported constants (other phases may need them), update the `module.exports` at line 2893 of `compression-core.cjs`.

---

## Files to Modify

| File | Change |
|------|--------|
| `mesh-core/src/compression-core.cjs` | Add `view="targeted"` branch + transparent chunking in `view="original"` + new constants |
| `src/routes/assistant-workspace.routes.js` | Pass `symbolName`, `contextLines`, `chunkIndex` from `req.query` to options |
| `test/targeted-read.test.cjs` | New test file — READ-01/03 |
| `test/file-chunking.test.cjs` | New test file — READ-02/04 |

---

## Validation Architecture

### Test Coverage by Requirement

| Requirement | Test | Verification Method |
|-------------|------|---------------------|
| READ-01 | `targeted-read.test.cjs` | `buildWorkspaceFileView(record, "targeted", {symbolName: "foo"})` returns content matching symbol lines |
| READ-02 | `file-chunking.test.cjs` | `buildWorkspaceFileView(record, "original")` on >300-line file returns `chunked: true`, `totalChunks > 1` |
| READ-03 | `targeted-read.test.cjs` | Response has `lineRange.start` and `lineRange.end` as integers |
| READ-04 | `file-chunking.test.cjs` | `content` starts with `## filename lines X-Y (chunk 1/N)` |

### Test Commands
```bash
node --test --test-force-exit test/targeted-read.test.cjs
node --test --test-force-exit test/file-chunking.test.cjs
```

### Regression Tests (prior phases)
```bash
node --test --test-force-exit test/symbol-index.test.cjs test/call-site-resolution.test.cjs test/symbol-context-format.test.cjs test/symbol-incremental.test.cjs test/query-index-build.test.cjs test/query-index-search.test.cjs test/query-index-incremental.test.cjs test/capsule-exports.test.cjs test/capsule-calls.test.cjs test/capsule-imports.test.cjs test/file-roles.test.cjs
```
