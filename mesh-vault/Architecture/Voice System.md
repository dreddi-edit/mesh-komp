---
tags: [architecture]
---

# Voice System

## Architecture

The voice system is built as three sequential AWS steps — **not** a single realtime websocket contract (the previous Azure realtime approach was too unstable).

```
Browser mic
  │ PCM audio stream
  ▼
/api/realtime (WebSocket)
  │
  ├─► Amazon Transcribe Streaming (STT)
  │
  ├─► AWS Bedrock text tool loop (orchestration)
  │       └─► Voice Agent tools (read, edit, git, delegate...)
  │
  └─► Amazon Polly (TTS → reply audio → browser)
```

## Key Files

| File | Role |
|------|------|
| `src/routes/realtime.routes.js` | WebSocket session handler, VAD, STT, TTS coordination |
| `src/core/voice-agent.js` | Voice tool definitions, task delegation, approval flow |
| `src/core/voice-aws-audio.js` | Amazon Transcribe + Polly integration, text tool loop |
| `assets/features/voice-chat.js` | Browser UI, orb, mic capture, WebSocket client |
| `assets/features/voice-audio-worklet.js` | Audio worklet for mic capture and speaker playback |

## AWS Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `MESH_VOICE_TRANSCRIBE_LANGUAGE` | `en-US` | Transcribe language code |
| `MESH_VOICE_POLLY_VOICE` | `Joanna` | Polly voice ID |
| `MESH_VOICE_POLLY_ENGINE` | `neural` | Polly engine: `neural` or `standard` |

These use the same `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` as Bedrock. No separate credentials needed.

## VAD Tuning (Optional)

| Env Var | Default | Description |
|---------|---------|-------------|
| `MESH_VOICE_VAD_THRESHOLD` | `0.012` | Energy threshold to detect speech |
| `MESH_VOICE_VAD_PREFIX_MS` | `240` | Pre-speech buffer duration |
| `MESH_VOICE_VAD_SILENCE_MS` | `720` | Silence duration to end utterance |
| `MESH_VOICE_MIN_UTTERANCE_MS` | `280` | Minimum utterance length to process |
| `MESH_VOICE_MAX_UTTERANCE_MS` | `14000` | Maximum utterance length |

## Gateway Responsibilities

- WebSocket session handling at `/api/realtime`
- VAD-like utterance segmentation
- Sending PCM segments to Amazon Transcribe Streaming
- Building conversation message list
- Loading capsule context from active workspace
- Running Bedrock text model tool loop
- Speaking reply back via Amazon Polly

## Browser Responsibilities

- Mic capture via AudioWorklet
- PCM streaming to gateway
- Orb rendering and animation
- Session state display
- Transcript rendering
- Approval prompts
- Viewer log (transcript, run updates, file opens, code context)

## Voice Agent Tools

The voice agent is a real tool-capable surface:

| Tool | Purpose |
|------|---------|
| `delegate_task` | Hand off multi-step coding work to the typed agent system |
| `get_run_status` | Check status of a delegated run |
| `approve_action` | Approve a pending action |
| `reject_action` | Reject a pending action |
| `read_file` | Read a file from the workspace |
| `read_capsule` | Read compressed capsule for a file |
| `recover_spans` | Recover exact source spans |
| `search_workspace` | Search workspace content |
| `open_file` | Open a file in the editor |
| `git_status` | Get git status |
| `git_diff` | Get git diff |
| `run_terminal_command` | Execute a terminal command |
| `edit_file` | Directly edit a file |

Intended behavior:
- Use read/search/open for short tasks
- Use `delegate_task` for multi-step coding work
- Be concise in spoken output
- Put detailed state in the right-side viewer panel

## Workspace Context in Voice

Before each voice turn, the gateway:
1. Discovers preferred active/selected workspace paths
2. Falls back to listing workspace files
3. Loads capsule context (respects upload workspaces too)
4. Injects capsule context block into the Bedrock model prompt

This gives the voice agent compressed workspace knowledge without sending raw files.

## Voice UX States

### Intro State
- Only the orb
- Single button: "Jetzt starten"

### Live State
- Left: orb + session state + stop button
- Right: viewer log (transcript, approvals, file opens, tool updates, code context)

The orb is:
- Large and visually strong
- Rotatable via drag
- Fixed in place (not draggable across the page)

## Known Limitations

Voice is newer than typed chat and still needs testing on:
- Long sessions
- Approval flow edge cases
- Mixed read/write tasks
- Interruption handling
- File-view/code-change viewer behavior
