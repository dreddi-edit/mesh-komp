# Phase 29: Terminal — Visibility, Copy & Local Connection - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 29-terminal-visibility-copy-local-connection
**Areas discussed:** Text visibility (TERM-01), Copy behavior (TERM-02), Local terminal architecture (TERM-03), Resize behavior, Connection status UI, mesh:// protocol registration

---

## Text Visibility (TERM-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Text is same color as background | Foreground color override issue | |
| Terminal area is blank / zero height | Container height/flex issue | |
| Text is there but very dim | Low-contrast foreground — brighten colors | ✓ |

**User's choice:** Text is there but very dim

---

| Option | Description | Selected |
|--------|-------------|----------|
| Standard VS Code dark theme | Pure white #ffffff foreground, #0098ff cursor | |
| Warm light gray | foreground #e8e8e8, cursor #00d4ff | |
| Match the app accent color | foreground #c8e6f0 (teal palette), branded | ✓ |

**User's choice:** Match the app accent color (#c8e6f0 foreground, #00d4ff cursor)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Both mount points | Fix #termContainer and #terminalSurfacePrimary | ✓ |
| Terminal surface only | Only the full-screen view | |

**User's choice:** Both mount points

---

| Option | Description | Selected |
|--------|-------------|----------|
| No, just the text color | Keep font and scrollback unchanged | ✓ |
| Increase font size | 13px → 14px | |
| You decide | Claude handles details | |

**User's choice:** No additional changes — just text color

---

## Copy Behavior (TERM-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Cmd+C smart behavior | Copy when selected, SIGINT when nothing selected | ✓ |
| Right-click context menu only | No keyboard override | |
| Both | Smart Cmd+C + right-click menu | |

**User's choice:** Cmd+C smart behavior (standard VS Code/iTerm2 behavior)

---

| Option | Description | Selected |
|--------|-------------|----------|
| Enable mouse selection | mouseEvents:false, click-drag selects natively | ✓ |
| copyOnSelect: true | Auto-copy to clipboard on selection end | |

**User's choice:** Enable mouse selection (no auto-copy)

---

| Option | Description | Selected |
|--------|-------------|----------|
| No right-click menu | Rely on Cmd+C and browser native | ✓ |
| Custom context menu | Copy + Paste + Clear on right-click | |

**User's choice:** No custom right-click menu

---

## Local Terminal Architecture (TERM-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Fix CWD resolution | Local dev server path fix | |
| Reverse proxy / local agent | User runs agent on their machine | ✓ |
| Browser-native SSH | Web Serial / SSH.js | |

**User's notes:** "mesh is browser based only, the user should run anything on his machine, he should be able to connect to his local terminal via the web app"

---

| Option | Description | Selected |
|--------|-------------|----------|
| Local agent: npx mesh-local | WebSocket from user's machine to server | ✓ |
| SSH connection | User provides SSH credentials | |
| Defer to future phase | Architectural addition | |

**User's notes:** "can we do it that clicking on the terminal surface start that local agent immediately so it doesn't get too complicated for the user?"

---

| Option | Description | Selected |
|--------|-------------|----------|
| One-time setup + auto-connect | Show command on first open, persist token | ✓ |
| Session-based | User runs agent each session | |
| Defer TERM-03 | Too complex for this phase | |

**User's notes:** "is it possible via cookie settings or something that the user only has to do it once or offer a button (with user approval) that that command is run automatically?"

---

| Option | Description | Selected |
|--------|-------------|----------|
| Connect button + copy-ready command dialog | First session: button → dialog with npx command | |
| Both: dialog + mesh:// auto-launch | Register OS protocol handler for one-click | ✓ |

**User's choice:** Include mesh:// protocol handler for auto-launch

---

| Option | Description | Selected |
|--------|-------------|----------|
| Show connect dialog again | Detect offline, show reconnect dialog | ✓ |
| Reconnect banner inside terminal | Inline message in terminal pane | |
| Fall back to EC2 shell with warning | Open server shell with warning | |

**User's choice:** Show connect dialog again when agent is offline

---

| Option | Description | Selected |
|--------|-------------|----------|
| packages/mesh-local/ published to npm | Separate package, npx mesh-local | ✓ |
| Baked into main mesh package | CLI entry in existing package.json | |

**User's choice:** Separate npm package

---

| Option | Description | Selected |
|--------|-------------|----------|
| One-time token from user account | Long-lived, stored server-side | ✓ |
| Short-lived token per session | New command each session | |

**User's choice:** Long-lived account token

---

## Resize Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-reflow with ResizeObserver | Wire ResizeObserver → fitAddon.fit() | ✓ |
| Manual resize only | Drag handle | |

**User's choice:** Auto-reflow with ResizeObserver

---

## Connection Status UI

| Option | Description | Selected |
|--------|-------------|----------|
| Status badge in pane bar | Update #terminalSurfaceStatus text + dot | ✓ |
| Toast notifications only | Use existing toast() | |
| Both: badge + toast | Persistent + event-based | |

**User's choice:** Status badge in pane bar

---

## mesh:// Protocol Registration

| Option | Description | Selected |
|--------|-------------|----------|
| Register automatically on first run | Silent registration on macOS/Linux | ✓ |
| Prompt user to confirm | Show [Y/n] in terminal | |

**User's choice:** Automatic registration on first run

---

## Claude's Discretion

- WebSocket protocol for agent ↔ server communication
- Token generation (length, storage)
- Reconnect backoff in the agent
- Windows protocol registration (deferred)
- Connect dialog and status dot CSS details

## Deferred Ideas

- Multiple simultaneous agent connections (multi-machine)
- Agent auto-update mechanism
- Windows mesh:// protocol registration
- Terminal split panes (grid placeholder exists but not wired)
