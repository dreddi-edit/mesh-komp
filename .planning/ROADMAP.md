# Mesh. v2.1 — App Functionality & UX Fix Sweep Roadmap

## Milestone: v2.1 App Functionality & UX Fix Sweep

**Goal:** Fix all broken and non-functional surfaces in the Mesh IDE so the app works end-to-end — settings, terminal, editor, UI controls, voice agent, analytics, graph, and .mesh output.

**Phases:** 7 (Phase 28–34, continuing from v2.0)
**Requirements:** 21 mapped

---

### Phase 28: Settings — UI, Navigation & Persistence

**Goal:** Restyle settings pages to match the app's design language, fix back-navigation that passes through the login screen, and make all setting changes actually persist.

**Status:** planned
**Depends on:** None (first phase)
**Requirements:** SETT-01, SETT-02, SETT-03
**UI hint:** yes

**Success Criteria:**
1. Settings pages share the same color palette, typography, and component style as `app.njk` and `index.njk`
2. Clicking "Back to Workspace" from any settings page navigates directly to the workspace — no login redirect
3. Changing a setting (e.g., theme, model, API key) and refreshing the page shows the saved value
4. Settings navigation sidebar highlights the active section correctly
5. No layout shift or broken elements when switching between settings sub-pages

---

### Phase 29: Terminal — Visibility, Copy & Local Connection

**Goal:** Make terminal text visible, enable text selection/copy, and redirect the terminal session to the user's local machine instead of the EC2 instance.

**Status:** planned
**Depends on:** None
**Requirements:** TERM-01, TERM-02, TERM-03
**UI hint:** yes

**Success Criteria:**
1. Terminal text is rendered in a light color against the dark background with clear contrast
2. User can click-drag to select text in the terminal and Cmd+C / right-click → Copy works
3. Opening a terminal session spawns a shell on the local machine (shows local hostname, not ec2-user@...)
4. Previously typed commands and output remain visible after scrolling back
5. Terminal resize correctly reflows content when the panel is resized

---

### Phase 30: Editor — Monaco Functionality & Welcome Screen

**Goal:** Restore full Monaco editor functionality with syntax highlighting and proper indentation, add a welcome screen showing recent workspaces, and remove the false "Indexing..." indicator.

**Status:** complete
**Depends on:** None
**Requirements:** EDIT-01, EDIT-02, EDIT-03
**UI hint:** yes

**Success Criteria:**
1. Opening a code file in the editor shows syntax-highlighted, properly indented code matching VS Code's appearance
2. Editor gutter (line numbers), scrollbars, and minimap render correctly
3. When the app loads with no file open, the editor area shows a welcome screen listing recent workspaces and an "Open Folder" button
4. Status bar does not display "Indexing..." unless a folder is actually being indexed
5. Opening a file from the welcome screen correctly loads it in the editor with full highlighting

---

### Phase 31: UI Elements — Broken Controls & Duplicate Components

**Goal:** Fix all six broken UI element issues: the non-functional pause button, agent chat close gap, dead agent manager button, incorrect context window display, and two sets of duplicate controls.

**Status:** planned
**Depends on:** None
**Requirements:** UIEL-01, UIEL-02, UIEL-03, UIEL-04, UIEL-05, UIEL-06
**UI hint:** yes

**Success Criteria:**
1. Pause button (top right) pauses the running agent operation and shows a visual stopped/paused state
2. Closing the agent chat panel collapses it cleanly — no empty gap remains in the layout
3. "Open Agent Manager" button opens the agent manager panel/modal
4. Context window indicator shows the model's actual context window size (e.g., 200k for Claude 3.5 Sonnet), not max output tokens
5. Model selection dropdown appears exactly once in the UI
6. Agent/planning mode options (Agent / Planning / etc.) appear exactly once above the chat input

---

### Phase 32: Voice Agent — Speech-to-Speech & Listen Behavior

