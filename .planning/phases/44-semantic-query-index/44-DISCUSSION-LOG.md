# Phase 44: Semantic Query Index - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 44-semantic-query-index
**Areas discussed:** Index storage format, What to index (content scope), Scoring algorithm, Query injection point, String literal extraction, Snippet format, Index build timing, Index persistence

---

## Index storage format

| Option | Description | Selected |
|--------|-------------|----------|
| Global inverted Map | `workspaceState.queryIndex: Map<token, [{file, lineStart, lineEnd, snippet, kind}]>` — mirrors symbolMap, O(1) lookup | ✓ |
| Per-file queryTokens[] | Array on each file record, O(files) scan at query time | |
| Flat sorted array | Binary search, complex incremental updates | |

**User's choice:** Global inverted Map
**Notes:** Mirrors Phase 43 symbolMap pattern exactly.

---

## What to index (content scope)

| Option | Description | Selected |
|--------|-------------|----------|
| Symbols + string literals | Names, signatures, AST string nodes — skips comments | ✓ |
| Symbols only | Names + signatures from symbols[], no extra AST pass | |
| Symbols + strings + comments | Maximum recall, highest noise | |

**User's choice:** Symbols + string literals
**Notes:** Comments explicitly excluded as too noisy.

---

## Scoring algorithm

| Option | Description | Selected |
|--------|-------------|----------|
| Token overlap + type boost | Base overlap count + +40 function/class, +25 exported, +15 string_literal | ✓ |
| Token overlap only | Pure count, no kind weighting | |
| TF-IDF | Overkill for 50-500 file workspaces, complex incremental | |

**User's choice:** Token overlap + type boost
**Notes:** Boosts: +40 function/class, +25 exported, +15 string_literal. Sort: score DESC, lineStart ASC.

---

## Query injection point

| Option | Description | Selected |
|--------|-------------|----------|
| Augment searchWorkspace response | Add snippets[] alongside matches[] — backward compatible | ✓ |
| New queryIndex() operation | Separate op, callers opt in | |
| Inject at prompt assembly | Inject in system prompt before AI call | |

**User's choice:** Augment searchWorkspace response
**Notes:** All callers (run-lifecycle, voice-agent, realtime) get snippets automatically.

---

## Top-N snippets

| Option | Description | Selected |
|--------|-------------|----------|
| Top-5 | Default, configurable via env var | ✓ |
| Top-3 | Minimal overhead | |
| Top-10 | Maximum recall | |

**User's choice:** Top-5
**Notes:** Configurable via `MESH_CAPSULE_MAX_QUERY_SNIPPETS`, clamped 1-20.

---

## String literal extraction

| Option | Description | Selected |
|--------|-------------|----------|
| walkTree + string node types | Reuse Phase 43 walkTree, add STRING_NODE_TYPES set | ✓ |
| Regex fallback only | Skip AST extraction for strings, regex for text path | |
| Claude decides | Defer to implementation | |

**User's choice:** walkTree + string node types
**Notes:** Node types: string, string_fragment, template_string, interpreted_string_literal. Filter: <4 chars, numeric-only, pure punctuation. Max 80 chars per literal.

---

## Snippet format

| Option | Description | Selected |
|--------|-------------|----------|
| Signature + first line | signature from symbols[] for symbol hits, raw value for string hits — no file I/O | ✓ |
| Raw source lines ±3 context | Re-read file at query time | |
| Capsule section text | Reuse compressed capsule sections | |

**User's choice:** Signature + first line
**Notes:** No file I/O at query time. Uses data already in memory from Phase 43 symbols[].

---

## Index build timing

| Option | Description | Selected |
|--------|-------------|----------|
| Pass 3 in enrichWorkspaceRecords | Sequential after Phase 43 Pass 1 + Pass 2 | ✓ |
| Separate enrichQueryIndex() call | Explicit call, optional | |
| Inline during Pass 1 | Fold into symbolMap pass | |

**User's choice:** Pass 3 in enrichWorkspaceRecords
**Notes:** Same enrichment lifecycle as symbolMap. No new entry points.

---

## Index persistence

| Option | Description | Selected |
|--------|-------------|----------|
| RAM-only, rebuilt on load | Same lifecycle as symbolMap — reset on workspace select, rebuilt during enrichment | ✓ |
| Persisted to metadata store | Complex schema, serialization issues with Map<> | |
| Claude decides | Defer to implementation | |

**User's choice:** RAM-only
**Notes:** Consistent with symbolMap pattern.

---

## Claude's Discretion

- Tokenization function implementation details (reuse extractSearchTokens or extend it)
- Max string literals per file cap value
- Exact stop word handling for string literal tokenization

## Deferred Ideas

None — discussion stayed within phase scope.
