---
status: complete
plan: 28-04
title: "Fix terminal to connect locally when server runs on localhost"
---

# Summary: 28-04 Fix Terminal to Connect Locally When Server Runs on Localhost

## What was built
- Frontend passes `folder` and `workspaceId` query params on terminal WebSocket URL
- Backend reads `clientFolder` and `clientWorkspaceId` from URL params and passes to resolveTerminalCwd
- `resolveTerminalCwd` now checks `workspace.rootPath` as priority 2 fallback even when sourceKind isn't 'local-path'
- Terminal welcome message shows "Local Terminal" or "Remote Terminal" based on environment detection (hostname, env vars, CWD path)

## key-files
### created
(none)
### modified
- assets/app-workspace.js
- src/routes/terminal.routes.js

## Deviations
None — implemented as planned.

## Self-Check: PASSED
- [x] openTerminal passes folder query param
- [x] terminal.routes.js reads clientFolder and clientWorkspaceId
- [x] resolveTerminalCwd checks rootPath without sourceKind constraint
- [x] Local/Remote terminal indicator in welcome message
