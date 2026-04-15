# Mesh Current System Overview

This document is a detailed overview of what Mesh currently is, how it is wired, what the main runtime surfaces are, how data moves through the system, and where the current intended behavior still differs from the actually reliable behavior.

It is deliberately more verbose than `CODEBASE-MAP.md`.

`CODEBASE-MAP.md` is the fast file-to-file map.
This file is the system-level overview.

## 1. Product Summary

Mesh is currently a browser-based coding environment with three primary top-level work surfaces:

- `Editor`
- `Terminal`
- `Voice-Coding`

The product combines:

- a file explorer and editor shell
- a chat-based coding assistant
- a workspace indexing and compression pipeline
- a dependency graph
- settings and account/product configuration
- a terminal surface
- a speech-driven agent surface

At a system level, Mesh is not one single app process.
It is a split architecture:

- the `gateway` app serves the main web app, routes, auth, settings APIs, and browser-facing assistant APIs
- the `worker` handles a large part of workspace operations, indexing, compression, graph generation, file access, search, recovery, and git actions
- shared logic exists in `src/core/*`, `mesh-core/*`, `assistant-core.js`, `workspace-metadata-store.cjs`, and `secure-db.js`

There are two major “domains” in the product:

- the interactive workbench domain
- the workspace intelligence domain

The workbench domain is what the user sees.
The workspace intelligence domain is what compresses, indexes, recovers, and reasons over files.

## 2. Main User Experience

### 2.1 Editor Surface

The `Editor` surface is the main IDE/workbench experience.

It contains:

- top bar
- activity bar
- sidebar
- file explorer
- Monaco editor region
- optional graph view
- optional marketplace view
- optional operations view
- chat panel
- bottom panel terminal
- status bar

The editor is the canonical place where a user:

- opens a folder
- restores a previous folder
- uploads/selects a workspace
- browses files
- edits files
- chats with the assistant
- triggers workspace indexing
- opens the dependency graph

### 2.2 Terminal Surface

The `Terminal` surface is meant to feel like a separate page-like workspace mode, not just a bottom panel.

Current intended behavior:

- switching to `Terminal` should foreground a dedicated terminal workspace surface
- the live terminal instance should open in the actual selected workspace root
- for local-path workspaces, it should use the real local root path
- for uploaded workspaces, the server should materialize files into a temp directory and open the shell there
- the UI already reserves room for multi-pane terminal layouts

There are currently two terminal concepts in the app:

- the old bottom-panel terminal
- the new top-level `Terminal` surface

The new surface is the intended main terminal experience.
The bottom panel still exists as a legacy/secondary terminal UI.

### 2.3 Voice-Coding Surface

The `Voice-Coding` surface is intended as a full speech-first coding mode.

The current desired experience is:

- before starting:
  - only a large orb
  - a single button: `Jetzt starten`
- after starting:
  - a split layout
  - left side: orb and live voice session state
  - right side: transcript, narration, run updates, approvals, file opens, code-context viewer

The current voice system is not supposed to be a toy transcript widget.
It is intended to be a real agent surface that:

- listens to the user
- transcribes spoken input
- routes tool calls
- delegates larger tasks to the normal Mesh coding agent
- narrates short replies back
- shows detailed state in the UI

## 3. Frontend Shell Structure

The main shell lives in:

- `views/app.html`
- `assets/app-workspace.js`
- `assets/app-workspace.css`

### 3.1 `views/app.html`

This file defines the entire main app shell.
It includes:

- auth overlay
- top bar with traffic lights and surface switcher
- activity bar
- sidebar panels
- center region with editor and feature views
- dedicated `graphView`
- dedicated `terminalSurfaceView`
- dedicated `voiceCodingView`
- bottom panel terminal
- chat panel
- status bar

Important UI decisions now encoded here:

- HTML pages are all under `views/`
- `/app` is the main workbench shell
- the top-center surface switcher controls:
  - `Editor`
  - `Terminal`
  - `Voice-Coding`

### 3.2 `assets/app-workspace.js`

This is the main browser runtime for the app shell.

It owns:

- global frontend state `S`
- current folder/workspace state
- current view state
- current surface mode
- tabs and editor state
- explorer scan state
- diff-based indexing state
- chat visibility
- sidebar visibility
- shell actions and action registry
- graph refresh events
- workspace snapshots
- local folder open / restore logic
- terminal surface routing
- voice surface routing