**Goal:** Wire up the voice agent to actually respond with synthesized speech (AWS Polly), and fix the "keeps listening" loop that spams the user when silence follows an answer.

**Status:** planned
**Depends on:** None
**Requirements:** VOIC-01, VOIC-02
**UI hint:** yes

**Success Criteria:**
1. After the user speaks and the agent processes a response, the response is played back as audio through the browser
2. The voice agent automatically stops listening after delivering a response and waits for a deliberate user action to re-engage
3. No "sorry I didn't get that" messages appear unless the user explicitly tried to speak and was not heard
4. Visual indicator correctly reflects states: idle → listening → processing → speaking → idle
5. Users can mute/unmute or end the voice session without the agent re-activating

---

### Phase 33: Analytics & Graph — Real Data & Visual Consistency

**Goal:** Replace the nonsensical local server log entries in the Operations & Compression Analytics view with real data, and restyle the Mesh graph to match the app's visual design.

**Status:** planned
**Depends on:** None
**Requirements:** ANLY-01, ANLY-02, GRPH-01
**UI hint:** yes

**Success Criteria:**
1. Operations & Compression Analytics shows real compression ratios, file sizes, and operation timings from the current workspace
2. No local server log entries or server-internal debug lines appear in the analytics view
3. Mesh graph nodes and edges use the same color palette (CSS custom properties) as the rest of the app
4. Graph typography (font family, size, weight) matches the app design system
5. Graph background, border, and panel chrome are visually consistent with adjacent panels

---

### Phase 34: .mesh Folder — Improved Auto-Generated Files

**Goal:** Drastically improve the quality and structure of auto-generated .mesh folder files so they are readable, useful, and well-organized.

**Status:** planned
**Depends on:** None
**Requirements:** MESH-01
**UI hint:** no

**Success Criteria:**
1. .mesh folder files use a consistent, human-readable format (Markdown or structured JSON, not raw dumps)
2. Each auto-generated file has a clear header describing its purpose and when it was generated
3. File content is semantically organized — not a flat concatenation of raw data
4. Sensitive data (API keys, tokens) is never written to .mesh files
5. Stale .mesh files are updated or purged when the workspace context changes significantly

---

## Traceability

| Requirement | Phase | Category |
|-------------|-------|----------|
| SETT-01 | Phase 28 | Settings |
| SETT-02 | Phase 28 | Settings |
| SETT-03 | Phase 28 | Settings |
| TERM-01 | Phase 29 | Terminal |
| TERM-02 | Phase 29 | Terminal |
| TERM-03 | Phase 29 | Terminal |
| EDIT-01 | Phase 30 | Editor |
| EDIT-02 | Phase 30 | Editor |
| EDIT-03 | Phase 30 | Editor |
| UIEL-01 | Phase 31 | UI Elements |
| UIEL-02 | Phase 31 | UI Elements |
| UIEL-03 | Phase 31 | UI Elements |
| UIEL-04 | Phase 31 | UI Elements |
| UIEL-05 | Phase 31 | UI Elements |
| UIEL-06 | Phase 31 | UI Elements |
| VOIC-01 | Phase 32 | Voice Agent |
| VOIC-02 | Phase 32 | Voice Agent |
| ANLY-01 | Phase 33 | Analytics |
| ANLY-02 | Phase 33 | Analytics |
| GRPH-01 | Phase 33 | Graph |
| MESH-01 | Phase 34 | .mesh Folder |

**Coverage:** 21/21 requirements mapped ✓

---

**Milestone Success Criteria:**
- All settings pages are visually consistent with the app and changes persist across sessions
- Terminal connects to the local machine with visible text and working copy
- Monaco editor shows syntax-highlighted code; no false "Indexing..." state
- All six broken UI elements are functional and no duplicates appear
- Voice agent delivers audio responses and does not spam silence errors
- Analytics shows real workspace data; graph matches app visual design
- .mesh auto-generated files are readable and well-structured
