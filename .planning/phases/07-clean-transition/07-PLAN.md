---
phase: 7
title: "Clean Transition — app-v2 becomes app.html with external assets + light UI"
wave: 1
depends_on: []
files_modified:
  - views/app-v2.html
  - views/app.html
autonomous: true
requirements_addressed: []
---

# Plan: Transition app-v2 → app.html

## Objective

Promote app-v2.html to become the new app.html. Keep app-v2's visual design and structure, but wire it into the external asset pipeline (app-workspace.css, app-workspace.js, all feature scripts, CDN libs). Set light theme as default. Delete old app.html.

## ID Alignment Map (app-v2 → what app-workspace.js expects)

### Missing IDs to ADD:
| Element | Current app-v2 state | Required ID |
|---------|---------------------|-------------|
| Title bar text | missing | `id="tbTitle"` |
| Surface buttons | no IDs, just data-surface | `id="btnSurfaceEditor"`, `id="btnSurfaceTerminal"`, `id="btnSurfaceVoice"` |
| Toggle chat btn | missing | `id="btnToggleChat"` |
| Search btn (top) | data-action="Search" | `id="btnGSearch"` |
| Settings btn (top) | data-action="Settings" | `id="btnTopSettings"` |
| SCM badge | `<span class="ab-badge">` | `id="scmBadge"` |
| Branch name | `<span>main</span>` in scm | `id="branchName"` |
| Commit input | `<input class="scm-input">` | `id="commitMsg"` |
| Commit button | data-action="Commit" | `id="btnCommit"` |
| Pull button | data-action="Pull" | `id="btnPull"` |
| Push button | data-action="Push" | `id="btnPush"` |
| Changes list | `<div class="scm-change-list">` | `id="chgList"` |
| Changes count | `<span class="scm-changes-badge">` | `id="chgCnt"` |
| Git init panel | missing | `id="scmInit"` |
| New File btn | data-action="New File" | `id="btnNewFile"` |
| New Folder btn | data-action="New Folder" | `id="btnNewFolder"` |
| Refresh btn | data-action="Refresh" | `id="btnRefresh"` |
| Collapse btn | data-action="Collapse All" | `id="btnCollapseAll"` |
| Open Folder btn | data-action="Open Folder" (header) | `id="btnOpenFolder"` |
| Open Folder btn (tree) | data-action="Open Folder" (body) | `id="btnOpen2"` |
| Welcome Open btn | data-action="Open Folder" (welcome) | `id="wOpen"` |
| Welcome Ask AI btn | missing | `id="wChat"` |
| Graph button (actbar) | data-action="Mesh Graph" | `id="abGraph"` |
| Ops button (actbar) | missing | `id="abOps"` |
| Settings button (actbar) | data-action="Settings" (bottom) | `id="abSettings"` |
| Open Marketplace btn | missing in sidebar | `id="btnOpenMarketplace"` |
| Search input | `<input class="sb-search-input">` | `id="searchIn"` |
| Search results | missing | `id="searchOut"` |
| File tree container | missing | `id="fileTree"` |
| Empty explorer | missing | `id="emptyExp"` |
| File footer | missing | `id="fileFoot"` |
| File count | missing | `id="fileNum"` |
| Scan progress | missing | `id="scanProg"` |
| Monaco editor | missing | `id="monaco"` |
| Graph view | missing | `id="graphView"` |
| Ops view | missing | `id="opsView"` |
| Index progress | missing | `id="idxProgWrap"`, `id="idxProgFill"`, `id="idxProgText"` |
| Restore btn (welcome) | missing | `id="wRestore"` |
| Restore btn (tree) | missing | `id="btnRestore2"` |

### IDs to RENAME:
| Current | Required |
|---------|----------|
| `id="agentPanel"` | `id="chatPanel"` |
| `id="termBody"` | `id="termContainer"` |
| `id="vsIntro"` | `id="voiceSurfaceIntro"` |
| `id="vsLive"` | `id="voiceSurfaceLive"` |
| `id="vsState"` | `id="voiceSurfaceState"` |
| `id="tsGrid"` | `id="terminalSurfaceGrid"` |
| `id="btnTsSingle"` | `id="btnTerminalSurfaceSingle"` |
| `id="btnTsGrid"` | `id="btnTerminalSurfaceGrid"` |

