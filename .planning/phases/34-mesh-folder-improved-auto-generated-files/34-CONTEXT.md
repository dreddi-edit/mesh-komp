# Phase 34: .mesh Folder — Improved Auto-Generated Files — Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate and improve the auto-generated `.mesh` folder that Mesh creates when a user opens a workspace. The folder should contain clean, well-structured files that help AI assistants and developers understand the project.

This phase does NOT add new intelligence features, change the compression pipeline, or modify workspace indexing logic beyond what's needed for regeneration triggers.

</domain>

<decisions>
## Implementation Decisions

### File Organization

- **D-01:** Consolidate the 3 separate generators (`provisionMeshWorkspaceMetadata`, `provisionMeshFile`, `provisionIntelligenceArtifacts`) into a single generation pipeline that outputs exactly 3 files to `.mesh/`:
  - `project.json` — structured machine-readable data (tech stack, dependencies, scripts, file statistics)
  - `files.md` — human/AI-readable directory tree, API surface, dependency hubs
  - `rules.md` — human/AI-readable coding conventions, detected style, workspace-specific instructions
- **D-02:** Kill the `.mesh-Intelligence/` subfolder entirely. Its 4 files (`api-surface.md`, `tech-stack.json`, `style-guide.md`, `todo-summary.md`) duplicate data that will be in the 3 consolidated files.
- **D-03:** Remove the bare `.mesh` file fallback (the code that writes a single `.mesh` file at root instead of a directory). Always write to `.mesh/` directory.
- **D-04:** Keep `dependency-map.md` as part of `files.md` rather than a separate file — the dependency hub table fits naturally alongside the file structure.

### Content Format

- **D-05:** `project.json` is pure JSON — structured data for tooling. Contains: workspace name, generated timestamp, file count, language distribution, detected frameworks, package.json scripts, production and dev dependencies.
- **D-06:** `files.md` is clean markdown — no emojis in headers, uses `##` sections, tables for structured data (dependency hubs, API endpoints). Contains: directory tree with file counts, key file dependency hubs, exports/functions list, HTTP endpoints list.
- **D-07:** `rules.md` is clean markdown — detected coding conventions (indentation, primary languages, JS/TS file count, frameworks), workspace-specific coding rules (similar to current workspace-instructions.md but cleaner). No generic "AI directives" filler.
- **D-08:** All 3 files include a clear header: file purpose, generation timestamp, and workspace name. `project.json` uses a top-level metadata object; `.md` files use a YAML frontmatter block.

### Regeneration

- **D-09:** Regenerate `.mesh` files on file changes — not just on first open. Remove the early-return guard in `provisionMeshWorkspaceMetadata` that skips if `.mesh/` already exists.
- **D-10:** Debounce regeneration — don't regenerate on every single file save. Trigger after workspace indexing completes (the existing `deepScanAll` / cloud sync pipeline already batches). Hook into the same post-indexing point where `provisionDependencyMap`, `provisionMeshFile`, and `enqueueIntelligenceJob` are currently called.

### Sensitive Data

- **D-11:** Do not write API keys, tokens, secrets, or PII to `.mesh` files. The current generators don't intentionally include secrets, but package.json scripts may contain inline tokens. Scrub environment variable patterns (`$TOKEN`, `$API_KEY`, etc.) and common secret patterns from script commands before writing to `project.json`.

### Claude's Discretion

- Exact JSON schema for `project.json` — should be useful for tooling while staying compact
- How much of the directory tree to include in `files.md` — current code caps at 300 files
- Whether TODO/FIXME tech debt scanning belongs in `files.md` or should be dropped (it's noisy)
- Exact wording of coding rules in `rules.md` — should be specific to the detected project, not generic filler

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### .mesh Generation Code
- `mesh-core/src/workspace-operations.js` lines 1044-1168 — `buildIntelligenceArtifacts()`: generates 4 files for `.mesh-Intelligence/`
- `mesh-core/src/workspace-operations.js` lines 1180-1430 — `buildMeshFileContent()`: generates the big single intelligence file
- `mesh-core/src/workspace-operations.js` lines 1432-1473 — `provisionMeshFile()`: writes the `.mesh` intelligence file
- `mesh-core/src/workspace-operations.js` lines 936-950 — `provisionDependencyMap()`: generates dependency-map.md
- `mesh-core/src/workspace-operations.js` lines 984-1042 — `enqueueIntelligenceJob()` + `provisionIntelligenceArtifacts()`: queues and writes `.mesh-Intelligence/`
- `src/core/infrastructure/state-provision.js` lines 126-206 — `provisionMeshWorkspaceMetadata()`: generates workspace-instructions.md

### Post-Indexing Hook Points
- `mesh-core/src/workspace-operations.js` lines 268-273 — local indexing completion: where all 3 generators are currently triggered
- `mesh-core/src/workspace-operations.js` lines 425-429 — cloud indexing completion: where cloud generators are triggered

### Frontend References
- `src/routes/app.routes.js` lines 55-57 — `.mesh/instructions.md` and `.mesh/dependency-map.md` in REPO_DOCS_KNOWN_FILES
- `src/routes/app.routes.js` line 89 — `.mesh` directory included in repo docs walker

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `FRAMEWORK_PATTERNS` regex array — already detects 20+ frameworks from import statements (duplicated in both buildMeshFileContent and buildIntelligenceArtifacts — consolidate into one)
- `generateMeshWorkspaceTree()` / `generateMeshWorkspaceTreeFromManifest()` — tree generation for local and cloud workspaces
- `readPackageJsonSummary()` — extracts package.json data
- Capsule section parsing — extracts exports, functions, classes, routes, endpoints from indexed files

### Established Patterns
- All .mesh provisioning is fire-and-forget (`.catch(() => {})`) — non-blocking, won't crash the server
- `workspaceState.files` is the in-memory file index — all generators read from it
- Local writes go to disk (`fs.promises.writeFile`), cloud writes go to workspace metadata store

### Integration Points
- Post-indexing hooks at `workspace-operations.js:268-273` (local) and `:425-429` (cloud) — replace the 3 separate calls with a single consolidated generator
- `REPO_DOCS_KNOWN_FILES` in `app.routes.js:55-57` — update to reference new file names
- Repo docs walker `.mesh` inclusion at `app.routes.js:89` — no change needed (already includes `.mesh` dir)

</code_context>

<specifics>
## Specific Ideas

- "Mix between JSON and markdown" — structured data in `project.json` for machines, readable `.md` files for humans and AI
- Kill all emoji headers — professional README-style markdown
- The 3-file split: `project.json` (what), `files.md` (where), `rules.md` (how)
- Regenerate after indexing completes, debounced — not on every save, not just once

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 34-mesh-folder-improved-auto-generated-files*
*Context gathered: 2026-04-18*
