---
tags: [architecture]
---

# Compression Pipeline

## Why It Exists

Sending entire file contents to an LLM for every assistant turn is expensive and slow. Mesh's compression pipeline converts files into **capsules** — semantically structured, token-efficient representations that preserve the most useful information and can be decompressed on demand.

This is one of Mesh's core differentiators.

## Main Implementation

```
mesh-core/src/compression-core.cjs       ← main capsule pipeline
mesh-core/src/compression-utils.cjs      ← text/span utilities (sha256, token est, etc.)
mesh-core/src/tree-sitter-worker.cjs     ← AST parsing
llm-compress.js                          ← heuristic compressor + CLI; pseudo() used by capsule pipeline
```

## File Record Model

Each indexed file is stored not as raw text but as a rich record:

```javascript
{
  rawStorage,           // original file bytes (Brotli-9 compressed)
  baseCapsule,          // base capsule built at index time
  capsuleCache,         // cached capsule variants
  capsuleVariants,      // per-tier capsule objects
  focusedCapsuleCache,  // query-driven focused capsules
  spanIndex,            // recoverable span IDs and byte ranges
  transportEnvelope,    // chunking + digest for integrity/recovery
  dependencies,         // extracted import/export/require edges
  compressionStats,     // ratio metrics
  fileTypeInfo,         // language, binary flag, etc.
}
```

## Two Record Modes

| Mode | Purpose |
|------|---------|
| `initial` | Fast, lighter record. Gets the app usable immediately. |
| `full` | Richer output. Built during background enrichment. |

The pipeline is: initial record → app usable → background enrichment → full record.

## Tiny-Passthrough

Files with a raw token estimate ≤ 150 tokens (`TINY_PASSTHROUGH_THRESHOLD`) bypass the entire capsule pipeline. They are emitted as-is with a minimal one-line header:

```
CAP filename.js javascript 412B passthrough
<raw file text>
```

This avoids spending budget on files that are already small enough to include verbatim.

## Three Capsule Tiers

Each file gets three fixed capsule tiers:

| Tier | Description |
|------|-------------|
| `ultra` | Smallest useful capsule. Aggressively stripped. For large files, very compact. Uses compact `CAP` header (one line). |
| `medium` | Intermediate. More detail than ultra, still clearly compressed. Uses full `CAPSULE v2` header. |
| `loose` | Richest. Preserves the most structure and context. Uses full `CAPSULE v2` header. |

Ordering: `ultra ≤ medium ≤ loose` in both content amount and token count. For very small files, tiers may converge to within ~10% of each other.

### Compact Header (Ultra Tier)

Ultra-tier capsules use a single-line header to save tokens:

```
CAP <basename> <language> <rawBytes>B <rawTokens>T <mode>
```

Medium and loose tiers use the full three-line `CAPSULE v2` header with path, type metadata, and raw metrics.

## Pseudo-Compression (`pseudo()`)

During symbol enumeration in `buildCodeCapsule()`, the pipeline calls `llmCompress.pseudo(name, bodyText, signature)` for each symbol. If `pseudo()` recognizes the code pattern, it returns a compact LLM-readable one-liner (e.g., `"${salt}:${scryptHash}"` for a known hashing pattern). This replaces the default multi-line symbol summary with a much shorter representation.

`pseudo()` lives in `llm-compress.js` and is loaded via `safeRequire` in `compression-core.cjs`.

Each tier has distinct:
- Token budgets
- Section/item selection profiles
- Allowed span priorities
- Rendering compactness settings
- Mode preference order

## Token Budget System

`buildClampedCapsule` uses a **tiered budget** based on raw token estimate of the file:

| File size (tokens) | Budget |
|--------------------|--------|
| ≤ 500 | 60% of raw |
| ≤ 2000 | 40% of raw |
| ≤ 8000 | 25% of raw |
| > 8000 | 15% of raw |

Minimum budget floor: 160 tokens — prevents tiny files from being crushed to uselessness.

## Focused Capsules

On top of the three base tiers, focused capsules are built:
- On demand
- From a query string
- Using the relevant tier as the base

Scoring uses **word-boundary weighted matching**: exact whole-word matches score 3×, substring matches score 1×. This ensures a function definition `processUser()` ranks above a comment that merely mentions it.

Useful for: the assistant asking "show me how the auth middleware works" against a compressed workspace.

## Recovery

