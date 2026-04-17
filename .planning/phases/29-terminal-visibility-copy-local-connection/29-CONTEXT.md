# Phase 29: Terminal — Visibility, Copy & Local Connection - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix three terminal issues: (1) dim text visibility in the xterm.js terminal, (2) text selection and copy with Cmd+C, and (3) redirect terminal sessions to the user's local machine via a local agent package. Both the bottom panel terminal and the terminal surface view are in scope.

</domain>

<decisions>
## Implementation Decisions

### TERM-01: Text Visibility
- **D-01:** The symptom is text that is too dim — the foreground color needs to be brighter
- **D-02:** Use app accent color palette for the terminal theme: foreground `#c8e6f0` (matches app's `--primary` teal), cursor `#00d4ff`
- **D-03:** Fix applies to both mount points: `#termContainer` (bottom panel) and `#terminalSurfacePrimary` (terminal surface)
- **D-04:** Keep font (JetBrains Mono 13px) and scrollback (5000 lines) unchanged
- **D-05:** The theme config is in `openTerminal()` in `assets/app-workspace.js:1439` — update the `theme` object passed to `new TermClass({...})`

### TERM-02: Copy Behavior
- **D-06:** Cmd+C smart behavior: if text is selected, copy to clipboard; if nothing is selected, send SIGINT to shell (standard VS Code/iTerm2 behavior)
- **D-07:** Enable mouse selection (click-drag) — set `mouseEvents: false` so xterm does not swallow mouse events; selection happens natively via xterm's built-in selection
- **D-08:** No custom right-click context menu — rely on Cmd+C and browser's native right-click behavior
- **D-09:** No `copyOnSelect: true` — user explicitly selects then copies

### TERM-03: Local Machine Terminal
- **D-10:** Architecture: local agent approach — user runs `npx mesh-local --token=X` once on their machine. The agent opens a persistent WebSocket connection back to the Mesh server. Mesh proxies terminal I/O through that connection.
- **D-11:** UX flow: "Connect Local Terminal" button → on first use: dialog with command pre-filled + copy button. After agent connects, terminal opens automatically. Token persisted server-side per user account (long-lived, not session-scoped).
- **D-12:** mesh:// URL protocol support: button also tries to launch via `mesh://launch-agent?token=X`. The `mesh-local` package registers the `mesh://` URL scheme automatically on first run (macOS: `defaults write`, Linux: `xdg-mime`).
- **D-13:** Agent offline state: if terminal is opened and agent is not running, show the connect dialog again with the reconnect command
- **D-14:** Agent package: lives in `packages/mesh-local/` in the repo, published separately to npm as `mesh-local`. Entry point: `npx mesh-local`
- **D-15:** Authentication: server generates a long-lived token tied to the user's account. Token shown in the connect dialog, sent by agent on WebSocket connect to authenticate.
- **D-16:** New WebSocket endpoint on the server (e.g. `/terminal-agent`) handles agent connections, distinct from the existing `/terminal` endpoint that handles browser connections

### Resize Behavior
- **D-17:** Auto-reflow on resize: wire a `ResizeObserver` to the terminal container. On resize: call `fitAddon.fit()` and send `{ type: 'resize', cols, rows }` message to server. Apply to both mount points.

### Connection Status UI
- **D-18:** Status badge in the terminal pane bar — the existing `#terminalSurfaceStatus` element already exists. Update its text to reflect state: `Connected • local`, `Disconnected`, `Waiting for agent...` with an appropriate colored dot

### Claude's Discretion
- Exact WebSocket protocol for agent ↔ server communication (message framing, heartbeat)
- Token generation mechanism (crypto.randomBytes length, storage table/field)
- Error handling and reconnect backoff in the agent
- OS-level protocol registration implementation details for Windows (if needed)
- Exact CSS for the connect dialog and status dot colors

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Terminal Backend
- `src/routes/terminal.routes.js` — Existing WebSocket terminal handler, `setupTerminalRelay()`, `resolveTerminalCwd()`, local-vs-EC2 detection at line 299. New agent proxy endpoint goes alongside this.

### Terminal Frontend
- `assets/app-workspace.js` lines 1399–1465 — `openTerminal()`, `closeTerminal()`, `toggleTerm()` — xterm.js initialization, WebSocket URL construction, theme config at line 1439
- `assets/app-workspace.js` lines 1399–1465 — `terminalMountSelector()` at line 1399 — handles both `#termContainer` and `#terminalSurfacePrimary`

### Terminal UI Structure
- `views/app.njk` lines 270–302 — Terminal surface DOM: `#terminalSurfaceView`, `#terminalSurfacePrimary`, `.terminal-pane-bar`, `#terminalSurfaceStatus`
- `views/app.njk` lines 362–378 — Bottom panel terminal: `.bp-tab[data-bp=terminal]`, `#termContainer`
- `views/app.njk` lines 498–502 — xterm.js and FitAddon CDN ESM imports

### Terminal CSS
- `assets/app-workspace.css` lines 209–225 — Terminal surface CSS (`.terminal-surface`, `.terminal-pane`, `.terminal-pane-bar`, `.terminal-surface-body`, `.term-body`)

### Auth/User Storage (for agent token)
- `secure-db.js` — DynamoDB + SQLite dual-backend; agent tokens should be stored here per user
- `src/routes/auth.routes.js` — User store CRUD, session management — model agent token generation after existing session token pattern

### Requirements
- `.planning/REQUIREMENTS.md` — TERM-01, TERM-02, TERM-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `openTerminal()` in `assets/app-workspace.js:1403` — existing terminal init; only the theme object and key handler need updating for TERM-01 and TERM-02
- `S.termWs`, `S.term`, `S.termFit`, `S.termMountSelector` — existing terminal state in the global `S` object; agent connection status extends this
- `#terminalSurfaceStatus` span in `views/app.njk:290` — already exists for status text, no new DOM needed for D-18
- `toast()` function available app-wide for notifications

### Established Patterns
- WebSocket message format: `{ type: 'output', data }`, `{ type: 'input', data }`, `{ type: 'resize', cols, rows }`, `{ type: 'exit' }` — agent must use this same protocol
- `secure-db.js` dual-backend pattern — agent token storage follows the same CRUD as session tokens
- `sanitizeEnvForShell()` at `terminal.routes.js:33` — already strips sensitive env vars before spawning shell

### Integration Points
- `src/server.js` — Where `setupTerminalRelay()` is mounted; new `/terminal-agent` WebSocket endpoint mounts here
- `src/routes/auth.routes.js` — Add `POST /api/v1/terminal/token` to generate agent tokens
- `packages/mesh-local/` — New directory, new npm package (does not exist yet)

</code_context>

<specifics>
## Specific Ideas

- The connect dialog should have the command pre-filled with the user's actual token — something like: `npx mesh-local --token=<TOKEN> --server=https://mesh.ai`
- The `mesh://` URL could encode the same: `mesh://launch-agent?token=<TOKEN>&server=https://mesh.ai`
- Status dot colors: green = connected, yellow = waiting/connecting, red = disconnected — matching the macOS traffic light convention already used in the terminal hero UI (`.dot-green`, `.dot-red`, `.dot-yellow` in `views/terminal.njk`)

</specifics>

<deferred>
## Deferred Ideas

- Multiple simultaneous agent connections (multi-machine) — out of scope for this phase
- Agent auto-update mechanism — future phase
- Windows mesh:// protocol registration — handle macOS and Linux in this phase; Windows can be a follow-up
- Terminal split panes (the grid placeholder UI already exists but the second pane is wired as a placeholder)

</deferred>

---

*Phase: 29-terminal-visibility-copy-local-connection*
*Context gathered: 2026-04-17*
