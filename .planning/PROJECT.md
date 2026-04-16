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

## Current Milestone: v2.0 Full-Stack Quality Sweep

**Goal:** Harden security, improve code quality, expand test coverage, add CI/CD, polish UI/UX, and ship remaining performance optimizations across the entire Mesh platform.

**Target features:**

### Security
- Eliminate innerHTML XSS surface in frontend JS
- Tighten CSP (remove unsafe-inline)
- Wire up CORS middleware
- Replace hand-rolled validators with Zod
- Add CSRF token layer
- Enforce demo user password strength

### Performance
- Async HTML serving (replace readFileSync on request path)
- Workspace Map eviction policy (bounded heap)
- Rate limiter store cleanup improvements
- HTTP cache headers on API responses
- Anthropic prompt caching + Bedrock singleton + maxTokens fix (Phase 18)
- Parallelize workspace enrichment

### Code Quality
- ~~Split 8 monolith files (>1,000 lines each)~~ — Validated in Phase 24: 5 of 7 monoliths split; mesh-core deferred
- Refactor global mutable state out of index.js (partial — service layer DI pattern established in Phase 25)
- ~~Deduplicate toSafePath~~ — Validated in Phase 24: single definition in infrastructure/path-utils.js
- Deduplicate normalizeEmail (blocked by circular dep — deferred)
- ~~Introduce service layer + DTOs~~ — Validated in Phase 25: 4 domain service factories with DI pattern
- ~~Add typed error class hierarchy~~ — Validated in Phase 19
- ~~Centralized async error handling middleware~~ — Validated in Phase 19
- ~~Clean up empty directories~~ — Validated in Phase 19
- ~~Split model-providers.js into per-provider modules~~ — Validated in Phase 24: providers/ directory with 9 files

### Testing
- Test coverage for 6 untested core modules
- Set up CI/CD pipeline (GitHub Actions)
- Create E2E test suite with Puppeteer
- Add frontend smoke tests

### UI/UX
- CSS custom properties / design token system
- Accessibility pass (ARIA, keyboard nav)
- Extract shared HTML into template partials
- Add build/bundle step + lazy loading
- Responsive design framework
- Vendor animejs properly

### Infrastructure
- GitHub Actions CI/CD
- Structured error monitoring (Sentry or equivalent)
- OpenAPI/Swagger documentation
- Dependency scanning (npm audit / Snyk)
- Database migration strategy

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