Its `S.workspaceIndex` state now tracks:

- `scanEpoch`
- `knownFilesByPath`
- `indexedFingerprintsByPath`
- `pendingPaths`
- `deletedPaths`
- `initialIndexDone`
- `backgroundIndexRunning`
- `lastMode`
- stats for `discovered`, `indexed`, `skipped`, `deleted`

That means the app no longer treats indexing as one giant opaque action.
It models it as a phased and diff-based workflow.

### 3.3 `assets/app-workspace.css`

This styles the entire app shell, including:

- shell layout
- top bar
- sidebar
- editor region
- graph
- terminal surface
- voice surface
- orb staging areas
- split layouts
- status elements

It now carries not just the old IDE styling but also the new full-surface modes.

## 4. Settings Architecture

### 4.1 Settings Product Model

Settings are no longer intended to behave like an editor tab inside the app.
They are intended to behave like a standalone page flow.

Current canonical route:

- `/settings`

It is a combined SPA-style page with hash-based section routing.

Main sections:

- `Account`
- `Security`
- `Billing`
- `API Keys`
- `Appearance`
- `AI & Models`

### 4.2 Main Files

- `views/settings.html`
- `assets/settings.js`
- `assets/settings-combined.js`
- `assets/mesh-settings.css`

### 4.3 Data Model

Settings primarily store values in the user store.

The frontend user-store keys include:

- `meshAiAnthropic`
- `meshAiOpenAI`
- `meshAiGoogle`
- `meshAiByok`
- `meshAiBehaviour`
- `meshByokModelRegistry`
- `meshApiKeys`
- `meshAppearance`
- `meshSwitches`
- `meshAccountProfile`
- `meshWorkspaceConfig`
- `meshSecurityBaseline`
- `meshBillingContact`
- `meshBillingState`
- `meshIntegrations`

The settings runtime:

- hydrates local cache first
- tries to fetch safe values from `/api/user/store`
- persists values to local storage and user store
- treats backend failure as non-fatal in many places so the UI still works

### 4.4 Return Navigation

Settings preserve a `returnTo` route, usually back to `/app`.
This allows settings to behave like a separate product surface while still returning the user to the correct shell state.

## 5. Assistant System

Mesh currently has two assistant-facing modes:

- typed assistant in the chat panel
- voice-driven assistant in the voice surface

The typed assistant is the more mature canonical coding path.
The voice assistant is built as a speech-driven front-end over similar workspace and run capabilities.

### 5.1 Typed Assistant

Main backend surfaces (refactored April 2026):

- `src/routes/assistant.routes.js` (workspace CRUD, file ops, recovery, offload)
- `src/routes/assistant-chat.routes.js` (chat/run flows, extracted from assistant.routes.js)
- `src/routes/assistant-git.routes.js` (git status/diff/commit/push, extracted from assistant.routes.js)

These route modules provide browser-facing APIs for:

- assistant status
- workspace offload config
- workspace offload ingest
- workspace select
- open local workspace
- workspace files
- workspace graph
- workspace file open
- workspace sync
- workspace recovery
- create/save/delete/rename/batch file operations
- assistant chat/run flows

The assistant route layer generally:

- prefers worker tunnel requests
- falls back to local gateway-side logic if the worker is unavailable

### 5.2 Assistant Runtime in `src/core/`

The core layer was refactored (April 2026) from a single monolithic `index.js` into focused modules:

- `src/core/index.js` — main aggregator and global exposure
- `src/core/model-providers.js` — AI model constants, provider call functions (Anthropic/OpenAI/Gemini/BYOK), system prompt
- `src/core/mesh-codec.js` — ROT47 transforms, token dictionary encode/decode, codec session state
- `src/core/operations-store.js` — operations/deployments/policies state management
- `src/core/workspace-context.js` — capsule context loading, prompt assembly, codec injection, prefix stability
- `src/core/workspace-infrastructure.js` — workspace setup and provisioning
- `src/core/workspace-ops.js` — workspace CRUD operations
- `src/core/assistant-runs.js` — run planning and execution
- `src/core/auth.js` — authentication logic
- `src/core/deployments.js` — deployment management
- `src/core/voice-agent.js` — voice agent tool loop
- `src/core/voice-aws-audio.js` — AWS STT/TTS integration (Amazon Transcribe + Polly)

