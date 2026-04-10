# CODEBASE-MAP

This file is a practical map of the repository.
It focuses on meaningful project files and how they interact.
Generated files, dependency trees, local logs, and OS metadata are intentionally omitted except where they matter operationally.

## How To Read This

- `Purpose`: what the file contains
- `Works with`: which other files or runtime areas it directly interacts with

## Root Files

### Runtime and config

- `server.js`
  Purpose: tiny bootstrap that starts the main Express app from `src/server.js`.
  Works with: `src/server.js`.

- `package.json`
  Purpose: root package manifest, runtime dependencies, and scripts for start, tests, lint, and compression benchmark.
  Works with: `server.js`, `src/server.js`, `benchmarks/compression-benchmark.js`, `test/*`.

- `package-lock.json`
  Purpose: dependency lockfile for the root app.
  Works with: `package.json`.

- `.eslintrc.json`
  Purpose: root lint configuration.
  Works with: all JS files linted through `npm run lint`.

### Local state and caches

- `.mesh-auth-store.json`
  Purpose: local auth-related state from an older/local auth flow.
  Works with: legacy/local development flows; not part of current primary runtime path.

- `.mesh-workspace-cache.json`
  Purpose: local cache for workspace-related metadata.
  Works with: local workspace flows in the browser/app runtime.

### Core backend and shared logic

- `secure-db.js`
  Purpose: secure persistence abstraction for users, sessions, and per-user store values. Uses AES-256-GCM encryption for stored data; encryption key is taken from `MESH_DATA_ENCRYPTION_KEY` env var (required in production). In dev without that var, falls back to a machine-derived secret from `os.hostname()` — never a known constant. Session tokens are 32 random bytes.
  Works with: `src/core/index.js`, `src/routes/auth.routes.js`, `src/routes/app.routes.js`.

- `assistant-core.js`
  Purpose: shared assistant logic used by the server and tests.
  Works with: `src/core/index.js`, `mesh-core/src/server.js`, `test/assistant-core.test.js`.

- `llm-compress.js`
  Purpose: legacy/heuristic context compression fallback and CLI.
  Works with: `benchmarks/compression-benchmark.js`, `mesh-core/src/compression-core.cjs`, `mesh-core/src/tree-sitter-worker.cjs`.

- `workspace-metadata-store.cjs`
  Purpose: workspace metadata persistence layer.
  Works with: `src/core/index.js`, `mesh-core/src/server.js`, `mesh-functions/src/shared/blob-capsule-processor.cjs`.

- `workspace-upload-utils.cjs`
  Purpose: helpers for workspace upload/blob naming conventions.
  Works with: `mesh-functions/src/shared/blob-capsule-processor.cjs`, deployment/storage flows.

## HTML Surfaces (`views/`)

All HTML files live under `views/`. `src/server.js` serves them via clean URLs (e.g. `/app`, `/settings-account`).

### Main product pages

- `views/index.html`
  Purpose: public landing page / marketing shell for Mesh.
  Works with: `assets/app.js`, `assets/animations/mesh-loader-neon.json`, `assets/brand/*`.

- `views/app.html`
  Purpose: main IDE/workbench shell styled after the Antigravity (Google cloud VS Code-like) design — Antigravity-style welcome screen with Open Folder primary CTA, Open Agent Manager and Clone Repository secondary row, Workspaces list, Antigravity explorer empty state, "Agent" panel header with new-chat/history/more/close controls, and status bar showing per-model usage percentages (Claude, GPT, Gemini) plus Mesh connection state. Topbar surface switcher for `Editor`, `Terminal`, and `Voice-Coding` surfaces preserved.
  Works with: `assets/app-workspace.js`, `assets/app-workspace.css`, `assets/app-graph.js`, `assets/features/*`, backend APIs under `src/routes/*`.

- `views/marketplace.html`
  Purpose: extension/marketplace surface embedded from the workbench.
  Works with: `views/app.html`, `assets/app-workspace.js`.

- `views/docs.html`
  Purpose: product/docs page for Mesh.
  Works with: `assets/app.js`, `assets/brand/*`.

