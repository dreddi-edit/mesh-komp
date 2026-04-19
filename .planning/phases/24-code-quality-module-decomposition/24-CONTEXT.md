# Phase 24: Code Quality — Module Decomposition - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Split 8 monolith files (>1,000 lines each) into focused modules under 400 lines. Deduplicate shared functions. Keep re-export facades for backward compatibility. Test suite from Phase 22 catches regressions.

</domain>

<decisions>
## Implementation Decisions

### model-providers.js Split (1,663 lines)
- **D-01:** Split into `src/core/providers/` — `anthropic.js`, `openai.js`, `gemini.js`, `bedrock.js`, `byok.js`, `codec.js`, `index.js` (router)
- **D-02:** `index.js` in providers/ is a re-export facade — existing `require('./core')` paths don't break

### workspace-ops.js Split (1,723 lines)
- **D-03:** Split into `src/core/workspace/` — `files.js`, `search.js`, `git.js`, `batch.js`, `index.js`
- **D-04:** `localWorkspaceSelect()` (207 lines, high cyclomatic complexity) gets its own file or is broken into smaller functions

### workspace-infrastructure.js Split (1,191 lines)
- **D-05:** Split into focused modules: `path-safety.js`, `metadata.js`, `s3-ops.js`, `job-queue.js`

### workspace-context.js Split (1,146 lines)
- **D-06:** Split into focused modules based on responsibility (file caching, terminal sessions, workspace fallback)

### assistant-runs.js Split (1,130 lines)
- **D-07:** Split into focused modules (run lifecycle, proposal generation, batch editing)

### compression-core.cjs Split (2,568 lines)
- **D-08:** Split into focused modules under `mesh-core/src/compression/`

### workspace-operations.js Split (2,326 lines)
- **D-09:** Split into focused modules under `mesh-core/src/workspace/`

### core/index.js Reduction (1,200 lines)
- **D-10:** Reduce to minimal re-export facade — just imports + `module.exports` object
- **D-11:** Domain logic moved into domain modules during splits above

### Deduplication
- **D-12:** `toSafePath()` — exists in `src/core/model-providers.js:40` AND `src/core/workspace-infrastructure.js:126` — consolidate to single location
- **D-13:** `normalizeEmail()` — exists in `src/core/auth.js:122` AND `secure-db.js:80` — consolidate
- **D-14:** Path scoring — partially duplicated between `src/core/workspace-ops.js` and `assistant-core.js` — consolidate

### Claude's Discretion
- Exact module boundaries within each split (which functions go where)
- Re-export facade strategy (barrel exports vs. direct imports)
- Whether to create `src/utils/` for deduplicated helpers or place them in domain modules

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Large Files
- `.planning/codebase/CONCERNS.md` §3 (Technical Debt → Large Files) — All 8 files with line counts and issues
- `.planning/codebase/STRUCTURE.md` — Complete file layout with line counts for every module

### Duplicated Logic
- `.planning/codebase/CONCERNS.md` §3 (Technical Debt → Duplicated Logic) — `toSafePath()`, `normalizeEmail()`, path scoring locations

### Architecture
- `.planning/codebase/ARCHITECTURE.md` §3 (Core Logic) — Module responsibilities, what each file does
- `.planning/codebase/ARCHITECTURE.md` §Key Abstractions — Global state pattern, tunnel/fallback pattern
- `.planning/codebase/ARCHITECTURE.md` §6 (Mesh Core) — mesh-core module structure

### Module Patterns
- `.planning/codebase/CONVENTIONS.md` §Module Pattern — CommonJS structure, naming, JSDoc requirements

### Requirements
- `.planning/REQUIREMENTS.md` — QUAL-01, QUAL-03, QUAL-08

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/core/index.js` (1,200 lines) — Current wiring hub; becomes the re-export facade
- `src/routes/route-utils.js` (22 lines) — Example of small, focused utility module

### Established Patterns
- CommonJS `require()`/`module.exports` — all splits must maintain this
- `'use strict'` + JSDoc on all exported functions
- `// ── Section ──` headers already delineate logical boundaries in monolith files — natural split points

### Integration Points
- Every `require('./core')` call across all route files — must continue working via facade
- `mesh-core/src/server.js` — requires from compression-core and workspace-operations
- Test files — all existing tests must pass with new module paths
- `assistant-core.js` (root) — references workspace functions; paths may change

### Critical Risk
- Circular dependencies between core modules are the primary risk
- `src/core/index.js` currently breaks cycles by acting as a mediator — decomposition must preserve this

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

*Phase: 24-code-quality-module-decomposition*
*Context gathered: 2026-04-16*