### Class names to ALIGN:
| Current app-v2 | Required by app-workspace.css |
|----------------|-------------------------------|
| `.agent-panel` | `.chat-panel` |
| `.ap-hdr` | `.chat-hdr` |
| `.ap-act` | `.ch-a` |
| `.sb-panel` | `.sb-p` |
| `.scm-commit-btn` | `.scm-btn` |
| `.scm-act-btn` | `.sca` |
| `.scm-input` | `.sb-input` |
| `.sb-search-input` | `.sb-input` |
| `.ts-*` classes | `.terminal-surface-*` / `.terminal-pane*` |
| `.vs-*` classes | `.voice-surface-*` |

### Missing DOM elements (required by app-workspace.js):
- `<div id="monaco" class="monaco-el" style="display:none"></div>` in center pane
- `<div id="opsView" class="fv" style="display:none"></div>` in center pane
- `<div id="graphView" class="fv" style="display:none;background:var(--bg)"></div>` in center pane
- `<div class="rs rs-h" id="rsTerm" style="display:none"></div>` before bottom panel
- Terminal bottom panel action buttons with IDs: `btnTermNew`, `btnTermKill`, `btnTermMax`, `btnTermClose`
- Index progress bar in status bar
- Git init fallback panel `id="scmInit"` in SCM
- File tree structure with `id="fileTree"`, `id="emptyExp"`, `id="fileFoot"`, `id="fileNum"`, `id="scanProg"`
- Terminal surface primary mount: `id="terminalSurfacePrimary"`
- Voice surface model label: `id="voiceSurfaceModel"`
- Voice surface orb stages: `id="voiceSurfaceOrbStageIntro"`, `id="voiceSurfaceOrbStage"`
- Terminal surface status: `id="terminalSurfaceStatus"`
- New Chat button: `id="btnNewChat"`

## Tasks

<task id="1">
<title>Strip inline CSS, load app-workspace.css, set light theme</title>
<read_first>
- views/app-v2.html (lines 1-330 — inline CSS block)
- assets/app-workspace.css (lines 1-20 — verify light theme vars)
</read_first>
<action>
1. Change `<html lang="en" data-theme="dark">` to `<html lang="en" data-theme="light">`
2. Remove the entire inline `<style>...</style>` block (lines 22-330 approx)
3. Add after the Google Fonts link:
   `<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.min.css">`
   `<link rel="stylesheet" href="/assets/app-workspace.css?v=20260408b">`
4. Add CDN script tags in `<head>`:
   `<script src="https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js"></script>`
   `<script src="https://cdnjs.cloudflare.com/ajax/libs/bodymovin/5.12.2/lottie.min.js"></script>`
   `<script src="/assets/app-graph.js?v=20260408b"></script>`
</action>
<acceptance_criteria>
- `data-theme="light"` on html element
- No inline `<style>` block (CSS custom properties removed)
- `app-workspace.css` linked
- xterm CSS linked
- d3, lottie, app-graph.js script tags present in head
</acceptance_criteria>
</task>

<task id="2">
<title>Align all DOM element IDs and classes to match app-workspace.js expectations</title>
<read_first>
- views/app-v2.html (full file after task 1)
- views/app.html (reference for exact ID/class usage)
- assets/app-workspace.js (lines 380-560 — DOM selectors used)
</read_first>
<action>
Apply all ID renames, additions, and class changes from the alignment map above. Restructure sidebar, chat panel, terminal, and voice surface DOM to match app.html's exact structure while preserving app-v2's visual design choices. Add all missing DOM elements (monaco, graphView, opsView, rsTerm, file tree, index progress, etc).
</action>
<acceptance_criteria>
- `id="chatPanel"` present (not agentPanel)
- `id="termContainer"` present (not termBody)
- `id="btnToggleChat"` present
- `id="btnGSearch"` present
- `id="monaco"` present
- `id="graphView"` present
- `id="fileTree"` present
- `id="scmBadge"` present
- `id="branchName"` present
- `id="commitMsg"` present
- `id="terminalSurfacePrimary"` present
- `id="voiceSurfaceModel"` present
- All `.sb-panel` renamed to `.sb-p`
- `.agent-panel` renamed to `.chat-panel`
</acceptance_criteria>
</task>

