# Phase 40: Voice Agent — Polly TTS End-to-End - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 40-voice-agent-polly-tts-end-to-end
**Areas discussed:** Dead code removal scope, Verification approach

---

## Dead Code Removal Scope

| Option | Description | Selected |
|--------|-------------|----------|
| sendAzureEvent calls only | Remove 4 call sites in voice-agent.js, keep parameter + no-op assignment for interface stability | ✓ |
| Full Azure artifact removal | Remove calls + parameter + buildSessionUpdate realtimeProfile.voice field | |
| No removal — verify only | Skip cleanup, phase is pure Polly confirmation | |

**User's choice:** sendAzureEvent calls only
**Notes:** Keep `options.sendAzureEvent` parameter and the no-op assignment at line 259 for interface stability. `buildSessionUpdate`/`realtimeProfile` cleanup deferred to future refactor.

---

## Verification Approach

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — browser test required | Requires live voice in browser before phase is done | |
| No — code path verification only | Static grep confirms Polly path wired, no Azure SDK in audio path | ✓ |

**User's choice:** Code path verification only
**Notes:** Polly was wired in Phase 32 and is already live. Static verification (no Azure imports, synthesizeSpeech called, MESH_VOICE_POLLY_VOICE defaults to Joanna) is sufficient.

---

## Claude's Discretion

- Whether to add a comment at the remaining `sendAzureEvent` no-op parameter line noting it is kept for interface stability.

## Deferred Ideas

- `buildSessionUpdate` / `realtimeProfile` full cleanup — future refactor phase
- Live browser end-to-end Polly voice test — deferred per user decision