- `views/repo-docs.html`
  Purpose: docsify-style repository surface for `mesh-komp`, with a searchable sidebar, rendered Markdown, and a browsable repo tree for the current codebase.
  Works with: `assets/repo-docs.js`, `assets/repo-docs.css`, `/api/docs/index`, `/api/docs/file`.

- `views/how-it-works.html`
  Purpose: explanatory product page about architecture and workflow.
  Works with: `assets/app.js`, `assets/brand/*`.

- `views/statistics.html`
  Purpose: public page describing compression benefits and related metrics.
  Works with: `assets/app.js`, `assets/brand/*`.

- `views/terminal.html`
  Purpose: public/product page explaining the terminal and workflow story.
  Works with: `assets/app.js`, `assets/brand/*`.

### Settings pages

- `views/settings.html`
  Purpose: combined single-page settings app that merges all six sections (Account, Security, Billing, API Keys, Appearance, AI & Models) into one file with hash-based SPA navigation. Opens at `/settings` and routes via `#account`, `#security`, etc.
  Works with: `assets/settings.js`, `assets/settings-combined.js`, `assets/mesh-settings.css`, all settings-related APIs.

The following six standalone pages remain for direct-URL access and backwards compatibility; they share the same CSS/JS as `settings.html`:

- `views/settings-account.html`
  Purpose: account/profile/workspace/integrations settings page.
  Works with: `assets/settings.js`, `assets/mesh-settings.css`, `/api/user/store`.

- `views/settings-security.html`
  Purpose: security baseline, session, and audit-related settings page.
  Works with: `assets/settings.js`, `/api/auth/sessions`, `/api/auth/sessions/revoke`.

- `views/settings-billing.html`
  Purpose: billing plan, contact, invoices, and usage page.
  Works with: `assets/settings.js`, `/api/app/billing/summary`, `/api/app/billing/invoices/:id/download`.

- `views/settings-api-keys.html`
  Purpose: API key lifecycle page.
  Works with: `assets/settings.js`, local/user-store-backed API key state.

- `views/settings-appearance.html`
  Purpose: theme/density/motion/settings preview page.
  Works with: `assets/settings.js`, `meshAppearance` in user store.

- `views/settings-ai.html`
  Purpose: provider keys, default models, BYOK validation, and AI behavior page.
  Works with: `assets/settings.js`, `/api/byok/validate`, `/api/user/store`.

## Frontend Assets

### Shared shell and public-page scripts

- `assets/app.js`
  Purpose: JS for the public site and settings-adjacent marketing/navigation surfaces.
  Works with: `index.html`, `docs.html`, `how-it-works.html`, `statistics.html`, `terminal.html`.

- `assets/app-workspace.js`
  Purpose: main browser runtime for the IDE shell, including workspace scan/index orchestration, diff-based sync, shell navigation, the topbar surface-state switching between editor, terminal, and voice-coding, and browser-side `.mesh` metadata generation that now refreshes after background indexing.
  Works with: `app.html`, `assets/app-workspace.css`, `assets/app-graph.js`, `assets/features/*`, backend APIs and websocket endpoints.

- `assets/app-workspace.css`
  Purpose: styling for the IDE/workbench shell, including the topbar surface switcher plus the full-page terminal and voice-coding surfaces.
  Works with: `app.html`, `assets/app-workspace.js`.

- `assets/app-graph.js`
  Purpose: D3-based dependency/workspace graph renderer, driven by indexed workspace dependency data (no synthetic workspaceId sent — worker owns that identity) with local fallback graph building. Empty-state distinguishes "no folder open" from "folder open, still indexing" via server `hasWorkspace` flag, and the renderer can now prefer the richer local graph when remote graph data is empty or weaker than the loaded tree.
  Works with: `app.html`, `assets/app-workspace.js`, `/api/assistant/workspace/graph`.

- `assets/settings.js`
  Purpose: shared runtime for all settings pages. Handles forms, switches, API keys, billing, appearance, theme application, and page-specific init functions guarded by `document.body.dataset.settingsPage`.
  Works with: `settings-*.html`, `settings.html`, `assets/mesh-settings.css`, auth/session APIs, billing APIs, user-store APIs, BYOK validation API.

