# Voice Interface (Speech-to-Speech) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time voice interface to the Mesh workbench so users can control the AI agent via speech, with spoken responses streamed back in real-time.

**Architecture:** Browser captures mic audio via Web Audio API → sends PCM16 frames over WebSocket to a gateway relay endpoint → gateway maintains a persistent WebSocket to Azure OpenAI gpt-realtime-1.5 → model responses (audio + text + function calls) stream back to browser → browser plays audio via AudioWorklet and executes function calls against existing MeshActions/MeshAPI.

**Tech Stack:** Web Audio API (AudioContext, AudioWorklet), Azure OpenAI Realtime API (WebSocket), Express WebSocket upgrade (ws package), gpt-realtime-1.5

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│  Browser (assets/features/voice-chat.js)             │
│                                                      │
│  Mic → AudioWorklet → PCM16 frames                   │
│           ↓                                          │
│  WebSocket ←→ Gateway Relay ←→ Azure Realtime WS     │
│           ↓                                          │
│  Audio Playback ← AudioWorklet (output)              │
│  Function Calls → MeshActions.openFile() etc.        │
│  Transcript → Chat panel (text alongside audio)      │
└──────────────────────────────────────────────────────┘
```

### Why a Gateway Relay?

The Azure OpenAI Realtime API requires an API key in the WebSocket handshake headers. Browsers cannot set custom headers on WebSocket connections. Therefore:

1. Browser connects to `ws://localhost:PORT/api/realtime`
2. Gateway authenticates the user (cookie/token)
3. Gateway opens a WebSocket to Azure with the API key in headers
4. Gateway pipes frames bidirectionally (transparent relay)

This keeps the API key server-side and lets us inject Capsula context.

---

## File Structure

| File | Responsibility |
|---|---|
| `assets/features/voice-chat.js` | UI button, mic capture, WebSocket client, audio playback, function call dispatch |
| `assets/features/voice-audio-worklet.js` | AudioWorklet processor for mic input (PCM16 encoding) and audio output (PCM16 decoding) |
| `src/routes/realtime.routes.js` | WebSocket upgrade handler, Azure relay, session/context injection |
| `src/server.js` | Register WS upgrade route |
| `app.html` | Add script tags for voice feature |

---

### Task 1: Audio Worklet Processor

**Files:**
- Create: `assets/features/voice-audio-worklet.js`

This runs in the AudioWorklet thread — separate from main thread for glitch-free audio.

- [ ] **Step 1: Write the AudioWorklet processor**

```javascript
// voice-audio-worklet.js
// Runs in AudioWorklet scope — no DOM, no window

class MicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const float32 = input[0];
    // Convert Float32 [-1,1] to Int16 PCM
    const pcm16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    this.port.postMessage({ type: 'mic-data', pcm16: pcm16.buffer }, [pcm16.buffer]);
    return true;
  }
}

class SpeakerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this.port.onmessage = (e) => {
      if (e.data?.type === 'audio-data') {
        this._buffer.push(new Float32Array(e.data.float32));
      }
    };
  }
  process(_, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const channel = output[0];
    let written = 0;
    while (written < channel.length && this._buffer.length > 0) {
      const chunk = this._buffer[0];
      const needed = channel.length - written;
      const available = chunk.length;
      if (available <= needed) {
        channel.set(chunk, written);
        written += available;
        this._buffer.shift();
      } else {
        channel.set(chunk.subarray(0, needed), written);
        this._buffer[0] = chunk.subarray(needed);
        written += needed;
      }
    }
    // Fill remaining with silence
    for (let i = written; i < channel.length; i++) channel[i] = 0;
    return true;
  }
}

registerProcessor('mic-processor', MicProcessor);
registerProcessor('speaker-processor', SpeakerProcessor);
```

- [ ] **Step 2: Verify file is servable**

The file must be served with correct MIME type. Express static middleware handles `.js` files.
Verify: `curl -I http://localhost:PORT/assets/features/voice-audio-worklet.js` → Content-Type: application/javascript

---

### Task 2: Gateway WebSocket Relay

**Files:**
- Create: `src/routes/realtime.routes.js`
- Modify: `src/server.js` (add WS upgrade handling)

- [ ] **Step 1: Install ws package (if not already present)**

Check `package.json` for `ws`. If missing:
```bash
npm install ws
```

- [ ] **Step 2: Write the relay route**

