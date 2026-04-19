# Phase 40: Voice Agent — Polly TTS End-to-End - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Confirm and finalize that voice TTS uses Amazon Polly neural voices end-to-end. The Polly path was wired in Phase 32 — this phase removes remaining Azure-artifact dead code (`sendAzureEvent` call sites in `voice-agent.js`) and verifies no Azure SDK calls remain in the audio path. Verification is static code analysis only (no live browser test required).

Does NOT change the LLM pipeline, STT path, or voice agent reasoning. Only the dead code cleanup and code-path verification are in scope.

</domain>

<decisions>
## Implementation Decisions

### Dead Code Removal
- **D-01:** Remove the 4 `sendAzureEvent(...)` call sites in `voice-agent.js` (lines 537, 552, 794, 802). These are no-ops — `realtime.routes.js` passes `sendAzureEvent: () => {}` and the calls have no functional effect.
- **D-02:** Keep the parameter acceptance (`options.sendAzureEvent`) and the no-op assignment at line 259 of `voice-agent.js`. The interface stays stable — callers that pass `sendAzureEvent` don't break.
- **D-03:** `buildSessionUpdate` and its `realtimeProfile.voice` field are out of scope for this phase — they are exported but never called from the AWS path and pose no functional risk. Leave for a future refactor.

### Verification Approach
- **D-04:** Phase 40 verification is static code analysis only — no live browser test required.
  - Confirm `synthesizeSpeech` is called in `streamSpeechResponse` (already confirmed: `realtime.routes.js:342`).
  - Confirm no Azure SDK `require()` or `import` in the voice audio path (`voice-aws-audio.js`, `realtime.routes.js`, `voice-agent.js`).
  - Confirm `sendAzureEvent` call sites are removed from `voice-agent.js`.
  - Confirm `MESH_VOICE_POLLY_VOICE` env var is read and defaults to `'Joanna'` neural (already confirmed: `voice-aws-audio.js:buildAwsVoiceConfig`).

### Claude's Discretion
- Whether to add a comment at the remaining `sendAzureEvent` parameter line (line 259) noting it is kept for interface stability.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Voice Backend
- `src/core/voice-aws-audio.js` — `buildAwsVoiceConfig()`, `synthesizeSpeech()`, `transcribePcm16Buffer()` — the full AWS TTS/STT implementation
- `src/routes/realtime.routes.js` — `streamSpeechResponse()` calls `synthesizeSpeech`; `sendAzureEvent: () => {}` no-op at line 282
- `src/core/voice-agent.js` — 4 `sendAzureEvent(...)` call sites to remove: lines 537, 552, 794, 802; parameter kept at line 259

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `buildAwsVoiceConfig(process.env)` in `realtime.routes.js:257` — reads `MESH_VOICE_POLLY_VOICE`, defaults to `'Joanna'` neural engine
- `streamSpeechResponse(replyText)` in `realtime.routes.js:328` — already calls `synthesizeSpeech`; Polly path is live

### Established Patterns
- `sendAzureEvent` call sites in `voice-agent.js` follow the pattern: `sendAzureEvent({ type: '...', ... })` — simple call removals, no branching logic changes needed
- Removal is safe: the no-op at line 259 means these calls already have zero effect; removing them changes no behavior

### Integration Points
- Only `voice-agent.js` changes (4 line removals) — `realtime.routes.js` and `voice-aws-audio.js` are unchanged

</code_context>

<specifics>
## Specific Ideas

- Phase 40 is effectively a cleanup + confirmation phase. The implementation work is 4 dead code removals in `voice-agent.js`. The verification work is grepping the audio path for Azure SDK references.
- VOIC-03 success criteria: "no Azure SDK calls in the audio path" — satisfied by confirming `voice-aws-audio.js` uses only `@aws-sdk/*` and `realtime.routes.js` has no Azure imports.

</specifics>

<deferred>
## Deferred Ideas

- Full `buildSessionUpdate` / `realtimeProfile` cleanup — this function is exported from `voice-agent.js` but never called from the AWS path. Belongs in a future refactor phase.
- Live browser end-to-end Polly voice test — user confirmed static code verification is sufficient for this phase.

</deferred>

---

*Phase: 40-voice-agent-polly-tts-end-to-end*
*Context gathered: 2026-04-19*
