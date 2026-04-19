# Phase 30: Editor — Monaco Functionality & Welcome Screen - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 30-editor-monaco-functionality-welcome-screen
**Areas discussed:** Monaco rendering bug, Recent workspaces data source, Indexing indicator logic, Welcome screen UX

---

## Monaco Rendering Bug

| Option | Description | Selected |
|--------|-------------|----------|
| Blank/empty editor | Race condition — initMonaco fires before require defined, monacoReady never true | ✓ |
| No syntax colors | Language detection or theme issue, CDN worker misconfigured | |
| Both — inconsistent | Timing/race on slower connections | ✓ |

**User's choice:** Both — inconsistent (timing race confirmed)
**Notes:** Symptom is inconsistent — sometimes blank, sometimes renders without colors. Root cause identified as the `defer` attribute on loader.js causing `require` to be undefined when DOMContentLoaded fires.

---

## Monaco Fix Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Poll for require + retry | Wait up to 5s for require to appear | |
| Switch to window.onload | Move initMonaco() into window.onload | |
| onload attribute on loader script | Add onload callback to the <script> tag | ✓ |

**User's choice:** "whatever works best" — deferred to Claude's discretion
**Notes:** Claude selected `onload` attribute approach as cleanest — `onload="window.__monacoLoaderReady=true"` on the loader script, then polling in `initMonaco()` for the flag. Zero race condition, fires immediately when loader is ready.

---

## Recent Workspaces Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage paths + re-prompt | Simple, zero backend changes | |
| IndexedDB handles + requestPermission | Browser permission re-grant flow | |
| Server API per user account | Survives cache clears, cross-device | |
| Dual storage (IndexedDB + server) | Best of both — handles for re-open, server for persistence | ✓ |

**User's choice:** Dual storage — IndexedDB for handles (re-open without re-picker) + server-side for list (survives cache clears)
**Notes:** User explicitly required that recent workspaces survive browser cache resets. localStorage and IndexedDB alone don't satisfy this — server-side storage per user account is mandatory. Handles in IndexedDB still needed for the `requestPermission` re-open flow.

---

## Recent Workspaces Count

| Option | Description | Selected |
|--------|-------------|----------|
| 5 most recent | VS Code default | |
| 3 most recent | Minimal, focused | ✓ |
| 10 most recent | Power users | |

**User's choice:** 3 most recent

---

## Welcome Screen Click UX

| Option | Description | Selected |
|--------|-------------|----------|
| Permission prompt + auto-load | requestPermission on stored handle, auto-open on grant | ✓ |
| Open folder picker | showDirectoryPicker each time | |

**User's choice:** Permission prompt + auto-load (same as existing Restore Previous Workspace behavior)

---

## Indexing Indicator — Startup Bug

| Option | Description | Selected |
|--------|-------------|----------|
| CSS transition on progress fill | Smooth animation + fix early-return idle calls | ✓ |
| Debounce state updates | Batch rapid calls with 100ms debounce | |

**User's choice:** CSS transition + fix early-return paths in restoreFolder()
**Notes:** Two bugs: (1) shows on startup because restoreFolder early returns without calling idle; (2) glitches during real indexing because no CSS transition on the fill bar.

---

## Claude's Discretion

- Monaco loader race fix implementation detail (onload flag + polling vs other approaches)
- Server API schema for recent workspaces (field names, response envelope)
- idb-keyval key naming for multiple recent handles
- CSS transition duration
- Whether restoreFolder() is refactored into a shared utility or recent-workspace click duplicates it

## Deferred Ideas

- Monaco IntelliSense / LSP — separate phase
- Multi-root workspace tabs — out of scope
- Welcome screen "New File" — future editor UX phase
- Workspace sync across devices — future phase
