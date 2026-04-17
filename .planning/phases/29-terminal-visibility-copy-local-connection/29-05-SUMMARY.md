---
plan: 29-05
status: complete
completed: 2026-04-17
---

# Summary: Plan 29-05 — Connect Dialog UI

## What was built

Browser-side connect dialog and status flow for the local terminal agent. When the user opens the terminal without a connected agent, shows the connect dialog with the `npx mesh-local` command and a `mesh://` auto-launch link. Polls until agent connects, then auto-opens terminal. Terminal pane bar shows live connection status dot.

## Tasks completed

| Task | Description | Status |
|------|-------------|--------|
| 29-05-01 | Add connect dialog HTML to app.njk | ✓ |
| 29-05-02 | Add connect dialog CSS to app-workspace.css | ✓ |
| 29-05-03 | Add connect dialog JS logic to app-workspace.js | ✓ |

## Key files modified

- `views/app.njk` — #termAgentDialog HTML, #termStatusDot in status bar
- `assets/app-workspace.css` — dialog CSS, position:relative on terminal-surface-shell
- `assets/app-workspace.js` — fetchAgentToken, checkAgentStatus, updateTerminalStatus, showAgentConnectDialog, hideAgentConnectDialog; openTerminal made async with skipAgentCheck option

## Decisions

- `openTerminal` made `async` — safe because all callers are fire-and-forget event handlers
- Agent token cached in `S.termAgentToken` to avoid redundant POST calls on repeated dialog opens
- `skipAgentCheck: true` option on the polling callback prevents infinite recursion when auto-launching after agent connects

## Self-Check: PASSED

All acceptance criteria verified:
- 5 dialog functions defined + called: 15 total occurrences ✓
- `skipAgentCheck` appears 2 times ✓
- `termAgentPollInterval` appears 9 times ✓ (state init, multiple set/clear points)
- `/api/v1/terminal/agent-token` — 1 fetch call ✓
- `/api/v1/terminal/agent-status` — 1 fetch call ✓
- JS file loads cleanly (2230 lines) ✓
