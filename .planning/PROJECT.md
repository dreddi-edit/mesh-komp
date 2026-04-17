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

## Previous Milestone: v2.0 Full-Stack Quality Sweep (Completed)

Backend quality sweep: error classes, security middleware, code splitting, service layer DI, CI/CD, caching, AWS infrastructure. Phases 19–27.

## Current Milestone: v2.1 App Functionality & UX Fix Sweep

**Goal:** Fix the 10 major broken areas in the Mesh IDE so the app works end-to-end as intended — settings, terminal, editor, UI elements, voice agent, analytics, graph styling, and .mesh folder quality.

**Target features:**

### Settings
- Restyle settings UI to match app and landing page design language
- Fix navigation: back-to-workspace currently redirects through login screen
- Fix persistence: setting changes don't actually save

### Terminal (Validated in Phase 29)
- ✓ Fix dark grey text — xterm.js theme updated to teal palette (#c8e6f0 foreground, #0d1820 bg)
- ✓ Enable text selection and copy — Cmd+C handler with clipboard API + fallback
- ✓ Connect terminal to user's local machine — mesh-local agent package + /terminal-agent WebSocket + connect dialog UI

### Editor (Validated in Phase 30)
- ✓ Restore Monaco Editor reliability — polling-based loader fixes race condition with AMD `require`
- ✓ Welcome screen with real recent workspaces — dual storage (idb-keyval + server) survives cache clears, shows last 3 workspaces
- ✓ Remove false "Indexing..." status bar indicator on startup — `S.dirHandle` guard in `updateIndexProgressState`

### UI Elements (Validated in Phase 31)
- ✓ Stop/pause button — AbortController wired to btnSend; transforms to stop square during streaming, restores on complete/abort
- ✓ Chat panel gap — toggleChat/applyShellSnapshot manage --ch-w CSS var (0px when hidden)
- ✓ Agent Manager button — openAgentManagerStub wired to #btnOpenAgentMgr and #wAgentMgr
- ✓ Context window display — recalc() called immediately on init so label shows 0k/200k not 0k/128k
- ✓ Duplicate model dropdown — .chat-in-row select{display:none!important} hides native selects
- ✓ Duplicate mode options — same CSS rule eliminates both native selects from .chat-in-row

### Voice Agent
- Implement actual speech-to-speech (currently text-only responses)
- Fix "keeps listening" behavior that spams "sorry I didn't get that"

### Operations & Analytics
- Show real, meaningful compression analytics data
- Remove nonsensical local server log entries

### Mesh Graph
- Align graph visual design (colors, typography, layout) with the rest of the app

### .mesh Folder
- Drastically improve quality and structure of auto-generated .mesh files

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

*Last updated: 2026-04-17 — Phase 31 complete*