- `assets/repo-docs.js`
  Purpose: browser runtime for the repo docs surface, including docs index loading, sidebar rendering, repo tree navigation, file opening, and Markdown/code document display.
  Works with: `views/repo-docs.html`, `assets/repo-docs.css`, `/api/docs/index`, `/api/docs/file`.

- `assets/repo-docs.css`
  Purpose: styling for the repo docs surface, including the sidebar, search, repo tree, and rendered document content.
  Works with: `views/repo-docs.html`, `assets/repo-docs.js`.

- `assets/settings-combined.js`
  Purpose: SPA router for `settings.html`. Handles hash-based section routing, shows/hides content sections and sidebar info cards, re-runs guarded init functions from `settings.js` for all sections, and fixes nav hrefs after `applyStandaloneNavigation` runs. Must load via `defer` after `settings.js`.
  Works with: `settings.html`, `assets/settings.js`.

- `assets/mesh-settings.css`
  Purpose: shared styling for all settings pages.
  Works with: all `settings-*.html`, `settings.html`, `assets/settings.js`.

- `assets/mesh-client.js`
  Purpose: browser-side Mesh client for compression/transport experiments.
  Works with: Mesh compression/browser experiments; not wired into the primary `app.html` runtime today.

### Feature modules for the IDE

- `assets/features/_bus.js`
  Purpose: lightweight event bus and shared feature bootstrapping anchor.
  Works with: most other `assets/features/*` modules and `assets/app-workspace.js`.

- `assets/features/streaming-chat.js`
  Purpose: chat streaming behavior on top of the workbench shell.
  Works with: `assets/app-workspace.js`, chat APIs, `window.MeshState`, `window.MeshActions`.

- `assets/features/voice-chat.js`
  Purpose: browser voice-chat UI, audio pipeline, orb/timeline state, approval prompts, and websocket client for the server-backed voice agent; streams PCM mic audio to the local voice session, gates mic usage on `session.ready`, mounts the orb into the dedicated Voice-Coding surface when active, and mirrors transcripts/run state into the side viewer.
  Works with: `assets/features/voice-audio-worklet.js`, `app.html`, `/api/realtime`, `window.MeshActions`, `window.MeshState`.

- `assets/features/voice-audio-worklet.js`
  Purpose: audio worklet for mic capture and speaker playback.
  Works with: `assets/features/voice-chat.js`.

- `assets/features/command-palette.js`
  Purpose: command palette UI and command wiring for the IDE.
  Works with: `assets/app-workspace.js`, `window.MeshActions`, `window.MeshState`.

- `assets/features/quick-open.js`
  Purpose: quick-open file UX.
  Works with: `assets/features/_bus.js`, `assets/app-workspace.js`.

- `assets/features/content-search.js`
  Purpose: content search over workspace files.
  Works with: `assets/app-workspace.js`, `window.MeshActions`.

- `assets/features/at-mentions.js`
  Purpose: mention insertion / contextual chat interactions.
  Works with: chat UI and `window.MeshActions`.

- `assets/features/agentic-edits.js`
  Purpose: agent-driven edit application flow.
  Works with: chat/runtime state, editor actions, backend assistant APIs.

- `assets/features/background-agent.js`
  Purpose: background agent execution features.
  Works with: chat input, `window.MeshActions`, assistant APIs.

- `assets/features/inline-edit.js`
  Purpose: inline editing UX inside the editor.
  Works with: Monaco/editor state, `window.MeshActions`.

- `assets/features/checkpoints.js`
  Purpose: checkpointing around edits and agent operations.
  Works with: editor state, `window.MeshActions`.

- `assets/features/reindex-on-save.js`
  Purpose: single-file reindex hooks after file saves using workspace diff sync.
  Works with: workspace/indexing APIs and `assets/app-workspace.js`.

- `assets/features/diff-editor.js`
  Purpose: Monaco diff editor tab/view support.
  Works with: `assets/app-workspace.js`, editor state, checkpoints.

