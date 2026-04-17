---
plan: 29-03
status: complete
completed: 2026-04-17
---

# Summary: Plan 29-03 — Agent Token Backend

## What was built

Server-side infrastructure for the local terminal agent: token creation/verification in `secure-db.js`, REST endpoints in `auth.routes.js`, `/terminal-agent` WebSocket in `terminal.routes.js` with proxy-to-agent logic, and wiring in `core/index.js` and `server.js`.

## Tasks completed

| Task | Description | Status |
|------|-------------|--------|
| 29-03-01 | Add createAgentToken/findAgentToken to secure-db.js | ✓ |
| 29-03-02 | Add agent token REST endpoints to auth.routes.js | ✓ |
| 29-03-03 | Add /terminal-agent WebSocket to terminal.routes.js | ✓ |
| 29-03-04 | Wire createAgentToken into core/index.js, agentConnections into app.locals | ✓ |

## Key files modified

- `secure-db.js` — createAgentToken, findAgentTokenByUserId (internal), findAgentToken
- `src/routes/auth.routes.js` — POST /api/v1/terminal/agent-token, GET /api/v1/terminal/agent-status
- `src/routes/terminal.routes.js` — wssAgent, agentConnections map, pendingBrowserSessions, proxy check
- `src/core/index.js` — createAgentToken/findAgentToken exports
- `src/server.js` — app.locals.agentConnections

## Decisions

- Module-level `agentConnections` map (not inside setupTerminalRelay) allows auth.routes.js to access it via `req.app.locals`
- `rawToken` stored in DynamoDB doc for idempotency — allows returning same token on re-call
- Agent proxy returns early (before pty spawn) when agent is connected, with fallback to EC2 shell

## Self-Check: PASSED

All acceptance criteria verified via node --check and require() tests.
