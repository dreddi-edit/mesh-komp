# Phase 32: Voice Agent — Speech-to-Speech & Listen Behavior — Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the two broken voice agent behaviors:
1. Audio playback: Polly synthesizes speech but no sound reaches the browser speaker (AudioContext likely suspended).
2. Listen loop: after a response, the session auto-resumes VAD and fires "I did not catch that" on silence repeatedly.

This phase does NOT add new voice capabilities, change the LLM pipeline, or redesign the orb UI. It fixes two specific bugs and adjusts one UX behavior (post-response listen mode).

</domain>

<decisions>
## Implementation Decisions

### VOIC-01: Audio Playback Fix

- **D-01:** Confirmed symptom: transcript text appears in orb/chat, but no audio plays. The `response.output_audio.delta` events arrive (confirmed by transcript showing up), but the AudioWorklet speaker node produces silence.
- **D-02:** Most likely root cause: `AudioContext` auto-suspend. Browsers suspend `AudioContext` even when created inside a user gesture handler (click) if the context was created before the interaction completes. The fix is `audioCtx.resume()` called immediately before the first delta is processed (or at `startAudio` time, inside the existing user-gesture path).
- **D-03:** Secondary checks the researcher/planner must verify: (a) `speakerNode.connect(analyserOut)` → `analyserOut.connect(audioCtx.destination)` chain exists and nothing is disconnected before playback; (b) `playAudioDelta` conversion (PCM16 → Float32) math is correct for Polly's signed PCM output; (c) Polly `OutputFormat: 'pcm'` at `SampleRate: '24000'` matches the browser `AudioContext({ sampleRate: 24000 })` sample rate — no resampling needed.
- **D-04:** Fix location: `assets/features/voice-chat.js`, `startAudio()` function — add `await audioCtx.resume()` after creating the context, and call `audioCtx.resume()` defensively inside `playAudioDelta()` if `audioCtx.state !== 'running'`.

### VOIC-02: Listen Loop Fix

- **D-05:** Post-response listen mode: **smart cooldown, not push-to-talk**. After `response.done`, the session enters a quiet "ready" state where the mic is technically active but audio input is ignored until the user produces meaningful speech (above RMS threshold) — not just silence or ambient noise triggering VAD. In practice: add a dead zone after response.done (≥1.5s) during which `handleAudioAppend` discards all chunks, then only auto-advance from "ready" to "listening" when a real speech onset is detected.
- **D-06:** Orb visual state mapping (existing `setState` is already the right hook):
  - `idle` → dark/dim orb (no session)
  - `connecting` → existing connecting state
  - `listening` → active mic pulse (only when real speech is ongoing, not ambient)
  - `thinking` → existing thinking/processing state
  - `speaking` → existing speaking animation
  - **NEW `ready` state** → dim pulse (slower, lower energy than `listening`) — session alive, waiting for deliberate speech. This is what sits between turns.
- **D-07:** `ready` state wiring: after `response.done` fires (and after any run/approval states resolve), transition to `ready` instead of `listening`. From `ready`, advance to `listening` only when `input_audio_buffer.speech_started` fires (real speech onset detected by VAD above threshold).
- **D-08:** "Didn't catch that" behavior: **visual-only indicator** — no spoken response, no chat message. When transcription returns empty string, the orb briefly shows a subtle status (e.g., label flashes "?") and resets to `ready`. The existing `voice.narration` + `streamSpeechResponse` call for empty transcription is removed.
- **D-09:** Silence dead zone implementation: module-level `let postResponseDeadZoneUntil = 0` in `realtime.routes.js`. Set to `Date.now() + 1500` inside `finalizeUtterance` just before streaming the response. In `handleAudioAppend`, return early if `Date.now() < postResponseDeadZoneUntil`. This is backend-side and prevents transcription from even being attempted on noise during cooldown.
- **D-10:** Stop/mute during playback: **finish current Polly chunk (sentence boundary)**. When user taps mute/stop, set a `stopAfterCurrentChunk` flag. The `streamSpeechResponse` loop checks this flag and stops sending further `response.output_audio.delta` chunks after completing the current one. The speaker worklet drains its queue naturally. This gives a natural sentence-end cutoff rather than mid-word truncation.
- **D-11:** Orb "ready" state visual: slower breathing animation — `rawEnergy` target ≈ 0.06 (vs 0.25+ for listening). Orb label shows "READY" (vs "LISTENING"). The existing `setState` + canvas animation loop in `voice-chat.js` already branches on state — add a new `ready` branch.