- `assets/features/split-editor.js`
  Purpose: split-editor support for multiple editor panes.
  Works with: `assets/app-workspace.js`, Monaco state.

- `assets/features/capsule-viewer.js`
  Purpose: visualizer for compressed/capsule file representations.
  Works with: Mesh compression outputs, `assets/app-workspace.js`.

- `assets/features/capsula-status.js`
  Purpose: status display around capsule/compression state.
  Works with: workspace state and compression surfaces.

- `assets/features/context-budget.js`
  Purpose: token/context budget visualization.
  Works with: `/api/assistant/workspace/context-budget`, graph/editor/chat state.

- `assets/features/problems-panel.js`
  Purpose: problem/error panel integration.
  Works with: chat/editor/runtime state.

- `assets/features/span-nav.js`
  Purpose: navigation to referenced spans/locations.
  Works with: editor and file-opening actions.

- `assets/features/meshrules.js`
  Purpose: feature logic for Mesh rules/instructions interactions.
  Works with: runtime/editor/chat state.

- `assets/features/chat-threads.js`
  Purpose: thread/session behavior for chat history.
  Works with: chat UI and `window.MeshActions`.

- `assets/features/ai-review.js`
  Purpose: AI review flow over workspace or code selections.
  Works with: chat/runtime state, assistant APIs.

### Brand and animation assets

- `assets/brand/*`
  Purpose: canonical runtime brand assets used by product pages and settings/workbench UI.
  Works with: most HTML surfaces.

- `assets/animations/mesh-loader-neon.json`
  Purpose: main runtime Lottie loader animation.
  Works with: `index.html`, `assets/app-graph.js`.

- `assets/animations/mesh-loader-white.json`
  Purpose: alternate loader animation asset.
  Works with: optional loader surfaces and branding variants.

## Backend App

### Server bootstrap and routing

- `src/server.js`
  Purpose: main Express/http server, static file serving (from `views/`), route mounting, terminal websocket, and realtime relay setup. Applies security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) and a CSRF Origin/Referer guard on all mutating requests. Terminal WebSocket requires a valid auth session before upgrading; spawned shell receives a sanitized copy of `process.env` with sensitive vars (matching `_KEY`, `_SECRET`, `_PASSWORD`, `_TOKEN`, `_CREDENTIAL`, `_PRIVATE`) stripped. The terminal layer also resolves the active workspace root and materializes uploaded workspaces into a temporary server-side folder before spawning the shell.
  Works with: `src/core/index.js`, `src/routes/*.js`, `server.js`, all HTML assets under `views/`.

- `src/routes/auth.routes.js`
  Purpose: login, session inspection, logout, and session-revoke endpoints. The login endpoint is protected by an in-memory sliding-window rate limiter (15 attempts per IP per minute).
  Works with: `src/core/index.js`, `secure-db.js`, `assets/settings.js`, `assets/app-workspace.js`.

- `src/routes/app.routes.js`
  Purpose: app-level APIs such as user store, billing, operations, logs, AI helper endpoints, and the repo-docs endpoints that expose the current repository as a browsable docs/data surface. All endpoints require auth. Repo-docs file access uses `path.resolve()` traversal guard. Code-block language labels are HTML-escaped before rendering to prevent XSS.
  Works with: `src/core/index.js`, `secure-db.js`, `assets/settings.js`, `assets/app-workspace.js`, `assets/repo-docs.js`.

- `src/routes/assistant.routes.js`
  Purpose: assistant/workspace/git/chat/context endpoints, including workspace diff sync and graph fallback routing.
  Works with: `src/core/index.js`, workbench frontend, graph, search, chat, and workspace flows.

- `src/routes/realtime.routes.js`
  Purpose: local websocket voice-session server for the workbench voice feature; performs VAD over streamed PCM, calls Azure STT/text/TTS endpoints, coordinates delegated assistant-run actions for the voice agent, and rebuilds capsule context from the active uploaded/local workspace before each voice turn. WebSocket upgrade requires a valid auth session — unauthenticated upgrade attempts are rejected with HTTP 401.
  Works with: `assets/features/voice-chat.js`, `src/core/index.js`, `src/core/voice-agent.js`, `src/core/voice-azure-audio.js`.

