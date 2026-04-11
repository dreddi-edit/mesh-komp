---
tags: [frontend]
---

# App Shell

## Files

| File | Role |
|------|------|
| `views/app.html` | Full IDE shell DOM structure |
| `assets/app-workspace.js` | Main browser runtime — state, actions, indexing, routing |
| `assets/app-workspace.css` | All shell styling including surface modes |
| `assets/app-graph.js` | D3 dependency graph renderer |

## `views/app.html` Structure

The HTML defines the complete shell:

```
auth overlay
top bar
  ├─ traffic lights (window controls)
  ├─ surface switcher (Editor / Terminal / Voice-Coding)
  └─ menu/profile
activity bar (icon nav)
sidebar
  ├─ file explorer
  ├─ source control panel (git)
  ├─ operations panel
  └─ (other panels)
center region
  ├─ editor tabs bar
  ├─ breadcrumb bar
  ├─ Monaco editor (#monaco)
  ├─ graph view (#graphView)
  ├─ marketplace view
  └─ operations view
terminal surface view (#terminalSurfaceView)
voice-coding view (#voiceCodingView)
bottom panel (terminal)
chat panel (agent)
status bar
```

## Surface Switcher

The top-center surface switcher routes between three modes:

| Surface | What Shows |
|---------|-----------|
| `Editor` | Full IDE: sidebar + Monaco + chat + graph |
| `Terminal` | Full-page terminal (hides sidebar/panels) |
| `Voice-Coding` | Orb + session controls (hides sidebar/panels) |

## `assets/app-workspace.js` — Global State `S`

The browser runtime holds all app state in `S`:

```javascript
S.workspaceIndex = {
  scanEpoch,
  knownFilesByPath,
  indexedFingerprintsByPath,
  pendingPaths,
  deletedPaths,
  initialIndexDone,
  backgroundIndexRunning,
  lastMode,
  discovered, indexed, skipped, deleted,  // stats
}

S.dirName          // active folder name
S.tree             // file tree
S.currentSurface   // 'editor' | 'terminal' | 'voice'
S.tabs             // open editor tabs
S.chatVisible      // boolean
S.sidebarVisible   // boolean
```

### Key Responsibilities

- Workspace open/restore/upload flow
- Diff computation and sync to `/api/assistant/workspace/sync`
- File tree scan and fingerprinting
- Surface routing (editor / terminal / voice)
- Tab management
- Action registry (`MeshActions`)
- Global state bridge (`MeshState`)
- Graph refresh event dispatch
- `.mesh` file generation after indexing

## `assets/app-graph.js` — Dependency Graph

Fetches server graph from `/api/assistant/workspace/graph`.

Falls back to local graph construction:
- Walks `S.tree`
- Filters excluded dirs
- Loads dependency-source files
- Extracts import/export/require specifiers
- Resolves relative targets
- Builds D3 nodes and edges

**Known issue:** Frontend may build a synthetic `workspaceId` from `dirName + userId` that doesn't match the worker's canonical ID. This can cause the graph to show empty state even when data exists.

Empty state distinguishes:
- No folder open
- Folder open, still indexing
- Indexed but no dependency data

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘B` | Toggle sidebar |
| `⌘\`` | Toggle terminal |
| `⌘⇧P` | Command palette |
| `⌘⇧F` | Content search |
| `⌘⇧E` | Explorer |
| `⌘⇧G` | Source control |
| `⌘,` | Settings |

## DOM IDs — Critical for `app-workspace.js`

The JS file is wired to ~50 specific DOM IDs/classes. Key ones:

```
#monaco                — Monaco editor container
#graphView             — D3 graph container
#terminalSurfaceView   — Terminal surface wrapper
#voiceCodingView       — Voice surface wrapper
#fileTree              — Explorer file list
#indexProgress         — Indexing progress indicator
#opsView               — Operations panel view
```

Any HTML refactor must preserve these selectors.

## CSS Theming

Default theme: `data-theme="light"` on `<body>`.
Toggle with `data-theme="dark"`.

Theme tokens defined via CSS custom properties in `app-workspace.css`.
