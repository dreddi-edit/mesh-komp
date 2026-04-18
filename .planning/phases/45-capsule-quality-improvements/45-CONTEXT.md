# Phase 45: Capsule Quality Improvements — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Enrich the capsule rendering pipeline with four new data surfaces drawn from the symbol/call data already built in Phase 43:
1. **Export surfaces** (CAP-01) — which symbols a file exports, with signatures
2. **Outgoing call references** (CAP-02) — which external symbols this file calls, with resolved file:line
3. **Resolved imports** (CAP-03) — direct imports with workspace-resolved paths
4. **Concrete file roles** (CAP-04) — `buildFilesMd()` workspace summary classifies each file by role bucket

This phase is purely additive capsule rendering — no new index building, no new data collection. The data layers (symbols[], callSites[], dependencies[]) already exist from Phase 43.

</domain>

<decisions>
## Implementation Decisions

### Export Detection (CAP-01)
- **D-01:** Use AST parent-check in the existing `walkTree` pass inside `buildCodeCapsule`. When a symbol node's parent is `export_statement` or `export_declaration` (or `export_default_declaration`), set `isExported: true` on the `symbolDeclarations` entry. Falls back to signature text scan (`/^export\b/.test(signature)`) for languages where parent node types differ. This keeps the detection inside the existing tree walk — no second pass.

### Capsule Rendering Format (CAP-01/02/03)
- **D-02:** New dedicated capsule sections — `exports`, `calls`, and `resolved-imports` — added alongside the existing `imports` and `symbols` sections in `buildCodeCapsule`. Uses the existing `createSection`/`pushSectionItem` pattern exactly as Phase 43 uses `routesSection`. Sections only appear in the capsule if they have items (existing `flatMap` filter already handles empty sections).

### Outgoing Call References Format (CAP-02)
- **D-03:** Each entry in the `calls` section rendered as: `calleeSymbol → resolvedFile:line`. Deduplicate to unique (calleeSymbol, resolvedFile) pairs — keep first occurrence only. Max entries capped (follow MAX_CALL_SITES_PER_FILE pattern). This format matches the chain output from Phase 43 context: "button onClick → authService.login() at auth.ts:58".

### Resolved Imports (CAP-03)
- **D-04:** New `resolved-imports` section lists imports that resolved to a workspace file (i.e., entries in `dependencies[]`). Each entry: `importSource → resolvedPath`. Source is the original import string (e.g., `'./auth-service'`), resolved path is the workspace-relative path. External package imports (npm) are excluded — only workspace-internal resolutions appear.

### File Roles in Workspace Summary (CAP-04)
- **D-05:** Classify every file into a role bucket derived from path + symbols. Role buckets: `entry-point`, `route-handler`, `service`, `model`, `util`, `test`, `config`, `middleware`. Classification logic: path pattern matching first (e.g., `*.test.*` → test, `*.routes.*` → route-handler, `server.js` → entry-point), then symbol pattern fallback (e.g., dominant symbol kinds). Add a "File Roles" section to `buildFilesMd()` output as a markdown table: `| Role | Files |` listing files per bucket. Concrete, not generic.

### Claude's Discretion
- Priority of `exports` section relative to `symbols` in capsule rendering (suggest P0 to appear early)
- Maximum items per `exports` and `calls` sections before truncation (suggest 40 exports, 30 calls)
- Whether `resolved-imports` section is P1 or P2 priority (lower priority since `imports` section already exists)
- Exact role classification heuristics beyond the main buckets listed in D-05
- Worker path (`tree-sitter-worker.cjs`) duplication scope — only `isExported` flag needed in worker since sections are assembled in `buildCodeCapsule` which exists in both paths

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Requirements
- `.planning/REQUIREMENTS.md` §Capsule Quality Improvements — CAP-01..CAP-04 acceptance criteria

### Prior Phase Context
- `.planning/phases/43-symbol-dependency-graph/43-CONTEXT.md` — D-04 explicitly scoped Phase 45 to use symbols[] for capsule rendering; also establishes symbolDeclarations shape
- `.planning/phases/43-symbol-dependency-graph/43-SUMMARY.md` — what symbols[], callSites[], buildWorkspaceFileRecord look like after Phase 43 (if it exists)