Functions are still exposed globally through `src/server.js`.

## 6. Workspace Model

Mesh supports two primary workspace source kinds:

- `local-path`
- `upload`

### 6.1 Local Path Workspace

A local path workspace means:

- the browser selected a local folder
- the app can use the File System Access API in the browser
- the worker can also open and operate on a real root path where applicable

Local path workspaces should support:

- real root path
- terminal opening directly in that root path
- direct file I/O on disk
- search and graphing
- capsule generation
- recovery

### 6.2 Upload Workspace

An upload workspace means:

- files are selected/ingested from the browser
- metadata and records are stored in the workspace metadata store
- worker-side file records live in metadata and/or blob-backed storage
- when terminal access is needed, the gateway materializes the uploaded workspace into a temporary directory

The upload path is important because the editor remains the source of truth for selecting/importing workspaces, but all other surfaces should still operate on that same workspace.

That means:

- editor opens/upload selects the workspace
- terminal uses it as source
- graph uses it as source
- voice uses it as source

## 7. Workspace Selection and Indexing

### 7.1 Frontend Orchestration

The workspace open flow starts in the browser.

The frontend:

- discovers files in the selected folder
- tracks fingerprints per file
- computes diffs
- sends only changed/new files to `/api/assistant/workspace/sync`
- emits progress and graph refresh events

Relevant events:

- `mesh-indexing-initial-ready`
- `mesh-indexing-background-progress`
- `mesh-indexing-complete`

The intended behavior is:

- initial useful index first
- background indexing afterwards
- graph refresh after initial ready and after completion

### 7.2 Backend Sync Contract

The sync endpoint accepts:

- `workspaceId`
- `folderName`
- `files`
- `deletedPaths`
- `append`
- `mode`
- `scanEpoch`
- `complete`

The main modes are intended to be:

- `initial`
- `background`
- `single-file`
- `refresh`

This is a diff-ingest model, not a full-resend model.

### 7.3 Worker Ingest

The worker:

- normalizes incoming files
- filters non-indexable files
- builds workspace records
- stores file records and summaries
- enqueues background enrichment
- can produce graph and dependency artifacts afterwards

## 8. Compression and Capsule System

This is one of the core differentiators of Mesh.

The main implementation is:

- `mesh-core/src/compression-core.cjs`

### 8.1 Record Model

Each workspace file is stored as a richer record, not just raw text.

A record can contain:

- raw storage
- base capsule
- main capsule cache
- capsule variants
- focused capsule cache
- span index
- transport envelope
- dependencies
- compression stats

### 8.2 Record Modes

There are now two major record modes:

- `initial`
- `full`

`initial` is meant to produce a faster, lighter record first.
`full` is meant to produce richer output later.

The intended pipeline is:

- build a fast initial record
- make the app usable
- enrich later in background

### 8.3 Capsule Tiers

Per file, the system produces three fixed capsule tiers:

- `ultra`
- `medium`
- `loose`

Current semantics:

- `ultra`
  - smallest possible useful capsule
  - compact single-line `CAP` header (saves ~40 tokens vs verbose header)
  - for large files: very aggressive compression
  - for tiny files (≤150 tokens): passthrough mode — raw text with minimal header, no capsule overhead
- `medium`
  - intermediate capsule
  - more detail than `ultra`
  - standard 3-line `CAPSULE v2` header
- `loose`
  - richest capsule
  - preserves the most structure and context
  - standard 3-line `CAPSULE v2` header

### 8.4 Current Tier Logic Status

Each tier has:

- different token budgets
- different section/item selection profiles
- different allowed priorities
- different rendering compactness
- different mode preference order

The ordering is: `ultra < medium < loose` in both content amount and token size.

Small files are treated more gently so the system does not destroy useful context for tiny inputs.

### 8.4a Workspace-Level Budget Allocation (April 2026)

Instead of each file getting an isolated per-file budget, the workspace now distributes a global token budget (default 8000, configurable via `MESH_WORKSPACE_TOKEN_BUDGET`) proportionally by importance:

- Importance = `(dependency count * 2) + (recently referenced ? 5 : 0) + log2(raw tokens)`
- Each file gets at least 24 tokens
- `selectTierForBudget()` picks the richest tier that fits the allocation

### 8.4b Delta-Rebuild (April 2026)

