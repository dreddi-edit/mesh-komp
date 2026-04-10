# Mesh. v2 IDE — Roadmap

## Milestone: app-v2 Feature Parity + Antigravity Mashup

**Goal:** Make `app-v2.html` a master mashup of all `app.html` features plus Antigravity IDE features, with Mesh branding, clean UI organization, and full interactivity.

**Constraint:** Only `app-v2.html` may be edited. All other files are read-only.

---

### Phase 1: Editor Chrome — Tabs, Breadcrumb, Explorer Actions
**Goal:** Add editor tab bar (Welcome tab), breadcrumb navigation, and explorer header action buttons (New File, New Folder, Refresh, Collapse All, Open Folder) matching app.html.
**Status:** completed
**Scope:**
- Editor tabs bar with Welcome tab above the center area
- Breadcrumb bar below tabs
- Explorer header action icons (5 buttons from app.html)
- SCM badge count on activity bar icon

### Phase 2: Source Control Panel — Full Git UI
**Goal:** Replace placeholder SCM panel with full git UI: branch display, commit message input, commit/pull/push buttons, changes section with badge count.
**Status:** completed
**Scope:**
- Branch name display with icon
- Commit message input + commit button
- Pull/Push action buttons
- Changes section with count badge
- Init repository fallback state

### Phase 3: Chat Input & Agent Panel Upgrade
**Goal:** Add full chat input area to agent panel: textarea with send button, attach file button, mode selector (Agent/Planning/Ask), matching app.html's chat panel UX.
**Status:** completed
**Scope:**
- Chat message area (scrollable, empty state)
- Chat input row: attach button, mode selector, model selector
- Chat input box: textarea + send button
- Richer agent panel header with Mesh logo

### Phase 4: Surface Switcher — Editor / Terminal / Voice-Coding
**Goal:** Add top bar surface switcher tabs and implement Terminal Surface and Voice-Coding Surface full-page views matching app.html.
**Status:** completed
**Scope:**
- Surface switcher tabs in top bar center (Editor / Terminal / Voice-Coding)
- Terminal Surface: full-page view with Single/Grid toggle, split panes (4 slots)
- Voice-Coding Surface: intro state with orb, "Jetzt starten" button, live state with left (orb + controls) and right (viewer log) panels
- Surface switching hides sidebar/panels when in Terminal or Voice mode

### Phase 5: Context Menu, Auth Overlay & Status Bar Enrichment
**Goal:** Add right-click context menu, auth login overlay, and full status bar matching app.html.
**Status:** completed
**Scope:**
- Context menu: New File, New Folder, Copy Path, Delete (with separator lines)
- Auth overlay: login form with email/password, Mesh logo, error display
- Status bar left: Mesh Cloud, branch name (⑂ main), errors, terminal toggle button, indexing progress
- Status bar right: cursor position (Ln/Col), Spaces, UTF-8, LF, language, Mesh AI brand

### Phase 6: Resize Handles & Panel Polish
**Goal:** Add draggable resize handles between sidebar/editor/chat panels and terminal panel. Final polish pass on spacing, transitions, and interaction details.
**Status:** completed
**Scope:**
- Vertical resize handle between sidebar and editor
- Vertical resize handle between editor and agent panel
- Horizontal resize handle between editor and bottom panel
- Smooth drag behavior with min/max constraints
- Marketplace view (iframe placeholder)
- Operations panel in sidebar
- Transition animations for panel show/hide

### Phase 7: Clean Transition — app-v2 becomes app.html + Light UI Default
**Goal:** Promote app-v2.html to be the new app.html. Align DOM IDs/classes with what app-workspace.js expects, replace inline CSS/JS with external assets, set light theme as default. Delete old app.html, remove app-v2.html.
**Status:** completed
**Scope:**
- Strip inline CSS, load app-workspace.css
- Set data-theme="light" as default
- Align ~50 DOM element IDs to match app-workspace.js selectors
- Align class names to match app-workspace.css selectors
- Add missing DOM elements (monaco, graphView, opsView, file tree, index progress, etc.)
- Load all CDN libraries (d3, lottie, monaco, idb-keyval, xterm, xterm-addon-fit)
- Load all local JS (app-workspace.js, app-graph.js, _bus.js, 20 feature scripts)
- Strip inline JS (replaced by external scripts)
- Copy app-v2.html → app.html, delete app-v2.html

---

**Success Criteria:**
- Every visible feature in app.html is present in app-v2.html
- All Antigravity IDE features (from screenshot) are preserved
- All buttons are clickable with appropriate feedback
- Mesh branding throughout (logo, colors, naming)
- Clean, organized UI matching production quality
- Keyboard shortcuts work (⌘B, ⌘`, ⌘⇧P, ⌘⇧F, ⌘⇧E, ⌘⇧G, ⌘,)
