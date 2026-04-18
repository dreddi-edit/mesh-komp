# Phase 43: Symbol Dependency Graph — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-18
**Phase:** 43-symbol-dependency-graph
**Areas discussed:** Symbol index storage, Call resolution strategy, Chain traversal depth, AI context surface format

---

## Symbol Index Storage

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file in file record | symbols[] array per file record alongside dependencies[]. Incremental by default. | ✓ |
| Global RAM symbol map | workspaceState.symbolMap — fast queries, lost on restart. | |
| Separate SQLite index file | Dedicated DB per workspace. Survives restarts, new dependency. | |

**User's choice:** Per-file in file record
**Notes:** Consistent with how dependencies[] already works. Incremental by default — single file save updates only that file's record.

---

## Call Resolution Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| AST call_expression traversal | Walk tree-sitter AST for call sites, match against symbol index. Exact file:line. | ✓ |
| Import-graph inference only | Reuse existing dependencies[] — file-level, no line numbers for call sites. | |
| Hybrid (AST + import fallback) | AST where grammar supports it, import-graph as fallback. In practice identical to option 1. | |

**User's choice:** AST call_expression traversal
**Notes:** Falls back to import-graph for grammars that don't expose call_expression nodes.

---

## Chain Traversal Depth

| Option | Description | Selected |
|--------|-------------|----------|
| 1-hop at index, n-hop at query | Store direct callees at index time. Follow edges at query time for deeper chains. | ✓ |
| 2-hop at index time | Pre-compute A→B→C during enrichment. Requires dependency-ordered processing. | |
| 1-hop direct only (always) | Never go deeper than direct calls. Misses important context in many flows. | |

**User's choice:** 1-hop at index, n-hop at query
**Notes:** Keeps enrichment time bounded. Depth is unlimited at query time since edges are stored.

---

## AI Context Surface Format

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid: capsule + query-time injection | Phase 45 adds outgoing refs to capsules. Phase 44 injects Symbol Context block at query time. | ✓ |
| Capsule-only | All symbol data in capsule text. Simple but potentially bloated for well-connected files. | |
| Separate injected block only | Symbol context always injected, no capsule changes. Defers capsule enrichment to Phase 45. | |

**User's choice:** Hybrid: capsule + query-time injection
**Notes:** Phase 43 builds data layer only. Phase 44 and 45 own the surfacing.

---

## Claude's Discretion

- MAX_CALL_SITES cap per file (suggested 200)
- Whether to deduplicate call sites to same (callee, resolvedFile) pair
- tree-sitter node type names for call_expression equivalents per grammar

## Deferred Ideas

- Vector embeddings for fuzzy symbol name matching — future phase
- Real-time symbol streaming to clients on file save — future phase
- Cross-workspace / monorepo symbol resolution — future phase
- Type inference / return type tracking — requires TypeScript compiler, out of scope