<task id="3">
<title>Strip inline JS, load external scripts</title>
<read_first>
- views/app-v2.html (bottom — inline script block)
- views/app.html (lines 288-321 — script loading order)
</read_first>
<action>
1. Remove entire inline `<script>(function () { ... })();</script>` block
2. Add before `</body>`:
   ```
   <script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js"></script>
   <script src="https://cdn.jsdelivr.net/npm/idb-keyval@6/dist/umd/idb-keyval-min.js"></script>
   <script type="module">
     import { Terminal } from 'https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/+esm';
     import { FitAddon } from 'https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/+esm';
     window.Terminal = Terminal;
     window.FitAddon = FitAddon;
     window.dispatchEvent(new CustomEvent('xterm-ready'));
   </script>
   <script src="/assets/features/_bus.js"></script>
   <script src="/assets/app-workspace.js?v=20260408b"></script>
   <script src="/assets/features/streaming-chat.js"></script>
   <script src="/assets/features/at-mentions.js"></script>
   <script src="/assets/features/agentic-edits.js"></script>
   <script src="/assets/features/inline-edit.js"></script>
   <script src="/assets/features/command-palette.js"></script>
   <script src="/assets/features/split-editor.js"></script>
   <script src="/assets/features/diff-editor.js"></script>
   <script src="/assets/features/content-search.js"></script>
   <script src="/assets/features/problems-panel.js"></script>
   <script src="/assets/features/quick-open.js"></script>
   <script src="/assets/features/capsula-status.js"></script>
   <script src="/assets/features/capsule-viewer.js"></script>
   <script src="/assets/features/span-nav.js"></script>
   <script src="/assets/features/context-budget.js"></script>
   <script src="/assets/features/reindex-on-save.js"></script>
   <script src="/assets/features/checkpoints.js"></script>
   <script src="/assets/features/meshrules.js"></script>
   <script src="/assets/features/chat-threads.js"></script>
   <script src="/assets/features/background-agent.js"></script>
   <script src="/assets/features/ai-review.js"></script>
   <script src="/assets/features/voice-chat.js"></script>
   ```
</action>
<acceptance_criteria>
- No inline IIFE script block
- monaco-editor loader present
- idb-keyval present
- xterm ESM module import present
- _bus.js loaded before app-workspace.js
- app-workspace.js loaded
- All 20 feature scripts loaded in correct order
- voice-chat.js is last feature script
</acceptance_criteria>
</task>

<task id="4">
<title>Replace old app.html with finalized app-v2.html</title>
<read_first>
- views/app-v2.html (finalized version)
- views/app.html (to be replaced)
- src/server.js (routing — verify /app still works)
- assets/app.js (links to app.html)
</read_first>
<action>
1. Copy views/app-v2.html → views/app.html (overwrite)
2. Delete views/app-v2.html
3. Verify src/server.js clean URL routing still resolves /app → views/app.html
4. No changes needed to server.js — it already does fs.existsSync on views/*.html
</action>
<acceptance_criteria>
- views/app.html exists with data-theme="light" and external asset loading
- views/app-v2.html does NOT exist
- Accessing /app in browser loads the new light-themed IDE
</acceptance_criteria>
</task>

## must_haves

- app-v2's visual design preserved (layout, content, UX choices)
- Light theme active by default
- All external scripts loaded and functional
- DOM IDs aligned with app-workspace.js
- Old app.html replaced, app-v2.html removed
- /app route serves the new version