When a capsule is too stripped and exact source is needed:

- **Span IDs** — named recoverable spans in the span index
- **Byte ranges** — exact byte offsets in original
- **Line ranges** — for code navigation

Recovery endpoint on Worker: `workspace.recovery.fetch`

Pattern: reason with compressed context → pull exact source fragments on demand.

## Raw Storage

`encodeRawStorage` compresses file text using **Brotli sync quality 9** before base64-encoding:

```js
// Encoding: "brotli-base64"
zlib.brotliCompressSync(buffer, { params: { [BROTLI_PARAM_QUALITY]: 9 } })
```

`decodeRawStorage` handles three encodings for full backward compatibility:

| Encoding | Status |
|----------|--------|
| `brotli-base64` | Current — Brotli sync quality 9 |
| `deflate-base64` | Legacy — deflate level 6 (still decodeable) |
| `utf8-base64` | Oldest — plain base64, no compression (still decodeable) |

## Transport Envelope

Each file also gets a transport envelope with:

| Field | Description |
|-------|-------------|
| `chunkIndex` | Per-chunk manifest: rawOffset, rawLength, compressedBytes, SHA-256 digest |
| `spanIndex` | Span-to-chunk mapping for partial recovery |
| `digest` | SHA-256 of the full raw buffer |
| `rawBytes` | Uncompressed size |
| `compressedBytes` | Total compressed size across all chunks |

### Chunk Parameters

| Constant | Value | Purpose |
|----------|-------|---------|
| `DEFAULT_CHUNK_SIZE` | 256 KB | Target uncompressed bytes per chunk |
| `MAX_TRANSPORT_CHUNK_BYTES` | 256 KB | Hard cap enforced in `buildTransportEnvelope` |
| `TRANSPORT_CHUNK_PARALLELISM` | 4 (default) | Concurrent chunk compression workers |

### Chunk Compression Algorithm

Transport chunks are compressed with the best available algorithm at runtime:

| Algorithm | Condition | Settings |
|-----------|-----------|---------|
| **zstd** | Node.js 22+ (`zlib.zstdCompress` available) | Default level |
| **Brotli** | Fallback for older Node.js | Quality 9, `LGWIN: 22` (4MB window) |

The active encoding is stored in `transportEnvelope.contentEncoding` (`"zstd-chunked"` or `"brotli-chunked"`).

## Tree-Sitter Integration

`tree-sitter-worker.cjs` provides language-aware AST parsing to:
- Identify meaningful spans (functions, classes, exports)
- Score and rank which spans are most important
- Enable precision section selection per tier

Supported grammars: JavaScript, TypeScript, Python, CSS, HTML, JSON, Go.

See `package.json` for the full list of `tree-sitter-*` dependencies.

## Delta-Rebuild

When re-indexing a workspace, `openLocalWorkspace()` in `workspace-operations.js` computes a SHA-256 digest of each file's content via `compressionCore.sha256Hex()`. If the digest matches the existing record's `rawStorage.digest` and capsule variants already exist, the file is skipped entirely. This avoids redundant recompression of unchanged files.

## Workspace-Level Budget Allocation

`allocateWorkspaceBudget(fileRecords, totalBudget)` in `compression-core.cjs` distributes a global token budget (default 8000, configurable via `MESH_WORKSPACE_TOKEN_BUDGET`) proportionally across files based on an importance score:

```
importance = depCount × 2 + (recentlyReferenced ? 5 : 0) + log₂(rawTokens)
```

Each file receives at least `MIN_FILE_TOKEN_BUDGET` (24 tokens). `selectTierForBudget(record)` then picks the most compact tier that fits the allocated budget.

## Prefix Stability for KV-Cache

`buildCapsuleContextBlock()` in `src/core/workspace-context.js` sorts capsule entries alphabetically by path and splits them into stable vs dynamic groups:

- **Stable**: entries that are not truncated and not in focused mode
- **Dynamic**: truncated or focused entries

Stable entries are emitted first. This produces a deterministic prefix across assistant turns, enabling LLM provider prompt caching (KV-cache reuse).

## Context Budget

The frontend can visualize token budget via `assets/features/context-budget.js` → `/api/assistant/workspace/context-budget`.

## Capsule Viewer

`assets/features/capsule-viewer.js` renders compressed capsule representations in the IDE so users can see what the assistant actually "sees" for a file.