When re-indexing a local workspace, files are compared by SHA-256 digest. Unchanged files reuse their existing record, reducing rebuild time from ~1.2s to ~50ms for workspaces with 1-3 changed files.

### 8.4c Symbol Pseudo-Code Integration (April 2026)

The capsule pipeline now uses `llm-compress.pseudo()` for symbol summaries in code capsules. Instead of generic `function hashPassword lines=42 sig="function hashPassword(..."`, symbols render as `function declaration hashPassword → "${salt}:${scryptHash}"` when a pattern match is available.

### 8.5 Focused Capsules

In addition to the three base tiers, there is also a focused capsule mode.

Focused capsules are built:

- on demand
- from a query
- using the relevant tier as the base

This allows a file to be compressed generally and then re-expanded selectively around a query.

### 8.6 Recovery

If the capsule is too stripped, the system can recover exact spans or ranges through:

- span IDs
- byte ranges
- line ranges

This gives the app a way to:

- reason with compressed context
- then pull exact source fragments when needed

### 8.7 Transport Envelope

Each file may also have a transport envelope that contains chunking and digest information.

This is used for:

- chunked storage
- integrity
- recovery/index reconstruction

## 9. Worker Role

The worker lives in:

- `mesh-core/src/server.js`
- `mesh-core/src/workspace-operations.js`
- `mesh-core/src/workspace-helpers.js`
- `mesh-core/src/mesh-state.js`

The worker is the main execution engine for workspace operations.

It provides a `/mesh/tunnel` endpoint that supports actions like:

- `status`
- `workspace.open-local`
- `workspace.select`
- `workspace.files`
- `workspace.graph`
- `workspace.file.open`
- `workspace.capsule.open`
- `workspace.transport.open`
- `workspace.recovery.fetch`
- `workspace.search`
- `workspace.grep`
- `workspace.file.create`
- `workspace.file.save`
- `workspace.file.rename`
- `workspace.file.delete`
- `workspace.batch`
- `git.status`
- `git.diff`
- `git.commit`
- `git.push`
- `git.pull`
- `chat`

The worker currently owns a lot of the real workspace truth.

That includes:

- file records
- current selected workspace state
- graph edges
- search
- recovery
- local git operations
- local open-local indexing

## 10. Dependency Graph

### 10.1 Intended Behavior

The graph should visualize dependencies between files in the active workspace.

It should prefer worker/indexed data where available, and use local browser fallback logic when necessary.

It should update:

- after initial index
- after background indexing
- when the graph view becomes visible

### 10.2 Frontend Graph Renderer

Main file:

- `assets/app-graph.js`

It does two things:

- fetches the server graph from `/api/assistant/workspace/graph`
- falls back to local graph construction if needed

The local graph builder:

- walks `S.tree`
- filters excluded dirs
- loads dependency-source files
- extracts import/export/require specifiers
- resolves relative targets
- builds nodes and edges
- adds some structural affinity edges

### 10.3 Current Graph Reliability

The graph is not yet something I would describe as “100% code-side guaranteed”.

Main reasons:

- frontend graph code currently builds a synthetic `workspaceId` from `dirName + userId`
- worker graph logic uses the selected workspace ID as canonical identity
- if the frontend sends a non-empty but wrong `workspaceId`, the worker may read only from the metadata store and not from the actual active runtime workspace
- the empty-state message in the graph currently conflates:
  - no folder open
  - wrong workspace identity
  - indexing still in progress
  - empty dependency set

So the intended graph architecture is solid, but the identity and empty-state logic are still a known weak point.

## 11. Terminal Architecture

### 11.1 Browser Side

The app has:

- a bottom-panel terminal
- a full `Terminal` surface

The browser connects to:

- websocket endpoint `/terminal`

### 11.2 Server Side

In `src/server.js`, terminal sessions are created using `node-pty`.

The server resolves the terminal CWD like this:

- if a local-path workspace is active:
  - use the actual local root path
- if an upload workspace is active:
  - materialize the workspace into a temp directory under `MESH_TERMINAL_UPLOAD_ROOT`
  - open terminal there
- otherwise:
  - fall back to project root

This is important because it means terminal is no longer just hardwired to the repo root.
It is supposed to follow the user’s active workspace.

### 11.3 Upload Workspace Materialization

For uploaded workspaces:

- the gateway enumerates workspace files
- opens original content
- writes each file into a temp directory
- caches a `.mesh-terminal-meta.json` marker
- reuses the materialized directory when possible

