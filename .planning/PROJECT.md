# Mesh. — AI-Native IDE

## Overview
Mesh is a full-stack AI-native IDE and context-compression platform. The frontend is a VS Code-inspired workbench (`views/app.njk`) with editor, terminal, voice-coding, chat, and graph surfaces. The backend runs on Express + Azure with tree-sitter compression, assistant orchestration, and voice agent pipelines.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS, Monaco Editor, xterm.js, D3 graph, Lottie animations
- **Backend:** Node.js, Express 5, SQLite (secure-db), Azure Blob/Cosmos
- **AI:** Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI (voice)
- **Compression:** Tree-sitter AST analysis, capsule serialization, tiered compression

## Key Surfaces
- `views/app.njk` — Main IDE workbench (production)
- `views/index.njk` — Marketing landing page
- `views/settings.njk` — SPA settings hub
- `views/marketplace.njk` — Extension marketplace

## Current Milestone: v2.15 — Compression Intelligence

**Goal:** Make Mesh's compression pipeline a sharp competitive moat — compute-side context assembly so the AI arrives with a pre-built briefing (exact file:line ranges) instead of reasoning about where to look.

**Target features:**

### Symbol Dependency Graph
- Cross-file call chain resolution with exact line numbers (onClick at LoginButton.tsx:24 → authService.login() at auth.ts:58 → POST /api/auth at routes.js:14)
- Symbol-level index built at workspace index time, not at query time
- Exposes to AI as structured context: "button X calls function Y at file:line"

### Semantic Query Index
- Pre-built search index over code symbols and user-facing text
- Query "fix login button" resolves to exact file:line matches before AI sees anything
- Compute does the search, AI gets the answer

### Capsule Quality Improvements
- Richer capsule content: export surfaces, dependency edges, call graph summaries
- Better project-level orientation so Claude understands the codebase holistically

### Targeted Reads + Large File Chunking
- AI reads specific function/class via tree-sitter AST, not the whole file
- Files above threshold chunked by AST node — no more 40k token reads for a 10k-line file

## Current State

**Milestone v2.15 in progress** (2026-04-18) — Compression Intelligence

Phase 44 complete: Semantic Query Index shipped. `workspaceState.queryIndex` (inverted token index) built in enrichment Pass 3 from all symbols + string literals. `searchWorkspace()` now returns `snippets[]`. `localWorkspaceSave()` maintains index incrementally. 8/8 tests pass.

Phase 43 complete: Symbol Dependency Graph — per-file `symbols[]` and `callSites[]` with cross-file resolution.

Still missing: capsule quality improvements (Phase 45), targeted reads / large file chunking (Phase 46+).

**Last shipped:** v2.2 partial — Phase 36 complete (Monaco self-hosted, no CDN/polling). v2.1 shipped 2026-04-18.

<details>
<summary>Previous Milestones</summary>

### v2.1 App Functionality & UX Fix Sweep (Shipped 2026-04-18)
Fix all broken and non-functional surfaces in the Mesh IDE so the app works end-to-end. 8 phases (28–35), 26 plans, 21 requirements, 78 commits, +12,404/-25,144 lines.
[Full archive](milestones/v2.1-ROADMAP.md)

### v2.0 Full-Stack Quality Sweep (Completed)
Backend quality sweep: error classes, security middleware, code splitting, service layer DI, CI/CD, caching, AWS infrastructure. Phases 19–27.

</details>

## Constraint
- Brownfield: all improvements layered onto working v1.0 codebase
- Monaco: komplett neu — kein Patch auf altem Code
- Terminal: node-pty bereits installiert, nutzen statt neuer Dependencies

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

*Last updated: 2026-04-18 — Phase 44 complete (Semantic Query Index)*
