# Phase 43: Symbol Dependency Graph — Research

**Researched:** 2026-04-18
**Status:** RESEARCH COMPLETE

## Summary

Phase 43 extends the existing compression pipeline by adding two new arrays to every file record (`symbols[]` and `callSites[]`), built during the existing enrichment pipeline via a two-pass approach. The key technical challenge is that call site resolution is cross-file: pass 1 extracts all symbol declarations, pass 2 resolves call sites against the workspace-wide symbol map. The enrichment pipeline currently runs files in parallel (`mapWithConcurrency`) which must be restructured into two sequential passes.

---

## 1. Tree-Sitter Call Node Types by Grammar

Confirmed via direct parsing with installed grammars (JS, TS, Python, Go):

| Language | Call node type | Callee field / child structure |
|----------|---------------|-------------------------------|
| JavaScript | `call_expression` | function child: `identifier` (bare call) or `member_expression` (method call) |
| TypeScript | `call_expression` | same as JS |
| Python | `call` | function child: `identifier` or `attribute` (method call) |
| Go | `call_expression` | function child: `identifier` or `selector_expression` |
| Rust | Not installed | No tree-sitter-rust in node_modules — skip |
| CSS/HTML/JSON | Not applicable | No call sites in these languages |

**Callee extraction strategy for method calls:**
- JS/TS `call_expression` → `member_expression` → `property_identifier` gives the method name (e.g. `login` from `authService.login()`)
- For the workspace-wide lookup, match on the method name alone (not the object). This will produce false positives but is the practical approach without type inference.
- Python `call` → `attribute` → second `identifier` gives the method name
- Go `call_expression` → `selector_expression` → `field_identifier` gives the method name

**Implementation pattern for callee name extraction:**
```javascript
// JS/TS call_expression
function extractCalleeName(callNode, source) {
  const fn = callNode.childForFieldName('function') || callNode.namedChild(0);
  if (!fn) return null;
  if (fn.type === 'identifier') return nodeText(fn, source);                    // foo()
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property') || fn.namedChild(fn.namedChildCount - 1);
    return prop ? nodeText(prop, source) : null;                                 // obj.foo()
  }
  return null;
}

// Python call
function extractCalleeNamePy(callNode, source) {
  const fn = callNode.childForFieldName('function') || callNode.namedChild(0);
  if (!fn) return null;
  if (fn.type === 'identifier') return nodeText(fn, source);
  if (fn.type === 'attribute') {
    const attr = fn.childForFieldName('attribute') || fn.namedChild(fn.namedChildCount - 1);
    return attr ? nodeText(attr, source) : null;
  }
  return null;
}
```

---

## 2. Two-Pass Enrichment Architecture

### Problem
Current `enrichWorkspaceRecords()` processes files independently in parallel via `mapWithConcurrency`. Call site resolution requires looking up callee names across ALL file records — impossible during a parallel per-file pass.

### Solution: Sequential Two-Pass in enrichWorkspaceRecords()

**Pass 1 — Symbol extraction (existing + extension):**
- Process all files (same as today but add `symbols[]` extraction)
- For each file: extract declarations (function/class/var) with `{ name, kind, lineStart, lineEnd, signature }`
- Store result in the file record AND build an in-memory `workspaceSymbolMap: Map<symbolName, { file, lineStart, lineEnd, kind }[]>`
- This pass CAN be parallelized (no cross-file dependency)

**Pass 2 — Call site resolution:**
- Process all files sequentially (or parallel is also fine since we only READ the symbolMap)
- For each file: walk AST for call_expression nodes, extract callee names
- Look up each callee name in `workspaceSymbolMap`
- Store resolved call sites as `callSites[]` on the file record
- Update the file record in workspaceState.files and/or workspaceMetadataStore

### Integration point
Modify `enrichWorkspaceRecords()` in `mesh-core/src/workspace-operations.js` (~line 838):
1. After the existing `mapWithConcurrency` block (which now also extracts `symbols[]`): build `workspaceSymbolMap` from all file records
2. Run a second `mapWithConcurrency` pass to resolve `callSites[]` using the map
3. Upsert updated records

### Incremental updates (SYM-04)
When a single file is saved (`localWorkspaceSave()` or equivalent), the call to `buildWorkspaceFileRecord()` naturally re-extracts `symbols[]` for that file. However, `callSites[]` resolution requires the workspace-wide symbol map. 

**Pragmatic approach:** After a single-file save, rebuild `callSites[]` for that file only using the existing `workspaceSymbolMap` (held in memory in `workspaceState`). Other files' `callSites[]` that pointed INTO this file remain stale but correct (line numbers may shift). Full call site re-resolution across all files happens only on full workspace reindex/enrichment.

This means: add a `workspaceState.symbolMap` (or local variable in the enrichment closure) that persists after enrichment completes, so incremental saves can use it.

---

## 3. File Record Extension

### New fields on file record (returned by buildWorkspaceFileRecord)

```javascript
symbols: [
  {
    name: 'login',
    kind: 'function_declaration',   // tree-sitter node type
    lineStart: 58,
    lineEnd: 72,
    signature: 'async function login(userId, password)',
  },
  // ...
],
callSites: [
  {
    callerLine: 24,                  // line in THIS file where the call occurs
    calleeName: 'login',             // extracted callee identifier
    resolvedFile: 'src/auth.js',     // null if not resolved
    resolvedLine: 58,                // null if not resolved
  },
  // ...
],
```