### Core modules

- `src/core/index.js`
  Purpose: core orchestrator — thin aggregator that requires the four extracted submodules, destructures their exports into scope, and re-exports everything via `module.exports` so `src/server.js` can populate `global` for route files.
  Works with: `src/core/auth.js`, `src/core/model-providers.js`, `src/core/assistant-runs.js`, `src/core/workspace-infrastructure.js`, `src/core/workspace-context.js`, `src/core/workspace-ops.js`, `src/core/deployments.js`, `assistant-core.js`, `secure-db.js`, `mesh-core/src/compression-core.cjs`, `workspace-metadata-store.cjs`.

- `src/core/workspace-infrastructure.js`
  Purpose: ~50 functions for tunnel request handling, workspace provisioning, blob storage operations (upload/download/delete), offload config, Azure blob URL building, workspace metadata, and shared indexing helpers such as perf tracking, concurrency mapping, and indexability filtering. Extracted from index.js.
  Works with: `src/core/model-providers.js`, `mesh-core/src/compression-core.cjs`, `workspace-metadata-store.cjs`; required by `src/core/index.js`.

- `src/core/workspace-context.js`
  Purpose: ~40 functions for local workspace chunk compression, capsule/context building, assistant terminal session management, and codec protocol utilities; now includes diff-aware chunk compression for sync ingest. Extracted from index.js.
  Works with: globals from `src/core/index.js` (accessed at call-time); required by `src/core/index.js`.

- `src/core/voice-agent.js`
  Purpose: server-side voice-agent broker that defines voice tools, delegates coding tasks to Assistant Runs, resolves approvals, normalizes voice UI/run events, and executes direct workspace/git tools for the speech pipeline with explicit workspace/capsule context awareness.
  Works with: `assistant-core.js`, `src/routes/realtime.routes.js`, `src/core/index.js`, `src/core/voice-azure-audio.js`, workspace/git/terminal helpers exposed by core.

- `src/core/voice-realtime-profile.js`
  Purpose: legacy Azure realtime transport/profile builder kept for the earlier websocket-to-Azure-realtime path.
  Works with: `src/core/voice-agent.js`, historical voice-realtime experiments and compatibility code.

- `src/core/voice-azure-audio.js`
  Purpose: Azure OpenAI voice helper layer that owns deployment config, audio transcription, speech synthesis, and the text-model tool loop used by the local voice websocket session.
  Works with: `src/routes/realtime.routes.js`, `src/core/voice-agent.js`, Azure OpenAI deployments for transcription, text orchestration, and TTS.

- `src/core/workspace-ops.js`
  Purpose: ~35 functions for local workspace select, open-local, delta ingest, background enrichment, file I/O, search, grep, rename, delete, batch apply, git operations, graph payloads, and assistant reply. Extracted from index.js.
  Works with: globals from `src/core/index.js` (accessed at call-time); required by `src/core/index.js`.

- `src/core/deployments.js`
  Purpose: 12 deployment/policy functions — risk normalisation, policy CRUD, deployment record management, and policy enforcement. Extracted from index.js.
  Works with: globals from `src/core/index.js` (accessed at call-time); required by `src/core/index.js`.

- `src/core/auth.js`
  Purpose: auth/session/cookie layer — password hashing, session lifecycle, `requireAuth` middleware, BYOK credential normalization, and user-store key allowlist. Auth cookie defaults to `SameSite=Strict` (overridable via `MESH_AUTH_COOKIE_SAMESITE` env var).
  Works with: `secure-db.js`, `src/core/index.js` (required by index.js and destructured into scope).

- `src/core/model-providers.js`
  Purpose: AI provider call layer — static model registry, Anthropic/OpenAI/Gemini/BYOK call functions, Mesh model codec (encode/decode/inject), and related string utilities.
  Works with: `@anthropic-ai/sdk`, `src/core/index.js` (required by index.js and destructured into scope).

