# Phase 32: Research — Voice Agent Speech-to-Speech & Listen Behavior

**Gathered:** 2026-04-17
**Status:** Complete

## Integration Points (confirmed line numbers)

### `assets/features/voice-chat.js`

| Symbol | Line | Notes |
|--------|------|-------|
| `PALETTES` object | 206–214 | No `ready` entry — uses `PALETTES.connecting` fallback for unknown state |
| `setState(s)` | 498–527 | Labels map + surfaceState update; `ready` state needs label entry in both maps |
| `startAudio()` | 530–552 | Creates `AudioContext({ sampleRate: 24000 })`, NO `resume()` call. Connection chain: `source → analyserMic`, `source → micNode`, `speakerNode → analyserOut → audioCtx.destination`. Chain is correct. |
| `connectWebSocket()` / WS handler | 554–726 | All event handlers |
| `input_audio_buffer.speech_started` handler | 602–607 | Sets `setState('listening')` — this is the hook for `ready → listening` transition |
| `response.done` handler | 692–700 | `setTimeout 500ms` → calls `setState('listening')` — ROOT CAUSE of loop. Change to `setState('ready')` |
| `playAudioDelta(base64)` | 728–734 | No `audioCtx.resume()` guard — ROOT CAUSE of no audio. Needs guard before `postMessage`. |
| `recoverVoiceStateAfterError()` | 459–470 | Line 469: calls `setState('listening')` — should be `setState('ready')` |
| `PALETTES` fallback | 929 | `PALETTES[state] || PALETTES.connecting` — add `ready` palette entry |
| `draw()` rawEnergy logic | 922–923 | Lines 922–923 set rawEnergy for `connecting` and `idle` states — add `ready` case here |
| `voice.narration` handler | 637–643 | Frontend shows text in `aiTxEl` and optionally appends to chat |

### `src/routes/realtime.routes.js`

| Symbol | Line | Notes |
|--------|------|-------|
| `streamSpeechResponse()` | 327–358 | Polly → base64 chunk loop → `response.done`. Entirely synchronous per call — `stopAfterCurrentChunk` needs to check flag INSIDE the loop at line 350 |
| `finalizeUtterance()` | 360–461 | Line 407: empty transcription → `streamSpeechResponse('I did not catch that...')` — REMOVE this and replace with `voice.state.empty_transcription` event |
| Dead zone injection point | After line 452 (`await streamSpeechResponse(replyText)`) | This is AFTER Polly finishes — correct place to set `postResponseDeadZoneUntil = Date.now() + 1500` |
| `handleAudioAppend()` | 463–497 | Line 464: existing early returns — add dead zone check here: `if (Date.now() < postResponseDeadZoneUntil) return;` |
| `speechState.processing` flag | 464 | Already prevents re-entry during active processing |

## Root Cause Confirmations

### Bug 1: No audio during speech-to-speech
- `startAudio()` (line 530) creates `AudioContext({ sampleRate: 24000 })` with no `await audioCtx.resume()` call.
- Browser spec: AudioContext created outside a direct user gesture activation (or where the activation context has been consumed) starts in `suspended` state.
- `speakerNode.port.postMessage({ type: 'audio-data', ... })` delivers PCM to the AudioWorklet, but the AudioContext is suspended so the worklet output never reaches `audioCtx.destination`.
- **Fix:** `await audioCtx.resume()` immediately after `new AudioContext(...)` in `startAudio()`. Also add defensive check in `playAudioDelta()` before postMessage: if `audioCtx.state !== 'running'` call `audioCtx.resume()` (no await needed — fire-and-forget guard).

### Bug 2: "Didn't catch that" spam loop
- `response.done` handler (line 692) transitions to `setState('listening')` after 500ms.
- With `state === 'listening'`, the mic continues forwarding chunks immediately.
- Any ambient noise above `SPEECH_RMS_THRESHOLD` (0.012 — very low threshold) triggers `input_audio_buffer.speech_started` → VAD → `finalizeUtterance`.
- Empty transcription at line 401 calls `streamSpeechResponse('I did not catch that...')` → another `response.done` → repeat.
- **Fix:** Two-part: (1) backend dead zone `postResponseDeadZoneUntil` — 1500ms after response delivered, `handleAudioAppend` returns early; (2) frontend `response.done` transitions to `ready` not `listening`; (3) remove `streamSpeechResponse` from empty-transcription path, send `voice.state.empty_transcription` event instead.

## State Machine Change Summary

| From | To | Trigger | Notes |
|------|----|---------|-------|
| `speaking` | `ready` | `response.done` after 500ms (was `listening`) | New behavior |
| `ready` | `listening` | `input_audio_buffer.speech_started` (was already this, line 602) | No change needed to handler |
| `ready` | n/a | ambient noise in dead zone | Dead zone prevents VAD from firing |

## Implementation Notes per Decision