### Core Capsule Pipeline
- `mesh-core/src/compression-core.cjs` §buildCodeCapsule (~line 738) — all new sections (exports, calls, resolved-imports) go here; uses createSection/pushSectionItem pattern
- `mesh-core/src/compression-core.cjs` §walkTree pass (~line 780) — where AST parent-check for isExported is added to symbolDeclarations entries
- `mesh-core/src/compression-core.cjs` §buildWorkspaceFileRecord (~line 2327) — where symbols[] is assembled from symbolDeclarations; isExported must flow through
- `mesh-core/src/compression-core.cjs` §buildTextFallbackCapsule (~line 1285) — heuristic path must also get exports/calls/resolved-imports rendering using available record data

### Workspace Summary
- `mesh-core/src/workspace-operations.js` §buildFilesMd (~line 1123) — where File Roles classification table is added (CAP-04)
- `mesh-core/src/workspace-operations.js` §buildRulesMd (~line 1208) — adjacent function; no changes needed

### Worker Path (duplication rule)
- `mesh-core/src/tree-sitter-worker.cjs` — worker path must also set isExported on symbolDeclarations entries; section assembly is in buildCodeCapsule which is duplicated in both files

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createSection(name, priority)` / `pushSectionItem(section, item)` — exact pattern for new exports/calls/resolved-imports sections
- `resolveWorkspacePath(sourcePath, importString, workspaceFilePaths)` (compression-core.cjs:532) — already used in buildWorkspaceFileRecord for dependencies[]; reuse for resolved-imports section
- `symbols[]` on every file record — `{name, kind, lineStart, lineEnd, signature}` — ready to drive exports section after adding isExported flag
- `callSites[]` on every file record — `{callerLine, calleeSymbol, resolvedFile, resolvedLine}` — ready to drive calls section
- `dependencies[]` on every file record — resolved workspace paths — ready for resolved-imports section
- `importsSection` in buildCodeCapsule — already has `metadata: { source: entry.source }` on each item for original import text
- `MAX_CALL_SITES_PER_FILE` env-var capping pattern — use for MAX_EXPORTS_PER_FILE and MAX_CALLS_SECTION_ITEMS
- `flatMap` filter in buildCodeCapsule return — sections with no items are automatically excluded; new sections follow same pattern

### Established Patterns
- **Worker/inline duality**: Any changes to symbolDeclarations (adding isExported) must go in both `tree-sitter-worker.cjs` and `compression-core.cjs` inline path
- **Section priority P0/P1/P2**: P0 = always included, P1 = included unless budget too tight, P2 = elided first. Exports = P0, calls = P1, resolved-imports = P1
- `flatMap` empty-section filter: `section.items.length ? [section] : []` — new sections follow same pattern, no items = section absent

### Integration Points
- `buildCodeCapsule` assembles sections → returns them in `sections[]` → `renderCapsuleText` renders them. Adding new sections here flows through the entire capsule pipeline automatically.
- `buildFilesMd()` in workspace-operations.js generates the workspace summary markdown — CAP-04 adds a File Roles table here
- `provisionMeshFolder()` calls `buildFilesMd()` — roles table flows into `.mesh/files.md` automatically

</code_context>

<specifics>
## Specific Ideas

- Target chain output for calls section: `"login() → auth-service.ts:58"` per line — matches Phase 43 context format exactly
- Exports section: list only symbols where `isExported: true`, showing `name signature` per line (e.g., `buildWorkspaceFileRecord(pathValue, rawText, options) → record`)
- File Roles table in buildFilesMd:
  ```
  ## File Roles
  | Role | Files |
  |------|-------|
  | entry-point | server.js |
  | route-handler | auth.routes.js, assistant.routes.js |
  | service | compression-core.cjs, workspace-operations.js |
  | test | query-index-build.test.cjs, ... |
  ```
- isExported propagation: `symbolDeclarations.push({ ..., isExported: Boolean(isExportedNode) })` — same shape, one new field
- AST parent-check node types: `export_statement`, `export_declaration`, `export_default_declaration` (JS/TS); Python uses `__all__` pattern which is out of scope for this phase

</specifics>

<deferred>
## Deferred Ideas

- Python `__all__` export detection — out of scope for this phase, consider Phase 46+
- Symbol-level call chain rendering in chat prompt (injecting chains into AI context at query time) — was Phase 44's concern, not capsule rendering
- Capsule diff rendering (showing what changed between saves) — new capability, future phase

</deferred>

---

*Phase: 45-capsule-quality-improvements*
*Context gathered: 2026-04-18*