### Claude's Discretion
- Exact dead zone duration (1.5s is the starting point — researcher should validate against typical Polly chunk delivery time).
- Whether to add `audioCtx.resume()` only in `startAudio` or also defensively in `playAudioDelta` — both if in doubt.
- Exact orb "ready" pulse speed/brightness — match the spirit of "calm but alive" without being distracting.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Voice Frontend
- `assets/features/voice-chat.js` — All frontend voice logic: state machine (`setState`), WebSocket message handling, `startAudio()`, `playAudioDelta()`, orb animation loop
- `assets/features/voice-audio-worklet.js` — `SpeakerProcessor` and `MicProcessor` AudioWorklet classes

### Voice Backend
- `src/routes/realtime.routes.js` — WebSocket session handler: `handleSession()`, `streamSpeechResponse()`, `finalizeUtterance()`, `handleAudioAppend()`, VAD constants
- `src/core/voice-aws-audio.js` — `synthesizeSpeech()` (Polly), `transcribePcm16Buffer()`, `runAwsVoiceToolLoop()`
- `src/core/voice-agent.js` — `createVoiceAgentSession()`, `buildVoiceInstructions()`, tool definitions

### Config
- `src/config/index.js` lines 110–113 — Voice VAD constants: `SPEECH_RMS_THRESHOLD`, `SPEECH_SILENCE_MS`, `MIN_UTTERANCE_MS` (all env-configurable)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `setState(s)` in `voice-chat.js:498` — already the single state setter; add `'ready'` as a new valid state value and branch the canvas animation on it
- `playAudioDelta(base64)` in `voice-chat.js:728` — PCM16 → Float32 conversion + speakerNode postMessage; add `audioCtx.resume()` guard here
- `recoverVoiceStateAfterError()` in `voice-chat.js:459` — calls `setState('listening')` after recovery; update to use `setState('ready')` in the non-error post-response path
- `finalizeUtterance()` in `realtime.routes.js:360` — the right place to set the backend dead zone after response delivery
- `handleAudioAppend()` in `realtime.routes.js:463` — early-return point for the dead zone check

### Established Patterns
- State transitions use `setState()` which updates the module-level `state` var and the orb label; adding a new state is additive, not breaking
- Canvas animation loop in `voice-chat.js` branches on `state === 'speaking'` for analyser selection (line ~910) — add `ready` as a third case with reduced energy target
- Backend uses `sendClientEvent()` for all WS messages to the browser — add a `voice.state.ready` event to trigger frontend transition if needed, or infer from `response.done` timing

### Integration Points
- `response.done` handler in `voice-chat.js` (~line 692) — currently transitions to `listening` after 500ms; change to transition to `ready`
- `input_audio_buffer.speech_started` handler (line 602) — advance from `ready` → `listening` here
- `voice.narration` empty-transcription path in `realtime.routes.js:401–408` — replace with visual-only `voice.state.empty_transcription` event or omit the server send entirely

</code_context>

<specifics>
## Specific Ideas

- "Smart cooldown" — not push-to-talk, but don't appear active on background noise. The `ready` state sits between turns: mic listens but the VAD dead zone + visual state ensure the user doesn't feel watched.
- Finish-sentence on stop: user prefers the current Polly chunk completes naturally rather than cutting mid-word.
- Visual state: new dim-pulse `ready` orb state between turns so user sees "session alive, waiting for you" vs the active listening pulse.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 32-voice-agent-speech-to-speech-listen-behavior*
*Context gathered: 2026-04-17*
