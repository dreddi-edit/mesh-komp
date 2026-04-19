# Phase 46: Targeted Reads + Large File Chunking — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 46-targeted-reads-large-file-chunking
**Areas discussed:** API surface, Chunking mode, Chunk size

---

## API Surface

| Option | Description | Selected |
|--------|-------------|----------|
| New viewMode="targeted" | Consistent with existing view modes; same route, same caller interface | ✓ |
| Standalone extractSymbolFromRecord() | New exported function; requires callers to add a new code path | |
| New route /workspace/symbol | Dedicated HTTP endpoint; adds route file + round-trip | |

**User's choice:** `viewMode="targeted"` — keep it inside `buildWorkspaceFileView()` consistent with existing modes.

---

## Chunking Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit: return whole file, AI requests chunks | Existing view="original" unchanged; AI opts into view="chunk" | |
| Transparent: auto-chunk >300 line files | view="original" on large file returns chunk 0 + metadata automatically | ✓ |

**User's choice:** Transparent auto-chunking — `view="original"` on >300-line files automatically returns chunk 0 with `{chunked, chunkIndex, totalChunks, lineRange}` metadata. Small files unchanged.

---

## Chunk Size

| Option | Description | Selected |
|--------|-------------|----------|
| Fixed target + AST snap | ~150 lines per chunk, snapped to nearest top-level AST boundary | ✓ |
| One symbol per chunk | Each top-level AST node is its own chunk; variable-size chunks | |

**User's choice:** Fixed ~150-line target with AST boundary snapping — predictable chunk count, never splits inside a function or class.

---

## Claude's Discretion

- Whether to pre-compute and cache chunk boundaries at record build time
- Maximum `contextLines` cap for targeted reads
- Whether `view="targeted"` returns capsule section data alongside plain text

## Deferred Ideas

None.
