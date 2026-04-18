---
phase: "32"
plan: "32-02"
subsystem: backend-voice + frontend-voice
tags: [vad, dead-zone, ready-state, state-machine, ux]
requires: []
provides: [listen-loop-fix, ready-state]
affects: [src/routes/realtime.routes.js, assets/features/voice-chat.js]
tech-stack:
  added: []
  patterns: [dead-zone-timestamp, state-machine-extension, visual-only-feedback]
key-files:
  created: []
  modified:
    - src/routes/realtime.routes.js
    - assets/features/voice-chat.js
key-decisions:
  - postResponseDeadZoneUntil scoped inside handleSession closure — correct for per-session isolation
  - Dead zone set after streamSpeechResponse AND after empty-transcription — covers both paths
  - voice.state.empty_transcription replaces spoken 'I did not catch that' entirely
  - ready palette is dim blue (48,90,160) — calmer than connecting, distinct from idle
  - ready rawEnergy uses sin(t*0.9) — slower breathing than idle's 1.4, signals 'alive but waiting'
requirements-completed: [VOIC-02]
duration: "< 5 min"
completed: "2026-04-18"
---

# Phase 32 Plan 02: Listen Loop Fix + Ready State — Summary

Post-response dead zone (1500ms) added to backend to gate audio input after response delivery. New `ready` orb state added frontend with dim-blue breathing animation. All `setState('listening')` post-response calls updated to `setState('ready')`. Empty transcription now sends visual-only `voice.state.empty_transcription` event instead of spoken response.

**Duration:** < 5 min | **Tasks:** 11 | **Files:** 2

## Tasks Completed

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Add `postResponseDeadZoneUntil` variable in `handleSession()` | ✓ | e6c15c4 |
| 2 | Set dead zone after `streamSpeechResponse(replyText)` | ✓ | e6c15c4 |
| 3 | Apply dead zone check in `handleAudioAppend()` | ✓ | e6c15c4 |
| 4 | Replace empty-transcription spoken response with visual event | ✓ | e6c15c4 |
| 5 | Add `ready` palette to `PALETTES` | ✓ | ee28682 |
| 6 | Add `ready` label to `setState()` | ✓ | ee28682 |
| 7 | Add `ready` rawEnergy in canvas draw loop | ✓ | ee28682 |
| 8 | Change `response.done` to `setState('ready')` | ✓ | ee28682 |
| 9 | Update `recoverVoiceStateAfterError()` to `setState('ready')` | ✓ | ee28682 |
| 10 | Update `voice.run.completed` to `setState('ready')` | ✓ | ee28682 |
| 11 | Handle `voice.state.empty_transcription` with orb flash | ✓ | ee28682 |

## What Was Built

- Backend: `postResponseDeadZoneUntil = Date.now() + 1500` set after real response and after empty transcription — `handleAudioAppend()` returns early during dead zone
- Backend: Empty transcription path now sends `{ type: 'voice.state.empty_transcription' }` and applies dead zone — no Polly synthesis, no "I didn't catch that"
- Frontend: `PALETTES.ready` dim blue palette; `setState('ready')` shows "Ready" / "Waiting for you" labels
- Frontend: Canvas `draw()` has `ready` state with `rawEnergy = 0.06 + Math.sin(t * 0.9) * 0.025` — slow calm breathing
- Frontend: 3 post-response transitions updated: `response.done`, `recoverVoiceStateAfterError()`, `voice.run.completed`
- Frontend: `voice.state.empty_transcription` flashes orb label `?` for 600ms then restores

## Deviations from Plan

None — all 11 tasks executed as planned.

## Self-Check: PASSED
