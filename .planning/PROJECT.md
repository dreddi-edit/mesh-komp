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

## Current Milestone: v2.2 — Live App Bug Fix & Editor Overhaul

**Goal:** Fix alle 8 bekannten Live-App-Bugs und Monaco-Editor komplett neu einbauen.

**Target features:**

### Editor (Monaco — kompletter Neueinbau)
- Monaco-Editor vollständig neu implementieren — kein CDN-Race-Condition, kein AMD-Polling-Hack
- Eigenes Bundle oder Worker-basiertes Setup das zuverlässig und ohne Spinner lädt

### Status Bar / Indexing
- False "Indexing..." beim Öffnen ohne Folder eliminieren

### Terminal
- Server-PTY-Fallback wenn kein lokaler Agent verbunden ist (node-pty ist bereits vorhanden)
- Terminal muss sofort nutzbar sein ohne Setup-Schritte

### Marketplace
- CORS-Problem beim Open-VSX-Fetch lösen (Backend-Proxy oder iframe-Alternative)
- Extensions werden korrekt angezeigt

### Settings
- Auth-Redirect beim Zurückgehen zum Workspace verhindern
- Theme-Default korrekt (dark, nicht light)

### Voice Agent
- AWS Polly Speech Synthesis tatsächlich aktivieren — Audio-Ausgabe im Browser

### FOUC (Flash of Unstyled Content)
- Elemente die vor JS-Initialisierung sichtbar sind verstecken

### .mesh Folder
- Qualitativ hochwertige, lesbare Inhalte in `project.json`, `files.md`, `rules.md`

## Current State

**Phase 36 complete** — Monaco Editor neueinbau (2026-04-18)

Monaco 0.52.2 self-hosted: AMD loader synchron aus node_modules, data: URL workers (CSP-safe), polling-free initMonaco(). Kein CDN, kein Race Condition. Validated in Phase 36: EDIT-07 ✓ (code), EDIT-04/05/06 pending browser verify.

**Last shipped:** v2.1 App Functionality & UX Fix Sweep (2026-04-18)

v2.1 hat 21 Requirements in 8 Phasen abgedeckt, aber die Live-App zeigt, dass viele Fixes code-technisch korrekt aber funktional unvollständig waren. v2.2 schließt diese Lücke.

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

*Last updated: 2026-04-18 — Milestone v2.2 started*