This creates a bridge from:

- uploaded workspace records
to
- a real shell-accessible directory tree

## 12. Voice System

### 12.1 High-Level Model

The previous Azure realtime websocket handshake path was too unstable.
The current voice system is intentionally built as:

- Amazon Transcribe Streaming (speech-to-text)
- AWS Bedrock text model tool loop
- Amazon Polly (text-to-speech)

not as a single realtime model contract.

### 12.2 Main Files

- `src/routes/realtime.routes.js`
- `src/core/voice-agent.js`
- `src/core/voice-aws-audio.js`
- `assets/features/voice-chat.js`
- `assets/features/voice-audio-worklet.js`

### 12.3 Browser Role

The browser side is responsible for:

- mic capture
- audio worklet
- PCM streaming to `/api/realtime`
- orb rendering
- session state
- transcript rendering
- approval prompts
- viewer log
- surface mounting into the Voice-Coding page

### 12.4 Gateway Role

The gateway voice relay is responsible for:

- websocket session handling at `/api/realtime`
- VAD-like utterance segmentation
- transcription
- assembling conversation messages
- loading capsule context
- running the tool loop
- speaking the reply back via TTS

### 12.5 Voice Agent Session

The voice agent is a real tool surface, not only raw STT/TTS glue.

Its defined tools include:

- `delegate_task`
- `get_run_status`
- `approve_action`
- `reject_action`
- `read_file`
- `read_capsule`
- `recover_spans`
- `search_workspace`
- `open_file`
- `git_status`
- `git_diff`
- `run_terminal_command`
- `edit_file`

Its intended behavior is:

- use direct read/search/open for short tasks
- use `delegate_task` for multi-step coding work
- share approval semantics with the typed agent
- be concise in spoken output
- put detailed state in the UI

### 12.6 Voice Workspace Context

The voice layer now tries to load capsule context from the active workspace, including upload workspaces.

It can:

- discover preferred active/selected paths
- fall back to listing workspace files
- load capsule context
- build a capsule context block

This is what gives voice access to compressed workspace knowledge.

### 12.7 Voice Surface UX

The intended UX now is:

- intro page:
  - only the orb
  - only the `Jetzt starten` button
- live mode:
  - left side orb
  - left side session state
  - stop session button
  - right side viewer log for transcript, approvals, file opens, tool updates, code context

The orb has also been made:

- larger
- stronger visually
- rotatable via drag
- not draggable across the page

## 13. Authentication and Persistence

### 13.1 Auth

Auth is handled through:

- `src/routes/auth.routes.js`
- `src/core/auth.js`
- `secure-db.js`

Sessions are protected via `requireAuth` for the main assistant and settings routes.

### 13.2 Secure DB

`secure-db.js` is the secure persistence abstraction for:

- users
- sessions
- user store values

Earlier local SQLite files were removed, and current runtime persistence is based on the newer backend path.

### 13.3 Workspace Metadata Store

`workspace-metadata-store.cjs` is the persistence layer for workspace records and summaries.

This matters most for:

- uploaded workspaces
- resumable indexing
- worker graph/search/file access
- blob-backed file storage

## 14. Routing Model

### 14.1 Clean URLs

`src/server.js` serves clean URLs:

- `/`
- `/app`
- `/settings`
- `/settings-account`
- `/settings-security`
- etc.

HTML pages are resolved from `views/` first.

### 14.2 Static Assets

The whole repo root is used as the static root for serving frontend assets.

### 14.3 Main Route Modules

- `src/routes/auth.routes.js`
- `src/routes/app.routes.js`
- `src/routes/assistant.routes.js`
- `src/routes/realtime.routes.js`

## 15. Current Intended End-to-End Flow

### 15.1 Editor Flow

1. User opens `/app`
2. Auth overlay resolves
3. User opens or restores a folder
4. Explorer tree is populated
5. Initial workspace sync is sent
6. Initial index becomes available
7. Background indexing continues
8. Chat/editor/features use workspace data
9. Graph and other tools react to indexing events

### 15.2 Terminal Flow

1. User opens workspace in editor
2. User switches to `Terminal`
3. Browser opens `/terminal` websocket
4. Server resolves correct CWD from active workspace
5. For uploads, workspace is materialized if necessary
6. Shell starts in the correct directory

### 15.3 Voice Flow

