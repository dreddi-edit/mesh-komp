# Phase 32: Voice Agent — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 32 — Voice Agent — Speech-to-Speech & Listen Behavior
**Areas discussed:** Speech-to-speech audio bug, Post-response listen mode, Silence spam, Stop behavior, Visual states

---

## Speech-to-Speech Audio Bug

| Option | Description | Selected |
|--------|-------------|----------|
| No audio plays at all | Text appears, no sound — AudioContext or speaker path broken | ✓ |
| Audio plays but garbled | PCM format or sample rate mismatch | |
| Works sometimes | Race condition or state issue | |
| Never tested | Need to investigate | |

**User's choice:** No audio plays at all — transcript appears in orb/chat but no sound.
**Notes:** Confirms delta events arrive but AudioWorklet speaker path is silent. Likely AudioContext auto-suspend.

---

## Post-Response Listen Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Require tap to re-listen | Push-to-talk after each response | |
| Smart cooldown (recommended) | Dead zone + only activate on real speech onset | ✓ |
| User-configurable toggle | Auto-listen vs push-to-talk switch in session | |

**User's choice:** Smart cooldown — don't appear active on background noise, only show listening state when real speech is detected.
**Notes:** "idk like a smart cooldown only 'appear' active when real speech input is given like dont listen to background noise"

---

## Silence Spam ("Didn't catch that")

| Option | Description | Selected |
|--------|-------------|----------|
| Completely silent | No message, no audio, no orb change on empty transcription | |
| Visual indicator only | Orb flickers/pulses, no spoken/chat message | ✓ |
| Single spoken retry | Say "sorry I didn't catch that" once, then go quiet | |

**User's choice:** Visual indicator only — brief orb cue, no spoken response.

---

## Stop During Playback + Visual States (combined)

| Option | Description | Selected |
|--------|-------------|----------|
| Cut immediately + add waiting state | Audio stops mid-word; new dim orb state between turns | |
| Cut immediately + reuse idle state | Audio cuts instantly; no new state | |
| Finish sentence + add waiting state | Complete current Polly chunk; new dim 'ready' orb state | ✓ |

**User's choice:** Finish sentence + add waiting state — natural cutoff, distinct "ready" orb state between turns.

---

## Claude's Discretion

- Exact dead zone duration (1.5s baseline)
- Whether `audioCtx.resume()` guard goes only in `startAudio` or also defensively in `playAudioDelta`
- Exact orb "ready" pulse speed and brightness

## Deferred Ideas

None.