- `src/core/assistant-runs.js`
  Purpose: assistant run orchestration — run record lifecycle, plan/proposal generation, batch execution, diff extraction, and run continuation logic. Uses globals set by server.js at startup (no direct requires to avoid circular deps).
  Works with: globals from `src/core/index.js` (`runModelChat`, `localWorkspaceSave`, `appendOperationLog`, etc.), `src/core/index.js` (required by index.js and destructured into scope).

## mesh-core Worker

- `mesh-core/package.json`
  Purpose: worker package manifest for Mesh Core.
  Works with: `mesh-core/src/*`.

- `mesh-core/package-lock.json`
  Purpose: lockfile for the worker package.
  Works with: `mesh-core/package.json`.

- `mesh-core/src/server.js`
  Purpose: slim Express server — sets up middleware, declares `parseMeshEnvelope`/`sendCompressedJson`, mounts all route handlers, and calls `app.listen`. All state, helpers, and operations are imported from the three modules below.
  Works with: `mesh-core/src/mesh-state.js`, `mesh-core/src/workspace-helpers.js`, `mesh-core/src/workspace-operations.js`, `mesh-core/src/MeshServer.js`.

- `mesh-core/src/mesh-state.js`
  Purpose: shared mutable workspace state (`workspaceState`, `workspaceBlobConfig`, `workspaceMetadataStore`), worker constants for indexing/enrichment concurrency, initial/full compression tuning, blob size limits, perf logging, promisified node utilities (`brotliCompress`, `brotliDecompress`, `execFileAsync`), and init-time helpers re-exported for use by workspace-helpers.js.
  Works with: `workspace-metadata-store.cjs`; imported by `mesh-core/src/workspace-helpers.js`, `mesh-core/src/workspace-operations.js`, and `mesh-core/src/server.js`.

- `mesh-core/src/workspace-helpers.js`
  Purpose: ~50 helper functions for workspace state I/O, path resolution, blob read/write/delete, git utilities, workspace file record management, local indexing pipeline (individual file), shared perf/concurrency helpers, and incoming-file normalisation.
  Works with: `mesh-core/src/mesh-state.js`, `mesh-core/src/compression-core.cjs`, `mesh-core/src/MeshServer.js`; imported by `mesh-core/src/workspace-operations.js` and `mesh-core/src/server.js`.

- `mesh-core/src/workspace-operations.js`
  Purpose: ~31 high-level async operations — `openLocalWorkspace`, `selectWorkspaceFolder`, diff-aware upload ingest, background indexing/enrichment, `listWorkspaceFiles`, `getWorkspaceGraph`, `purgeWorkspace`, file open/save/create/rename/delete, batch apply, workspace search/grep, git status, chat (`handleChat`), and related utilities. Also includes `provisionMeshFile` / `buildMeshFileContent` which generate a single `.mesh` intelligence file at the workspace root on folder open.
  Works with: `mesh-core/src/mesh-state.js`, `mesh-core/src/workspace-helpers.js`, `mesh-core/src/compression-core.cjs`, `assistant-core.js`; imported by `mesh-core/src/server.js`.

- `mesh-core/src/compression-core.cjs`
  Purpose: main compression/capsule pipeline implementation — span analysis, capsule serialisation, transport encoding, tree-sitter integration, initial/full workspace record modes, and the three fixed per-file capsule tiers (`ultra`, `medium`, `loose`) used by workspace file views. The tier logic now applies progressively stricter selection/section budgets so `ultra` is the smallest view, `medium` sits in the middle, and `loose` keeps the richest capsule that still makes sense for file size.
  Works with: `llm-compress.js`, `mesh-core/src/tree-sitter-worker.cjs`, `src/core/index.js`, `mesh-core/src/compression-utils.cjs`.

- `mesh-core/src/compression-utils.cjs`
  Purpose: self-contained text and span utilities extracted from compression-core.cjs — sha256, span manager, line-start indexing, token estimation, whitespace helpers, and concurrency mapper. No tree-sitter or capsule dependencies.
  Works with: `mesh-core/src/compression-core.cjs`; can be required independently by any module needing low-level text utilities.

