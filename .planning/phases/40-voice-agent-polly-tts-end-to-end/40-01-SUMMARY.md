---
phase: "40"
plan: "40-01"
subsystem: voice
tags: [backend, voice-agent, dead-code, polly]
requires: []
provides:
  - sendAzureEvent dead code removed from voice-agent.js
  - Polly TTS path statically verified end-to-end
affects:
  - src/core/voice-agent.js
tech-stack:
  added: []
  patterns:
    - Dead code elimination — no behavior change, only call site removal
key-files:
  created: []
  modified:
    - src/core/voice-agent.js
key-decisions:
  - Parameter options.sendAzureEvent kept for interface stability; only call sites removed
  - Verification is static code analysis — no live browser test
requirements-completed:
  - VOIC-03
duration: "3 min"
completed: "2026-04-19"
---

# Phase 40 Plan 01: Remove sendAzureEvent Dead Code + Verify Polly Path

Removed 4 `sendAzureEvent(...)` call sites from `src/core/voice-agent.js` — two in `resolveRunAction` (the action approval/rejection path) and two in the tool execution handler. These were always no-ops since `realtime.routes.js` passes `sendAzureEvent: () => {}`. The `options.sendAzureEvent` parameter assignment at line 259 is retained for interface stability.

Static verification confirms: no Azure SDK imports in voice audio path, `synthesizeSpeech` called in `streamSpeechResponse`, `MESH_VOICE_POLLY_VOICE` env var supported with `Joanna` neural default.

**Duration:** ~3 min | **Completed:** 2026-04-19
**Tasks:** 3 | **Files:** 1 modified (26 lines deleted)

## What Was Built

- **`src/core/voice-agent.js`** — Removed 2 × `sendAzureEvent({ type: 'conversation.item.create', ... })` + 2 × `sendAzureEvent({ type: 'response.create' })` call sites. No logic changes — pure dead code removal.

## Task Commits

- Tasks 40-01-01/02/03: `b3fc779` — feat(40-01): remove sendAzureEvent dead code from voice-agent.js

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Self-Check: PASSED

- `grep -c "sendAzureEvent" src/core/voice-agent.js` → 1 (parameter only) ✓
- `grep "require.*azure" src/core/voice-aws-audio.js src/routes/realtime.routes.js src/core/voice-agent.js` → 0 matches ✓
- `grep "synthesizeSpeech" src/routes/realtime.routes.js` → 2 matches (import + call) ✓
- `grep "MESH_VOICE_POLLY_VOICE" src/core/voice-aws-audio.js` → 1 match ✓
- `node --check src/core/voice-agent.js` → exit 0 ✓