```javascript
// src/routes/realtime.routes.js
const WebSocket = require('ws');

const AZURE_REALTIME_ENDPOINT = process.env.AZURE_OPENAI_REALTIME_ENDPOINT
  || 'wss://mesh-openai.openai.azure.com/openai/realtime';
const AZURE_REALTIME_API_KEY = process.env.AZURE_OPENAI_REALTIME_KEY || '';
const AZURE_REALTIME_DEPLOYMENT = process.env.AZURE_OPENAI_REALTIME_DEPLOYMENT || 'gpt-realtime-1.5';
const AZURE_REALTIME_API_VERSION = '2025-04-01-preview';

function buildAzureRealtimeUrl() {
  return `${AZURE_REALTIME_ENDPOINT}?api-version=${AZURE_REALTIME_API_VERSION}&deployment=${AZURE_REALTIME_DEPLOYMENT}`;
}

/**
 * Build the session.update event that configures the realtime session.
 * Injects Capsula context as system instructions so the voice agent
 * understands the current workspace.
 */
function buildSessionConfig(capsuleContext) {
  const tools = [
    {
      type: 'function',
      name: 'open_file',
      description: 'Open a file in the editor by path',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    },
    {
      type: 'function',
      name: 'edit_file',
      description: 'Edit a file — provide path and new content',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    },
    {
      type: 'function',
      name: 'run_terminal',
      description: 'Execute a shell command in the terminal',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    },
    {
      type: 'function',
      name: 'search_files',
      description: 'Search workspace files by content',
      parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    },
    {
      type: 'function',
      name: 'git_status',
      description: 'Get current git status',
      parameters: { type: 'object', properties: {} },
    },
    {
      type: 'function',
      name: 'git_commit',
      description: 'Create a git commit with message',
      parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
    },
  ];

  const systemInstructions = [
    'You are the voice interface for Mesh, an AI-powered code editor.',
    'You can open files, edit code, run terminal commands, search the codebase, and manage git.',
    'Be concise in speech. When reading code, mention key parts briefly.',
    'When the user asks to edit code, use the edit_file tool.',
    'When the user asks to open a file, use open_file.',
    capsuleContext ? `\nCurrent workspace context:\n${capsuleContext}` : '',
  ].filter(Boolean).join('\n');

  return {
    type: 'session.update',
    session: {
      modalities: ['text', 'audio'],
      instructions: systemInstructions,
      voice: 'alloy',
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
      input_audio_transcription: { model: 'whisper-1' },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      tools,
      tool_choice: 'auto',
      temperature: 0.7,
    },
  };
}

/**
 * Handle WebSocket upgrade for /api/realtime
 * @param {import('http').Server} server - HTTP server instance
 */
function setupRealtimeRelay(server) {
  const wss = new WebSocket.Server({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname !== '/api/realtime') return;

    // Auth check: read cookie or query param
    const token = readAuthTokenFromRequest(req);
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const authUser = resolveAuthUserFromRequest(req);
    if (!authUser) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (clientWs) => {
      handleRealtimeSession(clientWs, authUser);
    });
  });
}

async function handleRealtimeSession(clientWs, authUser) {
  const azureUrl = buildAzureRealtimeUrl();

  // Load capsule context for voice session
  let capsuleContext = '';
  try {
    if (localAssistantWorkspace.files && localAssistantWorkspace.files.size > 0) {
      const paths = Array.from(localAssistantWorkspace.files.keys()).slice(0, 10);
      const entries = await loadCapsuleContextEntries(paths, {
        maxFiles: 5,
        maxModelChars: 4000,
      });
      capsuleContext = buildCapsuleContextBlock(entries.entries || [], []);
    }
  } catch { /* proceed without context */ }

  // Connect to Azure
  const azureWs = new WebSocket(azureUrl, {
    headers: {
      'api-key': AZURE_REALTIME_API_KEY,
    },
  });

  let azureReady = false;

  azureWs.on('open', () => {
    azureReady = true;
    // Send session configuration with tools and context
    azureWs.send(JSON.stringify(buildSessionConfig(capsuleContext)));
  });

  azureWs.on('message', (data) => {
    // Forward Azure messages to client
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data);
    }
  });

  azureWs.on('error', (err) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify({ type: 'error', error: err.message }));
    }
  });

  azureWs.on('close', () => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.close(1000, 'Azure session ended');
    }
  });

  // Forward client messages to Azure
  clientWs.on('message', (data) => {
    if (azureReady && azureWs.readyState === WebSocket.OPEN) {
      azureWs.send(data);
    }
  });

  clientWs.on('close', () => {
    if (azureWs.readyState === WebSocket.OPEN) {
      azureWs.close();
    }
  });

  clientWs.on('error', () => {
    if (azureWs.readyState === WebSocket.OPEN) {
      azureWs.close();
    }
  });
}

module.exports = { setupRealtimeRelay };
```

- [ ] **Step 3: Register WebSocket upgrade in server.js**

In `src/server.js`, after the HTTP server is created:
```javascript
const { setupRealtimeRelay } = require('./routes/realtime.routes');
// After: const server = app.listen(PORT, ...)
setupRealtimeRelay(server);
```