1. User switches to `Voice-Coding`
2. Intro orb is shown
3. User clicks `Jetzt starten`
4. Browser opens `/api/realtime`
5. Mic audio streams to gateway
6. Gateway segments speech
7. Gateway sends PCM to Amazon Transcribe Streaming
8. Gateway builds message list and capsule context
9. Gateway runs Bedrock text tool loop
10. Voice agent executes tools / delegates tasks
11. Reply text is synthesized to speech
12. UI shows transcript + state + tool updates

## 16. Known Strong Parts

These parts are conceptually and structurally much stronger than before:

- standalone settings flow
- dedicated top-level surfaces
- diff-based workspace sync
- explicit indexing phases
- terminal tied to real active workspace
- upload workspace materialization for terminal
- STT -> text tool loop -> TTS voice architecture
- three-tier capsule model
- worker tunnel abstraction for workspace operations

## 17. Known Weak or Incomplete Areas

These are the most important places where the product still has real rough edges.

### 17.1 Graph Identity / Empty State

The graph is still the biggest current reliability concern.

The main issues are:

- frontend may send the wrong workspace identity
- worker graph path may trust that ID too much
- empty state is still semantically too blunt

### 17.2 Multiple Sources of Workspace Truth

There are still several partially overlapping truths:

- browser `S.dirName`
- browser `S.tree`
- local assistant workspace
- worker `workspaceState`
- metadata-store workspace summaries
- upload workspace IDs

The long-term ideal is:

- one canonical active workspace identity
- all views and APIs use it

### 17.3 Backend Core Modularization (Improved)

`src/core/index.js` has been significantly reduced by extracting focused modules (model-providers, mesh-codec, operations-store, workspace-context, etc.). It is still the main aggregator but no longer houses all logic directly. Route files have also been split (assistant-chat, assistant-git extracted from assistant.routes.js).

### 17.4 Dual Terminal Model

The app still has:

- old bottom-panel terminal
- new dedicated terminal surface

This is okay short-term but still conceptually duplicated.

### 17.5 Voice Surface Maturity

Voice is much better than before, but still newer than typed chat.

The core path now works conceptually, but it still needs continued real-world testing on:

- long sessions
- approval flow
- mixed read/write tasks
- interruption handling
- file-view/code-change viewer behavior

## 18. What the System Is Supposed to Be

If you collapse all the current intent into one sentence, Mesh is supposed to be:

`a coding environment where one imported workspace becomes the shared source of truth for editor, terminal, graph, typed agent, and voice agent, with compressed capsule-based context making multi-file reasoning cheaper and faster.`

That implies a few design rules:

- the workspace is selected once and reused everywhere
- the editor is the primary entry point
- terminal uses the same workspace
- graph uses the same workspace
- voice uses the same workspace
- compressed capsules are the fast semantic layer over raw files
- exact source is recoverable on demand
- background intelligence must not block first usability

## 19. Practical “Current State” Summary

Right now, the system is best understood as:

- a real browser-based coding shell
- with functioning editor/chat/settings/terminal/voice surfaces
- with a worker-backed workspace intelligence layer
- with a meaningful compression architecture
- with a voice system built on Amazon Transcribe + Polly (avoids fragile realtime websocket contracts)
- with one still-important unresolved reliability zone around graph identity and graph empty-state semantics

## 20. Files Most Worth Knowing

If someone wanted to understand the current product quickly, the most important files to read first are:

- `views/app.html`
- `assets/app-workspace.js`
- `assets/app-graph.js`
- `assets/features/voice-chat.js`
- `src/server.js`
- `src/routes/assistant.routes.js`
- `src/routes/assistant-chat.routes.js`
- `src/routes/realtime.routes.js`
- `src/core/index.js`
- `src/core/model-providers.js`
- `src/core/workspace-context.js`
- `src/core/voice-agent.js`
- `mesh-core/src/workspace-operations.js`
- `mesh-core/src/compression-core.cjs`
- `src/config/index.js`
- `assets/settings.js`

## 21. Why This File Exists

This file exists to answer:

- what Mesh currently is
- how the major parts fit together
- what is implemented vs intended
- where the architecture is already coherent
- where the current product still needs cleanup or hardening

It should be updated whenever:

- a major surface changes
- the workspace identity model changes
- the indexing/compression model changes
- the graph architecture changes
- the voice architecture changes
- settings/navigation structure changes
