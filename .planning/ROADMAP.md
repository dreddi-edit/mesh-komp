# Mesh. Roadmap

## Active Milestone: v2.15 — Compression Intelligence

**Goal:** Compute-side context assembly — pre-built symbol index, semantic query resolution, richer capsules, and targeted AST reads so the AI arrives with an exact briefing instead of reasoning about where to look.

**Phases:** 4 (Phase 43–46)
**Requirements:** 16 mapped

---

### Phase 43: Symbol Dependency Graph

**Goal:** Build a symbol-level cross-file dependency index at workspace index time — function/class declarations with exact file:line ranges, caller/callee resolution, and AI-consumable structured context.

**Status:** planned
**Depends on:** None (first v2.15 phase)
**Requirements:** SYM-01, SYM-02, SYM-03, SYM-04

**Success Criteria:**
1. Symbol index built at workspace index time contains all function/class/variable declarations with file:line ranges
2. Cross-file call chain resolution works — given a symbol, callers and callees resolve to exact file:line references
3. Symbol context exposed to AI as structured text: "X in A:L24 calls Y in B:L58 which calls Z in C:L14"
4. Single-file save triggers incremental symbol update — no full reindex

---

### Phase 44: Semantic Query Index

**Goal:** Pre-built search index over code symbols and user-facing strings — user query resolves to ranked code snippets with exact file:line ranges before AI prompt assembly.

**Status:** planned
**Depends on:** Phase 43 (symbol infrastructure)
**Requirements:** IDX-01, IDX-02, IDX-03, IDX-04

**Success Criteria:**
1. Query index built at workspace index time covers function names, class names, exported identifiers, string literals, comment keywords
2. Query "fix login button" resolves to ranked file:line matches before AI sees anything
3. Top-N results returned with file path, line range, and matched snippet
4. Incremental update on file save alongside symbol index

---

### Phase 45: Capsule Quality Improvements

**Goal:** Richer capsule content — export surfaces, outgoing call references, dependency summaries, and concrete workspace-level orientation so Claude understands the codebase holistically.

**Status:** planned
**Depends on:** Phase 43 (symbol data available)
**Requirements:** CAP-01, CAP-02, CAP-03, CAP-04

**Success Criteria:**
1. Capsule includes file's exported symbols with signatures
2. Capsule includes outgoing call references (what external symbols this file calls and where)
3. Capsule includes direct imports with resolved paths
4. Workspace summary capsule names concrete file roles (not generic "utility file" descriptions)

---

### Phase 46: Targeted Reads + Large File Chunking

**Goal:** AI reads specific AST nodes via tree-sitter extraction instead of whole files; files above threshold are chunked by AST node boundaries so large files never hit 40k token reads.

**Status:** planned
**Depends on:** None (tree-sitter already parses all files)
**Requirements:** READ-01, READ-02, READ-03, READ-04

**Success Criteria:**
1. Targeted read extracts specific function/class body by name — returns only that AST node's lines ±5 context
2. Files >300 lines chunked by AST node boundaries when whole-file read is requested
3. Targeted read API returns line range in response so AI can reference exact location
4. Chunk headers include line range so AI can request specific chunks by range

---

## Traceability

| Requirement | Phase | Category |
|-------------|-------|----------|
| SYM-01 | Phase 43 | Symbol Graph |
| SYM-02 | Phase 43 | Symbol Graph |
| SYM-03 | Phase 43 | Symbol Graph |
| SYM-04 | Phase 43 | Symbol Graph |
| IDX-01 | Phase 44 | Query Index |
| IDX-02 | Phase 44 | Query Index |
| IDX-03 | Phase 44 | Query Index |
| IDX-04 | Phase 44 | Query Index |
| CAP-01 | Phase 45 | Capsules |
| CAP-02 | Phase 45 | Capsules |
| CAP-03 | Phase 45 | Capsules |
| CAP-04 | Phase 45 | Capsules |
| READ-01 | Phase 46 | Targeted Reads |
| READ-02 | Phase 46 | Targeted Reads |
| READ-03 | Phase 46 | Targeted Reads |
| READ-04 | Phase 46 | Targeted Reads |

**Coverage:** 16/16 requirements mapped ✓

---

**Milestone Success Criteria:**
- User query "fix login button" resolves to exact file:line matches before AI prompt assembly
- Symbol dependency chain visible: button click → function → API call with file:line at each hop
- Capsules contain export surfaces, call references, and resolved import paths
- Files >300 lines never read whole — chunked or targeted by AST node

---

## Backlog: v2.2 phases (deferred, not abandoned)

[v2.2 Live App Bug Fix & Editor Overhaul — Phases 37-42](milestones/v2.2-ROADMAP-BACKLOG.md)

Phase 36 complete (Monaco self-hosted). Phases 37-42 (Terminal PTY, Marketplace, Settings, Voice, FOUC, .mesh) deferred until after v2.15.

---

<details>
<summary>v2.2 — Live App Bug Fix &amp; Editor Overhaul (Phase 36 complete, 37-42 backlog)</summary>

### Phase 36: Editor — Monaco Kompletter Neueinbau ✓ COMPLETE

**Goal:** Monaco Editor vollständig neu implementieren — AMD loader aus node_modules self-hosted, Worker korrekt konfiguriert, kein CDN, kein Polling, kein FOUC im Editor.

**Status:** complete
**Requirements:** EDIT-04, EDIT-05, EDIT-06, EDIT-07

---

### Phase 37: Terminal — Server-PTY-Fallback (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** TERM-04, TERM-05

---

### Phase 38: Marketplace — CORS-Proxy & Extension Display (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** MKT-01, MKT-02

---

### Phase 39: Settings — Auth-Fix & Theme-Default (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** SETT-04, SETT-05

---

### Phase 40: Voice Agent — Polly Speech Synthesis (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** VOIC-03

---

### Phase 41: UI — FOUC & False Indexing Fix (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** UIEL-07, UIEL-08

---

### Phase 42: .mesh Folder — Content Quality (BACKLOG)

**Status:** backlog (deferred to post-v2.15)
**Requirements:** MESH-02, MESH-03, MESH-04

</details>
