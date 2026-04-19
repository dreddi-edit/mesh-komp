---
phase: 25
plan: "01"
title: "Service Layer Creation"
status: complete
started: 2026-04-17T01:00:00Z
completed: 2026-04-17T01:20:00Z
---

# Summary: 25-01 Service Layer Creation

## What was built

Created `src/services/` with 4 domain service factories and wired them into `server.js` via `app.locals.services`.

### Services
- `workspace-service.js` — `createWorkspaceService({ core, config, logger })`: getStatus, selectWorkspace, readFile, writeFile, searchFiles, batchOps, reindex, syncFiles, getFiles, getGraph
- `assistant-service.js` — `createAssistantService({ core, config, logger })`: startRun, getRunStatus, cancelRun, chat, inlineComplete, applyProposal, getMergedCredentials
- `auth-service.js` — `createAuthService({ core, config, logger })`: login, logout, getSession, listSessions, revokeSessions, getStoredCredentials, saveStoredCredentials
- `voice-service.js` — `createVoiceService({ voiceAgent, voiceAudio, config, logger })`: buildConfig, ensureConfig, createSession, getToolDefinitions, transcribe, synthesize, runToolLoop
- `index.js` — barrel export

### server.js changes
- Requires `./services`, `./core/voice-agent`, `./core/voice-aws-audio`
- Creates all 4 service instances and attaches to `app.locals.services`
- Routes are NOT yet migrated (Wave 2)

## Key files
- `src/services/` — 5 new files (678 lines total)
- `src/server.js` — service wiring added after routes require

## Decisions
- `voice-service.js` receives `voiceAgent` and `voiceAudio` as separate deps (not via `core`) — realtime.routes requires them directly by module path, so consistency is maintained
- Login business logic moved into `auth-service.login()` including demo user handling — routes become thin HTTP adapters
- Services delegate to core, not to each other — avoids service-to-service coupling

## Self-Check: PASSED
- `node -e "require('./src/services')"` — no throw
- `grep "createWorkspaceService" src/services/workspace-service.js` — matches
- `grep "createAuthService" src/services/auth-service.js` — matches
- npm test: 3,892 pass, 22 fail (all pre-existing GSD framework failures)