### Caps
- `MAX_SYMBOLS_PER_FILE = 1200` (reuse existing MAX_SYMBOL_DISCOVERY)
- `MAX_CALL_SITES_PER_FILE = 200` — reasonable limit; files with more call sites likely have shallow logic
- Dedup: keep only the first occurrence of each `(calleeName, resolvedFile)` pair if same callee is called multiple times

---

## 4. DynamoDB Item Size

DynamoDB item limit: 400KB per item.

Current file record size estimate for a mid-sized file (~500 lines):
- rawStorage (brotli-compressed): ~5-20KB
- capsule variants: ~10-30KB total
- spanIndex: ~5-15KB

Adding 200 call sites × ~80 bytes each = ~16KB, plus 100 symbols × ~100 bytes = ~10KB.

**Total addition: ~26KB per file.** Well within 400KB limit for typical files. For very large, well-connected files (>1000 call sites would be truncated to 200 anyway). No issue.

---

## 5. Call Site Resolution — Workspace Symbol Map

### Building the map (in-memory, built at enrichment time)

```javascript
// After pass 1: build workspace-wide symbol index
const workspaceSymbolMap = new Map(); // name → [{ file, lineStart, lineEnd, kind }]
for (const [path, record] of workspaceState.files) {
  for (const sym of (record.symbols || [])) {
    const existing = workspaceSymbolMap.get(sym.name) || [];
    existing.push({ file: path, lineStart: sym.lineStart, lineEnd: sym.lineEnd, kind: sym.kind });
    workspaceSymbolMap.set(sym.name, existing);
  }
}
// Store on workspaceState for incremental use
workspaceState.symbolMap = workspaceSymbolMap;
```

### Resolving a call site
```javascript
function resolveCallSite(calleeName, callerFile, workspaceSymbolMap) {
  const candidates = workspaceSymbolMap.get(calleeName) || [];
  if (!candidates.length) return null;
  // Prefer same file (self-call)
  const samefile = candidates.find(c => c.file === callerFile);
  if (samefile) return samefile;
  // Single match — unambiguous
  if (candidates.length === 1) return candidates[0];
  // Multiple matches — return all; AI can use context to disambiguate
  return candidates[0]; // Return most likely (first found during enrichment)
}
```

---

## 6. Validation Architecture

### SYM-01 (Symbol index built at index time)
- **Unit test:** Pass a sample JS/TS file through `buildWorkspaceFileRecord()` → verify `record.symbols` is a non-empty array with `name`, `lineStart`, `lineEnd`, `kind` fields
- **Integration:** After `enrichWorkspaceRecords()` completes, verify `workspaceState.files` entries have `symbols[]` populated

### SYM-02 (Cross-file call chain resolution)
- **Unit test:** Pass two files (A calls B's function) through `buildWorkspaceFileRecord()` with `workspaceFilePaths` and a pre-built symbolMap → verify `record.callSites` contains `{ resolvedFile: 'B', resolvedLine: N }`
- **Integration:** After full enrichment, query `getWorkspaceGraph()` for symbol-level edges → verify cross-file edges exist

### SYM-03 (AI-consumable structured context)
- **Unit test:** Call `formatSymbolChain(callSites, workspaceState)` → verify output string matches `"X in A:L24 calls Y in B:L58"` pattern
- **Integration:** Check chat context assembly includes symbol context block when callSites exist

### SYM-04 (Incremental update on file save)
- **Test:** Save a single file via `localWorkspaceSave()` → verify the saved file's record has updated `symbols[]` and `callSites[]` without triggering full reindex
- **Verification:** Check `workspaceState.symbolMap` is updated for the saved file's declarations

---

## 7. Integration Points Summary

| File | Change | Purpose |
|------|--------|---------|
| `mesh-core/src/compression-core.cjs` | Add `extractSymbolDeclarations()` (refactor from walkTree) + `extractCallSites(tree, rawText, parserFamily)` function | Symbol + call site extraction |
| `mesh-core/src/compression-core.cjs` | `buildWorkspaceFileRecord()` — add `symbols[]` and `callSites[]` to returned record | Data model extension |
| `mesh-core/src/workspace-operations.js` | `enrichWorkspaceRecords()` — two-pass restructure, build/store `workspaceState.symbolMap` | Cross-file resolution |
| `mesh-core/src/workspace-operations.js` | `workspaceState` object — add `symbolMap: new Map()` field | Incremental update support |
| `mesh-core/src/workspace-operations.js` | Post-save hook (called from wherever file saves occur) — update single file's `symbols[]` + `callSites[]` | SYM-04 |
| `mesh-core/src/workspace-operations.js` | `getWorkspaceGraph()` — extend to include symbol-level edges optionally | AI context access |

The `src/core/workspace/files.js` file calls `buildWorkspaceFileRecord()` directly for save operations — the returned record will automatically include `symbols[]` and `callSites[]` once `buildWorkspaceFileRecord()` is extended. The cross-file `callSites[]` resolution (which needs the symbolMap) requires a separate post-save step.

---

## RESEARCH COMPLETE
