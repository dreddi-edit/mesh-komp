# Phase 25: Code Quality — Service Layer + Global State Refactor - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Introduce service layer between routes and core. Refactor global mutable state in src/core/index.js to explicit dependency passing. Add DTOs for request/response boundaries. Highest-risk refactor — done last with full test coverage.

</domain>

<decisions>
## Implementation Decisions

### Service Layer
- **D-01:** Create `src/services/` with service modules for each domain: `workspace-service.js`, `assistant-service.js`, `auth-service.js`, `voice-service.js`
- **D-02:** Routes call service functions, services call core functions — routes never call core directly
- **D-03:** Services encapsulate business logic coordination — core modules handle domain operations
- **D-04:** Services receive dependencies via constructor/factory pattern, not via global imports

### Global State Refactor
- **D-05:** `src/core/index.js` currently assigns shared mutable state to module-level variables: `localAssistantWorkspace`, `workspaceMetadataStore`, `operationsStore`, `workspaceOffloadConfig`
- **D-06:** Replace with explicit dependency passing — either function parameters or a context object
- **D-07:** `assistantRuns`, `assistantTerminalSessions`, `workspaceSelectJobs`, `workspaceSelectChains` Maps (now LRU from Phase 19) — injected into services rather than accessed as globals
- **D-08:** No race conditions under concurrent requests — verified by concurrent test

### DTOs
- **D-09:** Create request/response DTOs at service boundaries — raw `req.body` doesn't pass through to core
- **D-10:** DTOs can be plain objects with JSDoc type annotations (no TypeScript) — consistent with project conventions

### Claude's Discretion
- Exact dependency injection pattern (constructor injection, factory functions, or context object)
- DTO granularity (per-endpoint vs. per-domain)
- Whether to use a dependency container or manual wiring
- Migration strategy (big bang vs. route-by-route)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Global State
- `.planning/codebase/CONCERNS.md` §3 (Technical Debt → Global State) — Documents tight coupling, hidden dependencies, race condition risk
- `.planning/codebase/ARCHITECTURE.md` §Key Abstractions → Global State Pattern — How `src/core/index.js` acts as wiring hub

### Missing Abstractions
- `.planning/codebase/CONCERNS.md` §3 (Technical Debt → Missing Abstractions) — No service layer, no DTOs, routes call core directly

### Architecture Layers
- `.planning/codebase/ARCHITECTURE.md` §2 (Routes) — All 8 route files that will be refactored to call services
- `.planning/codebase/ARCHITECTURE.md` §3 (Core Logic) — All 10 core files that services will wrap
- `.planning/codebase/CONVENTIONS.md` §Response Format — `{ ok: true/false }` envelope must be preserved

### Requirements
- `.planning/REQUIREMENTS.md` — QUAL-02, QUAL-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/services/` directory — empty, created by Phase 19 cleanup (or recreated here if removed)
- Phase 24 decomposed modules — service layer wraps these smaller, focused modules
- Phase 19 error classes — services throw typed errors, middleware handles them

### Established Patterns
- Routes use `const core = require('./core/index')` to access everything — service layer replaces this
- `requireAuth` middleware already demonstrates dependency injection at route level
- Config module (`src/config/index.js`) is already a clean singleton — model for other dependencies

### Integration Points
- All 8 route files — refactored from `core.function()` to `service.function()`
- `src/core/index.js` — transitions from wiring hub to slim re-export (or removed entirely)
- Test files — must verify service layer doesn't break existing functionality
- WebSocket handlers (terminal, voice) — these also need service layer access

### Critical Risk
- This is the highest-risk refactor in the milestone
- Every route handler changes
- Phase 22 test coverage is the safety net — this MUST come after Phase 22 + 24
- Concurrent request handling must be tested explicitly

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 25-code-quality-service-layer-global-state*
*Context gathered: 2026-04-16*
