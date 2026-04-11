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
llm-compress.js                          ← legacy/heuristic fallback + CLI
```

## File Record Model

Each indexed file is stored not as raw text but as a rich record:

```javascript
{
  rawStorage,           // original file bytes (for upload: in Blob)
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

## Three Capsule Tiers

Each file gets three fixed capsule tiers:

| Tier | Description |
|------|-------------|
| `ultra` | Smallest useful capsule. Aggressively stripped. For large files, very compact. |
| `medium` | Intermediate. More detail than ultra, still clearly compressed. |
| `loose` | Richest. Preserves the most structure and context. |

Guarantee: `ultra < medium < loose` in both content amount and token count.

Small files are treated more gently — the system doesn't destroy meaning for tiny inputs.

Each tier has distinct:
- Token budgets
- Section/item selection profiles
- Allowed span priorities
- Rendering compactness settings
- Mode preference order

## Focused Capsules

On top of the three base tiers, focused capsules are built:
- On demand
- From a query string
- Using the relevant tier as the base

This allows: compress generally → re-expand selectively around a query.

Useful for: the assistant asking "show me how the auth middleware works" against a compressed workspace.

## Recovery

When a capsule is too stripped and exact source is needed:

- **Span IDs** — named recoverable spans in the span index
- **Byte ranges** — exact byte offsets in original
- **Line ranges** — for code navigation

Recovery endpoint on Worker: `workspace.recovery.fetch`

Pattern: reason with compressed context → pull exact source fragments on demand.

## Transport Envelope

Files may also have a transport envelope with:
- Chunk manifest
- SHA256 digest per chunk
- Integrity/recovery metadata

Used for chunked storage and index reconstruction.

## Tree-Sitter Integration

`tree-sitter-worker.cjs` provides language-aware AST parsing to:
- Identify meaningful spans (functions, classes, exports)
- Score and rank which spans are most important
- Enable precision section selection per tier

Supported grammars: JavaScript, TypeScript, Python, CSS, HTML, JSON, Go.

See `package.json` for the full list of `tree-sitter-*` dependencies.

## Context Budget

The frontend can visualize token budget via `assets/features/context-budget.js` → `/api/assistant/workspace/context-budget`.

## Capsule Viewer

`assets/features/capsule-viewer.js` renders compressed capsule representations in the IDE so users can see what the assistant actually "sees" for a file.