- [ ] **Step 4: Add env vars to .env.example**

```
AZURE_OPENAI_REALTIME_ENDPOINT=wss://mesh-openai.openai.azure.com/openai/realtime
AZURE_OPENAI_REALTIME_KEY=
AZURE_OPENAI_REALTIME_DEPLOYMENT=gpt-realtime-1.5
```

- [ ] **Step 5: Commit**

```bash
git add src/routes/realtime.routes.js
git commit -m "feat(voice): add WebSocket relay for Azure OpenAI Realtime API"
```

---

### Task 3: Voice Chat Frontend Module

**Files:**
- Create: `assets/features/voice-chat.js`
- Modify: `app.html` (add script tag)

- [ ] **Step 1: Write the voice-chat.js feature module**

This is the main UI + audio logic:

```javascript
/* Mesh Feature: Voice Chat (Speech-to-Speech via gpt-realtime-1.5) */
(function(){
const SAMPLE_RATE = 24000; // Azure Realtime expects 24kHz PCM16

const style = document.createElement('style');
style.textContent = `
.vc-btn { ... mic button styles ... }
.vc-overlay { ... voice active overlay ... }
.vc-transcript { ... live transcript ... }
.vc-wave { ... audio visualizer ... }
`;
document.head.appendChild(style);

let audioCtx = null;
let micStream = null;
let micNode = null;
let speakerNode = null;
let ws = null;
let isActive = false;
let currentTranscript = '';

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  injectButton();
}

function injectButton() {
  // Add mic button to chat input area
  const chatInRow = document.querySelector('.chat-in-row');
  if (!chatInRow) return;

  const btn = document.createElement('button');
  btn.className = 'ci-btn vc-btn';
  btn.id = 'vcBtn';
  btn.title = 'Voice Chat (hold to talk)';
  btn.innerHTML = '🎙';
  btn.addEventListener('mousedown', startVoice);
  btn.addEventListener('mouseup', stopVoice);
  btn.addEventListener('mouseleave', stopVoice);
  // Also support click toggle mode
  btn.addEventListener('click', toggleVoice);
  chatInRow.appendChild(btn);

  // Keyboard shortcut: hold V with Cmd
  document.addEventListener('keydown', (e) => {
    if (e.metaKey && e.key === 'm' && !e.repeat) {
      e.preventDefault();
      toggleVoice();
    }
  });
}

async function startVoice() { ... }
async function stopVoice() { ... }
function toggleVoice() { ... }

// WebSocket connection + audio pipeline
async function connectRealtime() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/api/realtime`);
  ws.onmessage = handleRealtimeEvent;
  ws.onclose = onDisconnect;
  ws.onerror = onDisconnect;

  // Set up AudioContext at 24kHz
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioCtx.audioWorklet.addModule('/assets/features/voice-audio-worklet.js');

  // Mic capture
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true }
  });
  const source = audioCtx.createMediaStreamSource(micStream);
  micNode = new AudioWorkletNode(audioCtx, 'mic-processor');
  source.connect(micNode);
  micNode.port.onmessage = (e) => {
    if (e.data?.type === 'mic-data' && ws?.readyState === WebSocket.OPEN) {
      // Send as input_audio_buffer.append
      const base64 = arrayBufferToBase64(e.data.pcm16);
      ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: base64,
      }));
    }
  };

  // Speaker output
  speakerNode = new AudioWorkletNode(audioCtx, 'speaker-processor');
  speakerNode.connect(audioCtx.destination);
}

function handleRealtimeEvent(event) {
  const data = JSON.parse(event.data);

  switch (data.type) {
    case 'session.created':
    case 'session.updated':
      // Session ready
      break;

    case 'response.audio.delta':
      // Decode base64 PCM16 and send to speaker
      const pcm16 = base64ToInt16Array(data.delta);
      const float32 = int16ToFloat32(pcm16);
      speakerNode.port.postMessage({ type: 'audio-data', float32: float32.buffer }, [float32.buffer]);
      break;

    case 'response.audio_transcript.delta':
      // Live transcript of AI response
      currentTranscript += data.delta;
      updateTranscriptUI(currentTranscript);
      break;

    case 'response.audio_transcript.done':
      // Final transcript → add to chat
      if (data.transcript) {
        window.MeshActions?.appendMsg('assistant', data.transcript);
      }
      currentTranscript = '';
      break;

    case 'conversation.item.input_audio_transcription.completed':
      // User speech transcript → add to chat
      if (data.transcript) {
        window.MeshActions?.appendMsg('user', data.transcript);
      }
      break;

    case 'response.function_call_arguments.done':
      // Function call from voice agent
      executeFunctionCall(data.call_id, data.name, data.arguments);
      break;

    case 'error':
      window.MeshActions?.toast('Voice', data.error?.message || 'Voice error');
      break;
  }
}