- **D-01 (confirmed):** AudioContext suspended — no `resume()` call in `startAudio()`.
- **D-02 (confirmed):** Fix is `await audioCtx.resume()` in `startAudio()` line ~531, plus defensive guard in `playAudioDelta()` line ~730.
- **D-03 (confirmed):** Connection chain `speakerNode → analyserOut → audioCtx.destination` (lines 550–551) is correct. PCM16→Float32 conversion (line 732) divides by 0x8000 for negatives and 0x7FFF for positives — correct for signed PCM. Polly `pcm` format at 24000Hz matches `AudioContext({ sampleRate: 24000 })`.
- **D-04 (confirmed):** Fix location is `startAudio()` line 531 and `playAudioDelta()` line 730.
- **D-05 (confirmed):** `handleAudioAppend()` early-return at line 464 is the right place for dead zone check.
- **D-06 (confirmed):** `setState()` at line 498 — add `ready: 'Ready'` to both label maps (orbLabel and surfaceState). Add `ready` to `PALETTES` at line 206.
- **D-07 (confirmed):** `response.done` handler at line 692 changes `setState('listening')` → `setState('ready')`. `speech_started` handler at line 602 already calls `setState('listening')` — no change needed.
- **D-08 (confirmed):** Empty transcription at lines 401–408 — remove `voice.narration` send and `streamSpeechResponse` call, replace with `sendClientEvent({ type: 'voice.state.empty_transcription' })`. Frontend `voice.narration` handler (line 637) is separate — add new `voice.state.empty_transcription` case that briefly flashes orb label.
- **D-09 (confirmed):** `postResponseDeadZoneUntil` set after `streamSpeechResponse(replyText)` call at line 452 (inside `finalizeUtterance` try block). `handleAudioAppend` dead zone check at line 464.
- **D-10 (confirmed):** `stopAfterCurrentChunk` flag — checked inside `streamSpeechResponse` loop at line 350. Frontend sends a `voice.stop_playback` WS message; backend checks flag at each chunk.
- **D-11 (confirmed):** Canvas `draw()` function at line 922 has state-specific `rawEnergy` overrides. Add `ready` case: `rawEnergy = 0.06 + Math.sin(t * 0.9) * 0.025` (slower than idle's 1.4, dimmer than connecting's 0.15).

## Surprises / Gotchas

1. **`recoverVoiceStateAfterError()`** (line 459) also calls `setState('listening')` on the else branch (line 469). This must also be changed to `setState('ready')` — otherwise error recovery bypasses the new state machine.
2. **`voice.run.completed`** handler (line 671): `if (state !== 'speaking') setState('listening')` — this must also become `setState('ready')`.
3. **`state === 'listening'` mic gate** in `startAudio()` (line 542): `(mode === 'vad' || state === 'listening')` — the `mode === 'vad'` arm already handles VAD mode. The `ready` state should still forward mic chunks (so VAD can detect real speech), so NO change needed here — the dead zone check in `handleAudioAppend` is the gating mechanism.
4. **`postResponseDeadZoneUntil` scope**: Must be scoped INSIDE the `handleSession()` closure (not module-level) since multiple sessions could theoretically exist.
5. **D-10 `stopAfterCurrentChunk`**: Polly synthesis happens in one shot (`synthesizeSpeech` returns a full Buffer at line 341). The "chunk loop" at line 349 is just breaking the already-synthesized PCM buffer into delta segments. So `stopAfterCurrentChunk` is purely a frontend concern — the backend can't stop mid-sentence since the audio is already generated. The "finish sentence" behavior is automatic because Polly returns a complete sentence. Frontend should just let the `speakerNode` drain. The `stopAfterCurrentChunk` flag should live on the frontend and prevent processing of new `response.output_audio.delta` events (skip postMessage) — OR simply stop the stream by sending a session abort from frontend. Simplest: frontend mute button sets a `muteSpeaker` flag; `playAudioDelta` returns early if `muteSpeaker` is true; the existing Polly chunks still arrive but are silently dropped. Natural "finish sentence" requires knowing sentence boundaries which Polly doesn't signal — revisit: the current behavior sends all audio already, so the only "cut" that can happen is frontend stopping playback of incoming deltas. The decision says "finish current Polly chunk" — in this architecture, each `streamSpeechResponse` call is already one sentence/chunk. So cutting BETWEEN responses (not within) is the right scope. A frontend `muteSpeaker` flag on the orb close/stop button that prevents future `playAudioDelta` calls is sufficient — the current response finishes, the next one is silenced.

## Plan Breakdown Recommendation

**3 plans:**

1. **32-01: Audio playback fix** — `startAudio()` resume + `playAudioDelta()` guard. Frontend only. Smallest, lowest risk. Requirements: VOIC-01 (D-01 through D-04).

2. **32-02: Listen loop fix + ready state** — Backend dead zone + empty-transcription visual-only + frontend `ready` state + state machine updates. Backend + frontend. Requirements: VOIC-02 (D-05 through D-09, D-11).

3. **32-03: Stop/mute during playback** — Frontend `muteSpeaker` flag on stop button + orb close button. Frontend only. Requirements: VOIC-02 (D-10).

Dependencies: 32-01 and 32-02 are independent (different bugs). 32-03 depends on 32-02 state machine being in place (orb `ready` state used as the post-stop landing state).