- `mesh-core/src/tree-sitter-worker.cjs`
  Purpose: parsing/analysis worker using tree-sitter and fallbacks.
  Works with: `mesh-core/src/compression-core.cjs`, `llm-compress.js`.

- `mesh-core/src/MeshServer.js`
  Purpose: transport/server logic for Mesh worker communication.
  Works with: worker runtime and cloud transport flows.

- `mesh-core/src/mesh-dictionary.js`
  Purpose: shared token/compression dictionary.
  Works with: compression and browser/client transport experiments.

- `mesh-core/.mesh/instructions.md`
  Purpose: worker-local workspace instructions file.
  Works with: local worker context.

- `mesh-core/.mesh-worker-workspace-cache.json`
  Purpose: worker-local cache/state file.
  Works with: local worker execution.

## mesh-functions

- `mesh-functions/package.json`
  Purpose: package manifest for serverless function helpers.
  Works with: `mesh-functions/src/*`.

- `mesh-functions/host.json`
  Purpose: Azure Functions host configuration.
  Works with: Azure Functions runtime.

- `mesh-functions/src/functions/blob-capsule-indexer.js`
  Purpose: blob-triggered/serverless indexing entrypoint.
  Works with: `mesh-functions/src/shared/blob-capsule-processor.cjs`.

- `mesh-functions/src/shared/blob-capsule-processor.cjs`
  Purpose: shared logic for blob/capsule processing.
  Works with: `workspace-metadata-store.cjs`, `workspace-upload-utils.cjs`, function entrypoints.

- `mesh-functions/src/scripts/invoke-event.js`
  Purpose: helper script for invoking/testing function events.
  Works with: local/serverless testing flows.

## Benchmarks and Tests

- `benchmarks/compression-benchmark.js`
  Purpose: benchmark runner for compression approaches.
  Works with: `llm-compress.js`, `npm run bench:compression`.

- `test/assistant-core.test.js`
  Purpose: unit/integration coverage for assistant-core behavior.
  Works with: `assistant-core.js`.

- `test/assistant-integration.test.js`
  Purpose: integration tests across server/assistant/runtime flows.
  Works with: `src/server.js`, route APIs, workspace files.

- `test/compression-core.test.js`
  Purpose: tests for Mesh compression core behavior.
  Works with: `mesh-core/src/compression-core.cjs`, `llm-compress.js`.

- `test/compression-benchmark.test.js`
  Purpose: test harness around benchmark/compression assumptions.
  Works with: `benchmarks/compression-benchmark.js`.

## Product and Architecture Docs

- `CLAUDE.md`
  Purpose: repository-level coding directives for Claude and maintainers.
  Works with: this `CODEBASE-MAP.md`; should stay aligned with current repo structure.

- `claude-overview.md`
  Purpose: broader architecture and operational explanation of the codebase.
  Works with: onboarding and repo understanding.

- `AZURE-ARCHITECTURE.md`
  Purpose: detailed Azure deployment and architecture notes.
  Works with: cloud deployment and storage/indexing understanding.

- `CAPSULA-COMPRESSION-AZURE-GESAMTDOKU.md`
  Purpose: deep documentation for compression plus Azure integration.
  Works with: compression stack understanding and operational context.

- `DEPLOY.md`
  Purpose: deployment runbook.
  Works with: runtime/deployment operations.

- `UI-REVIEW.md`
  Purpose: UI review and product/design feedback notes.
  Works with: frontend/product iteration.

## Planning and Archived Support Docs

- `docs/superpowers/plans/2026-04-07-voice-interface.md`
  Purpose: implementation plan for voice interface work.
  Works with: historical planning/reference.

- `docs/superpowers/plans/2026-04-07-ai-workbench-mega-upgrade.md`
  Purpose: implementation plan for AI workbench upgrade.
  Works with: historical planning/reference.

- `docs/superpowers/plans/2026-04-08-compression-improvements.md`
  Purpose: implementation plan for compression improvements.
  Works with: historical planning/reference.

- `docs/superpowers/plans/2026-04-08-codebase-cleanup.md`
  Purpose: implementation plan for codebase cleanup (file splits, archiving).
  Works with: historical planning/reference.