async function executeFunctionCall(callId, name, argsJson) {
  const args = JSON.parse(argsJson || '{}');
  const A = window.MeshActions;
  const S = window.MeshState;
  const api = window.MeshAPI;
  let result = '';

  switch (name) {
    case 'open_file': {
      const item = A?.findInTree(S?.tree, args.path);
      if (item) { A.openFile(item); result = 'Opened ' + args.path; }
      else result = 'File not found: ' + args.path;
      break;
    }
    case 'edit_file': {
      await api('/api/assistant/workspace/file', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: args.path, content: args.content }),
      });
      result = 'File saved: ' + args.path;
      break;
    }
    case 'run_terminal': {
      // Send to terminal
      result = 'Command sent: ' + args.command;
      break;
    }
    case 'search_files': {
      const res = await api('/api/assistant/workspace/grep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: args.query }),
      });
      const matches = res?.matches || [];
      result = matches.length + ' matches found';
      break;
    }
    case 'git_status': {
      const res = await api('/api/assistant/git/status');
      result = JSON.stringify(res?.files?.slice(0, 5) || []);
      break;
    }
    case 'git_commit': {
      await api('/api/assistant/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: args.message }),
      });
      result = 'Committed: ' + args.message;
      break;
    }
    default:
      result = 'Unknown function: ' + name;
  }

  // Send function call result back to model
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: result,
      },
    }));
    // Trigger model to continue responding
    ws.send(JSON.stringify({ type: 'response.create' }));
  }
}
```

The full file will include: UI overlay with waveform visualizer, push-to-talk vs VAD toggle,
transcript display, connection status, and all the audio encoding/decoding helpers.

- [ ] **Step 2: Add script tags to app.html**

```html
<script src="/assets/features/voice-audio-worklet.js"></script>
<script src="/assets/features/voice-chat.js"></script>
```

Note: voice-audio-worklet.js is loaded by `audioWorklet.addModule()`, not by a script tag.
Only voice-chat.js needs a script tag.

- [ ] **Step 3: Test mic permissions**

Open the workbench, click the mic button. Browser should prompt for microphone permission.
Verify: AudioContext creates at 24kHz, mic data flows.

- [ ] **Step 4: Commit**

```bash
git add assets/features/voice-chat.js assets/features/voice-audio-worklet.js
git commit -m "feat(voice): add voice chat UI with mic capture and audio playback"
```

---

### Task 4: Integration & Polish

**Files:**
- Modify: `assets/features/voice-chat.js`
- Modify: `src/routes/realtime.routes.js`

- [ ] **Step 1: Add voice overlay UI**

When voice is active, show a floating overlay with:
- Animated waveform (AnalyserNode from AudioContext)
- Live transcript (user speech + AI response)
- Status indicator (Listening / Thinking / Speaking)
- Stop button

- [ ] **Step 2: Add Capsula context refresh**

When the user opens a new file or switches workspace, send a `session.update`
event over the WebSocket to refresh the system instructions with new capsule context.

- [ ] **Step 3: Add push-to-talk mode**

Add a toggle between:
- **VAD mode** (default): server detects when user stops speaking
- **Push-to-talk**: hold mic button or Cmd+M to talk

In push-to-talk mode, send `input_audio_buffer.commit` on release
instead of relying on server VAD.

- [ ] **Step 4: Add command palette integration**

Register voice commands in the command palette:
- "Start Voice Chat" / "Stop Voice Chat"
- "Toggle Push-to-Talk"

- [ ] **Step 5: Wire function call results to UI**

When the voice agent calls `open_file`, actually open it and show visual feedback.
When it calls `edit_file`, show the agentic-edits diff preview.
When it calls `run_terminal`, execute in the terminal panel.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(voice): complete voice interface with overlay, PTT, and tool integration"
```

---

## Environment Variables Required

```
AZURE_OPENAI_REALTIME_ENDPOINT=wss://mesh-openai.openai.azure.com/openai/realtime
AZURE_OPENAI_REALTIME_KEY=<your-key>
AZURE_OPENAI_REALTIME_DEPLOYMENT=gpt-realtime-1.5
```

## Key Design Decisions

1. **Gateway relay** instead of direct browser→Azure WebSocket (API key security)
2. **AudioWorklet** instead of ScriptProcessorNode (no audio glitches, off-main-thread)
3. **PCM16 at 24kHz** — native format for Azure Realtime (no transcoding overhead)
4. **Server VAD as default** — better UX than push-to-talk, user can interrupt mid-sentence
5. **Function calling** — voice agent can directly manipulate the IDE, not just chat
6. **Capsula context injection** — voice agent understands the codebase via the same compression system as text chat
