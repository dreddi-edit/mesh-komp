# Mesh. — AI-Native IDE

## Overview
Mesh is a full-stack AI-native IDE and context-compression platform. The frontend is a VS Code-inspired workbench (`views/app.html`) with editor, terminal, voice-coding, chat, and graph surfaces. The backend runs on Express + Azure with tree-sitter compression, assistant orchestration, and voice agent pipelines.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS, Monaco Editor, xterm.js, D3 graph, Lottie animations
- **Backend:** Node.js, Express 5, SQLite (secure-db), Azure Blob/Cosmos
- **AI:** Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI (voice)
- **Compression:** Tree-sitter AST analysis, capsule serialization, tiered compression

## Key Surfaces
- `views/app.html` — Main IDE workbench (v1, production)
- `views/app-v2.html` — Next-gen IDE workbench (v2, in development)
- `views/index.html` — Marketing landing page
- `views/settings.html` — SPA settings hub
- `views/marketplace.html` — Extension marketplace

## Current State

**Last shipped:** v2.1 App Functionality & UX Fix Sweep (2026-04-18)

All major IDE surfaces now work end-to-end:
- Settings: restyled with design tokens, back-nav fixed, async persistence with auth warning
- Terminal: teal xterm theme, Cmd+C copy, mesh-local agent for local machine connection
- Editor: polling-based Monaco loader, welcome screen with dual-storage workspaces, indexing guard
- UI: stop button (AbortController), chat gap (CSS var), agent manager, context display, duplicate removal
- Voice: AudioContext fix, backend dead zone, ready orb state, muteSpeaker flag
- Analytics: removed fake seed, conditional rendering; Graph: muted palette, hover glow
- .mesh folder: consolidated 6 generators into provisionMeshFolder, net -453 lines

## Next Milestone

Not yet defined. Run `/gsd:new-milestone` to start planning.

**Candidates for next milestone:**
- v2 workbench (`app-v2.html`) development
- normalizeEmail dedup (blocked by circular dep — carried from v2.0)
- mesh-core monolith split (carried from v2.0)
- Global mutable state refactor completion (carried from v2.0)

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
- Based on `.planning/codebase/` audit findings

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

*Last updated: 2026-04-18 — Milestone v2.1 shipped*