- `docs/archive/CODEX-PHASE-2-3.md`
  Purpose: historical build/refactor plan from earlier phases.
  Works with: historical context only.

## Intentionally Omitted Or Not Maintained Here

- `node_modules/*`
- `mesh-core/node_modules/*`
- `output/*`
- `.playwright-cli/*`
- `.DS_Store`
- editor-local files such as `.vscode/*` and `.claude/settings.local.json`

These files are generated, external, local-only, or not part of the maintained application source map.

- `claude-ubuntu.md`
  Purpose: EC2 environment context for Claude Code on this Ubuntu dev machine — covers machine details, GitHub setup, stack, and typical workflows.
  Works with: local Claude Code sessions only; not part of the application runtime.

---

## ccmon — Claude Code Terminal Dashboard

Standalone read-only monitoring tool. Run with `node ccmon.js` or `npm run monitor`. No coupling to the mesh-komp server at runtime.

- `ccmon.js`
  Purpose: Entry point. Creates the blessed screen, loads historical data on startup, starts the file watcher, wires all ccmon modules together, handles keyboard shortcuts (q/r/h/c/?).
  Works with: `ccmon/layout.js`, `ccmon/history.js`, `ccmon/state.js`, `ccmon/parser.js`, `ccmon/watcher.js`, `ccmon/render.js`.

- `ccmon/pricing.js`
  Purpose: Per-model token pricing constants (USD/token) and `calculateCost()` / `getContextLimit()` utilities. Update when Anthropic changes pricing.
  Works with: `ccmon/parser.js`, `ccmon/state.js`.

- `ccmon/parser.js`
  Purpose: Parses Claude Code JSONL session lines into normalized event objects. Provides `parseAssistantEvent()` for single lines, `readSessionEvents()` for full files, and `readTailWithErrors()` for incremental live tailing with error counting.
  Works with: `ccmon/pricing.js`, `ccmon/history.js`, `ccmon.js`.

- `ccmon/state.js`
  Purpose: Immutable session state shape and `applyEvent()` accumulator. Tracks live token counts, sparkline ring buffers, feed entries, speed/latency approximations.
  Works with: `ccmon/pricing.js`, `ccmon.js`.

- `ccmon/history.js`
  Purpose: Loads all historical JSONL files from `~/.claude/projects/`, aggregates into per-date summaries, computes daily/weekly/monthly/all-time stats and burn rate projection.
  Works with: `ccmon/parser.js`, `ccmon.js`.

- `ccmon/render.js`
  Purpose: Pure functions that produce neo-blessed tagged content strings for every dashboard panel: sparklines, context bar, token breakdown, performance, daily chart, accumulated stats, live feed.
  Works with: `ccmon.js`.

- `ccmon/watcher.js`
  Purpose: Watches `~/.claude/projects/` for `.jsonl` file changes using `fs.watch` recursive (macOS) with polling fallback (Linux/other platforms).
  Works with: `ccmon.js`.

- `ccmon/layout.js`
  Purpose: Creates and positions all neo-blessed boxes for the full-screen dashboard layout (titlebar, 6 metric boxes, context bar, middle row, accumulated panel, feed, footer).
  Works with: `ccmon.js`.

## ccmon-server / ccmon-web — Web Dashboard for ccmon

HTTP server + React frontend that expose ccmon metrics over a browser UI instead of the terminal.

- `ccmon-server.js`
  Purpose: Express server (port 3030) that reads Claude Code JSONL session data, serves a REST + SSE API (`/api/state`, `/api/events`), and streams live token/cost updates to the web frontend.
  Works with: `ccmon/history.js`, `ccmon/state.js`, `ccmon/parser.js`, `ccmon/watcher.js`, `ccmon-web/`.

- `ccmon-web/`
  Purpose: React/Vite/TypeScript web app that connects to `ccmon-server.js` and renders token usage, cost, burn rate, and history in a browser dashboard with Recharts charts and Framer Motion animations.
  Works with: `ccmon-server.js` (via `/api/state` + `/api/events` SSE). Build output served statically or via Vite dev server.
