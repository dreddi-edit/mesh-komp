# Requirements: Mesh v2.15 — Compression Intelligence

**Defined:** 2026-04-18
**Core Value:** Compute-side context assembly — the AI arrives with a pre-built briefing (exact file:line ranges, resolved symbols, ranked snippets) instead of reasoning about where to look. Compression becomes a sharp competitive moat.

## v1 Requirements

### Symbol Dependency Graph

- [ ] **SYM-01**: Symbol-level index built at workspace index time — captures function/class/variable declarations with exact file and line ranges across all workspace files
- [ ] **SYM-02**: Cross-file call chain resolution — given a symbol, the system resolves callers and callees with exact file:line references (not file-level import edges)
- [ ] **SYM-03**: Dependency graph exposed as structured AI context — "button X in file A:L24 calls function Y in file B:L58 which calls endpoint Z in file C:L14"
- [ ] **SYM-04**: Symbol index incrementally updated on file save — no full reindex required for single-file edits

### Semantic Query Index

- [x] **IDX-01**: Pre-built search index over code symbols, function names, and user-facing text strings built at workspace index time
- [x] **IDX-02**: Query resolution at request time — user entry phrase resolves to ranked code snippets with exact file:line ranges before AI sees anything
- [x] **IDX-03**: Index covers at minimum: function names, class names, exported identifiers, string literals, and comment keywords
- [x] **IDX-04**: Query index incrementally updated on file save alongside symbol index

### Capsule Quality Improvements

- [ ] **CAP-01**: Capsule content includes export surfaces — what the file exports and what each export's signature is
- [ ] **CAP-02**: Capsule content includes outgoing call references — which external symbols this file calls and where (file:line)
- [ ] **CAP-03**: Capsule content includes dependency summary — direct imports listed with resolved paths
- [ ] **CAP-04**: Project-level orientation capsule (workspace summary) references concrete file roles, not generic descriptions

### Targeted Reads + Large File Chunking

- [ ] **READ-01**: AI reads specific AST nodes (function/class body) via tree-sitter extraction — not the whole file — when a targeted symbol is known
- [ ] **READ-02**: Files above a line threshold (300 lines) are chunked by AST node boundaries when a whole-file read is requested
- [ ] **READ-03**: Targeted read API returns the exact lines of the requested symbol plus configurable context lines (default ±5)
- [ ] **READ-04**: Large file chunking produces numbered chunks with line range headers so AI can request specific chunks by range

## v2 Requirements

Deferred to future release.

- Real-time symbol streaming — push symbol index diffs to connected clients as files change
- Vector embeddings for semantic similarity search (beyond keyword matching)
- Cross-workspace symbol resolution (monorepo support)

## Out of Scope

| Feature | Reason |
|---------|--------|
| LSP / IntelliSense | Language server protocol is a separate runtime concern — not compression |
| Type inference | Requires full TypeScript compiler — out of scope for this milestone |
| Remote workspace indexing | S3-hosted workspaces indexed on demand only — incremental index requires local file events |
| v2.2 phases 37-42 | Terminal PTY, Marketplace, Settings, Voice, FOUC, .mesh deferred to backlog |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| SYM-01 | Phase 43 | Planned |
| SYM-02 | Phase 43 | Planned |
| SYM-03 | Phase 43 | Planned |
| SYM-04 | Phase 43 | Planned |
| IDX-01 | Phase 44 | Planned |
| IDX-02 | Phase 44 | Planned |
| IDX-03 | Phase 44 | Planned |
| IDX-04 | Phase 44 | Planned |
| CAP-01 | Phase 45 | Planned |
| CAP-02 | Phase 45 | Planned |
| CAP-03 | Phase 45 | Planned |
| CAP-04 | Phase 45 | Planned |
| READ-01 | Phase 46 | Planned |
| READ-02 | Phase 46 | Planned |
| READ-03 | Phase 46 | Planned |
| READ-04 | Phase 46 | Planned |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16 ✓
- Unmapped: 0

---
*Requirements defined: 2026-04-18*
