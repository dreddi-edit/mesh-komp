/* Mesh Feature: Voice Chat — Glowing Mesh Sphere Orb */
(function(){
const SAMPLE_RATE = 24000;
const FFT_SIZE = 256;

const style = document.createElement('style');
style.textContent = `
/* -- Mic Button in chat input -- */
.vc-mic { background: none; border: 1px solid var(--bd, #3c3c3c); color: var(--tx3, #777); width: 32px; height: 32px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all 0.2s; flex-shrink: 0; }
.vc-mic:hover { border-color: var(--ac, #0098ff); color: var(--ac); }
.vc-mic.active { border-color: var(--red, #f14c4c); color: var(--red); background: rgba(241,76,76,0.08); animation: vc-mic-pulse 1.5s infinite; }
@keyframes vc-mic-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(241,76,76,0.25); } 50% { box-shadow: 0 0 0 6px rgba(241,76,76,0); } }

/* -- Floating Orb Container -- */
.vc-orb-wrap {
  position: absolute;
  z-index: 400;
  cursor: grab;
  touch-action: none;
  user-select: none;
  transition: opacity 0.35s ease;
}
.vc-orb-wrap.dragging { cursor: grabbing; }

.vc-orb-canvas { display: block; pointer-events: none; }

/* -- Status label -- */
.vc-orb-label {
  position: absolute;
  bottom: -4px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 9px;
  color: var(--tx3, #777);
  text-transform: uppercase;
  letter-spacing: 2.5px;
  font-weight: 600;
  font-family: var(--m, 'JetBrains Mono', monospace);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.7;
}

/* -- Close button -- */
.vc-orb-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgba(241,76,76,0.15);
  color: var(--red, #f14c4c);
  font-size: 11px;
  display: grid;
  place-items: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.2s, background 0.2s;
  border: 1px solid rgba(241,76,76,0.25);
  line-height: 1;
  backdrop-filter: blur(4px);
}
.vc-orb-wrap:hover .vc-orb-close { opacity: 1; }
.vc-orb-close:hover { background: var(--red, #f14c4c); color: #fff; }

/* -- Transcript below orb -- */
.vc-orb-tx {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: 240px;
  text-align: center;
  pointer-events: none;
}
.vc-orb-tx-user {
  font-size: 10px;
  color: var(--tx3, #777);
  font-style: italic;
  margin-bottom: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--f, 'Inter', sans-serif);
}
.vc-orb-tx-ai {
  font-size: 11px;
  color: var(--txw, #fff);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-family: var(--f, 'Inter', sans-serif);
}

.vc-run-panel {
  position: absolute;
  top: calc(100% + 72px);
  left: 50%;
  transform: translateX(-50%);
  width: 270px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(120, 140, 220, 0.18);
  background: rgba(17, 20, 30, 0.76);
  backdrop-filter: blur(12px);
  box-shadow: 0 10px 30px rgba(0,0,0,0.22);
  pointer-events: auto;
}
.vc-run-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.vc-run-kicker { font-size: 9px; text-transform: uppercase; letter-spacing: 0.18em; color: var(--tx3, #777); font-family: var(--m, 'JetBrains Mono', monospace); }
.vc-run-model { font-size: 10px; color: var(--ac, #0098ff); font-family: var(--m, 'JetBrains Mono', monospace); }
.vc-run-title { font-size: 11px; line-height: 1.45; color: var(--txw, #fff); margin-bottom: 8px; min-height: 16px; }
.vc-run-list { display: flex; flex-direction: column; gap: 6px; max-height: 150px; overflow-y: auto; }
.vc-run-item { display: flex; align-items: flex-start; gap: 8px; font-size: 10px; line-height: 1.45; color: var(--tx, #ccc); }
.vc-run-dot { width: 8px; height: 8px; border-radius: 999px; margin-top: 4px; flex: 0 0 auto; background: rgba(140, 160, 220, 0.35); }
.vc-run-dot.completed { background: rgba(78, 201, 176, 0.95); }
.vc-run-dot.running { background: rgba(0, 152, 255, 0.95); }
.vc-run-dot.requires_approval { background: rgba(255, 193, 7, 0.95); }
.vc-run-dot.failed, .vc-run-dot.rejected { background: rgba(241, 76, 76, 0.95); }
.vc-run-item strong { display: block; color: var(--txw, #fff); font-weight: 600; font-size: 10px; }
.vc-run-item span { color: var(--tx3, #8a8a8a); }
.vc-approval-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.vc-approval-card { border: 1px solid rgba(255, 193, 7, 0.2); background: rgba(255, 193, 7, 0.08); border-radius: 10px; padding: 8px 10px; }
.vc-approval-title { font-size: 10px; color: #f7d36a; font-weight: 600; margin-bottom: 4px; }
.vc-approval-copy { font-size: 10px; color: var(--tx, #ccc); line-height: 1.45; }
.vc-approval-actions { display: flex; gap: 6px; margin-top: 8px; }
.vc-approval-actions button { flex: 1; border-radius: 7px; border: 1px solid rgba(255,255,255,0.12); background: rgba(255,255,255,0.06); color: var(--txw, #fff); padding: 6px 8px; font-size: 10px; cursor: pointer; }
.vc-approval-actions button[data-act="approve"] { border-color: rgba(78, 201, 176, 0.35); color: #9be9d2; }
.vc-approval-actions button[data-act="reject"] { border-color: rgba(241, 76, 76, 0.35); color: #ffb0b0; }
.vc-run-empty { font-size: 10px; color: var(--tx3, #8a8a8a); }

/* -- Function Call Toast -- */
.vc-fn-toast {
  position: fixed;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg2, #252526);
  border: 1px solid var(--bd, #3c3c3c);
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 11px;
  color: var(--tx, #ccc);
  z-index: 100000;
  display: flex;
  align-items: center;
  gap: 8px;
  animation: vc-fn-in 0.3s;
  font-family: var(--f);
  backdrop-filter: blur(12px);
}
.vc-fn-toast .fn-name { color: var(--ac, #0098ff); font-family: var(--m, monospace); }
@keyframes vc-fn-in { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
`;
document.head.appendChild(style);

/* ── State ── */
let audioCtx = null;
let micStream = null;
let micNode = null;
let speakerNode = null;
let analyserMic = null;
let analyserOut = null;
let ws = null;
let wsSessionReady = false;
let isActive = false;
let mode = 'vad';
let state = 'idle';
let userTranscript = '';
let aiTranscript = '';
let animFrame = null;

/* Orb DOM */
let orbWrap = null;
let orbCanvas = null;
let orbCtx = null;
let orbLabel = null;
let userTxEl = null;
let aiTxEl = null;
let runPanelEl = null;
let runTitleEl = null;
let runModelEl = null;
let runListEl = null;
let approvalListEl = null;

/* Drag */
let isDragging = false;
const orbInteraction = {
  pointerId: null,
  lastX: 0,
  lastY: 0,
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
};

/* Orb dimensions */
const ORB_RENDER = 380;
const ORB_DISPLAY = 380;

/* ── Color palettes per state ── */
const PALETTES = {
  connecting: { r: 64,  g: 118, b: 255, r2: 158, g2: 102, b2: 255 },
  listening:  { r: 0,   g: 176, b: 255, r2: 76,  g2: 225, b2: 255 },
  thinking:   { r: 132, g: 84,  b: 255, r2: 210, g2: 120, b2: 255 },
  speaking:   { r: 0,   g: 214, b: 176, r2: 98,  g2: 244, b2: 212 },
  running:    { r: 0,   g: 148, b: 255, r2: 108, g2: 205, b2: 255 },
  approval:   { r: 255, g: 188, b: 54,  r2: 255, g2: 227, b2: 128 },
  error:      { r: 255, g: 88,  b: 88,  r2: 255, g2: 146, b2: 146 },
  ready:      { r: 48,  g: 90,  b: 160, r2: 80,  g2: 130, b2: 200 },
};

const voiceRuntime = {
  selectedCodingModel: '',
  autonomyMode: 'auto_edit_confirm_run',
  realtimeProfile: '',
  realtimeDeployment: '',
  currentRun: null,
  currentRunId: '',
  pendingActionIds: [],
};

function getSelectedCodingModel() {
  return document.querySelector('#chatModel')?.value || window.MeshState?.settings?.model || 'claude-sonnet-4-6';
}

function appendChatMessage(role, content) {
  const text = String(content || '').trim();
  if (!text) return;
  if (window.MeshState?.chat) window.MeshState.chat.push({ role, content: text });
  window.MeshActions?.appendMsg?.(role, text, role !== 'user');
  appendVoiceViewerEntry(role, text);
}

function isVoiceSurfaceActive() {
  return window.MeshState?.surfaceMode === 'voice' && document.querySelector('#voiceCodingView')?.style.display !== 'none';
}

function currentOrbHost() {
  if (!isVoiceSurfaceActive()) return document.querySelector('#chatMsgs');
  return isActive ? document.querySelector('#voiceSurfaceOrbStage') : document.querySelector('#voiceSurfaceOrbStageIntro');
}

function appendVoiceViewerEntry(role, content, options = {}) {
  const log = document.querySelector('#voiceSurfaceViewerLog');
  const text = String(content || '').trim();
  if (!log || !text) return;
  log.querySelector('.voice-surface-viewer-empty')?.remove();
  const entry = document.createElement('div');
  entry.className = `voice-view-entry ${options.kind || role || 'system'}`;
  const title = options.label || (role === 'user' ? 'You' : role === 'assistant' ? 'Mesh.' : 'System');
  entry.innerHTML = `<div class="voice-view-role">${esc(title)}</div><div>${esc(text)}</div>`;
  if (options.code) {
    const pre = document.createElement('pre');
    pre.textContent = String(options.code);
    entry.appendChild(pre);
  }
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}

function updateVoiceSurfaceShell() {
  const intro = document.querySelector('#voiceSurfaceIntro');
  const live = document.querySelector('#voiceSurfaceLive');
  const stopBtn = document.querySelector('#btnVoiceSurfaceStop');
  const placeholder = document.querySelector('.voice-surface-orb-placeholder');
  if (!intro || !live) return;
  if (!isVoiceSurfaceActive()) {
    intro.style.display = '';
    live.style.display = 'none';
    if (placeholder) placeholder.style.display = '';
    return;
  }
  intro.style.display = isActive ? 'none' : 'flex';
  live.style.display = isActive ? 'grid' : 'none';
  if (placeholder) placeholder.style.display = orbWrap ? 'none' : '';
  if (stopBtn) stopBtn.disabled = !isActive;
}

function syncOrbMount() {
  updateVoiceSurfaceShell();
  const host = currentOrbHost();
  if (!host) return;
  if (!orbWrap) {
    createOrb();
    return;
  }
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  if (orbWrap.parentElement !== host) host.appendChild(orbWrap);
  const docked = isVoiceSurfaceActive();
  const introMinimal = docked && !isActive;
  orbWrap.classList.toggle('vc-docked', docked);
  orbWrap.classList.toggle('vc-intro-minimal', introMinimal);
  if (docked) {
    orbWrap.style.left = '50%';
    orbWrap.style.top = '50%';
    orbWrap.style.transform = 'translate(-50%, -50%)';
    return;
  }
  orbWrap.style.transform = '';
  const rect = host.getBoundingClientRect();
  orbWrap.style.left = Math.round((rect.width - ORB_DISPLAY) / 2) + 'px';
  orbWrap.style.top = Math.round((rect.height - ORB_DISPLAY) / 2 - 20) + 'px';
}

function buildVoiceConfigPayload() {
  const activeFilePath = window.MeshState?.activeTab || '';
  const selectedPaths = Array.from(new Set([
    activeFilePath,
    ...((Array.isArray(window.MeshState?.tabs) ? window.MeshState.tabs : []).map((tab) => String(tab?.path || ''))),
  ].filter(Boolean))).slice(0, 6);
  return {
    selectedCodingModel: getSelectedCodingModel(),
    autonomyMode: voiceRuntime.autonomyMode,
    workspaceFolderName: window.MeshState?.dirName || '',
    workspaceId: window.MeshState?.workspaceId || ((window.MeshState?.dirName || '') + (window.MeshState?.user?.id ? '-' + window.MeshState.user.id : '')),
    activeFilePath,
    selectedPaths,
  };
}

function sendVoiceMessage(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN || !payload) return;
  try { ws.send(JSON.stringify(payload)); } catch {}
}

function sendVoiceConfig() {
  voiceRuntime.selectedCodingModel = getSelectedCodingModel();
  sendVoiceMessage({ type: 'mesh.voice.configure', config: buildVoiceConfigPayload() });
}

function syncVoiceRun(runtimeRun) {
  voiceRuntime.currentRun = runtimeRun || null;
  voiceRuntime.currentRunId = String(runtimeRun?.id || runtimeRun?.runId || voiceRuntime.currentRunId || '');
  voiceRuntime.pendingActionIds = Array.isArray(runtimeRun?.actions)
    ? runtimeRun.actions.filter((action) => String(action?.status || '') === 'requires_approval').map((action) => String(action.id || ''))
    : voiceRuntime.pendingActionIds;
  renderVoiceRunPanel();
}

function renderVoiceRunPanel() {
  if (!runPanelEl || !runTitleEl || !runModelEl || !runListEl || !approvalListEl) return;

  runModelEl.textContent = voiceRuntime.selectedCodingModel || getSelectedCodingModel();

  const run = voiceRuntime.currentRun;
  if (!run) {
    runTitleEl.textContent = 'No delegated run yet.';
    runListEl.innerHTML = '<div class="vc-run-empty">Voice can delegate full coding tasks to the Mesh agent.</div>';
    approvalListEl.innerHTML = '';
    return;
  }

  runTitleEl.textContent = run.title || run.prompt || run.reply || `Run ${voiceRuntime.currentRunId}`;
  const actions = Array.isArray(run.actions) ? run.actions : [];
  runListEl.innerHTML = actions.length
    ? actions.map((action) => `
      <div class="vc-run-item">
        <span class="vc-run-dot ${esc(String(action.status || 'pending'))}"></span>
        <div>
          <strong>${esc(action.title || action.type || 'Action')}</strong>
          <span>${esc(String(action.status || 'pending').replace(/_/g, ' '))}</span>
        </div>
      </div>
    `).join('')
    : '<div class="vc-run-empty">Waiting for tool activity…</div>';

  const approvals = actions.filter((action) => String(action?.status || '') === 'requires_approval');
  approvalListEl.innerHTML = approvals.map((action) => `
    <div class="vc-approval-card" data-run-id="${esc(run.id || voiceRuntime.currentRunId)}" data-action-id="${esc(action.id || '')}">
      <div class="vc-approval-title">Approval required</div>
      <div class="vc-approval-copy">${esc(action.title || action.type || 'Pending action')}</div>
      <div class="vc-approval-actions">
        <button type="button" data-act="approve">Approve</button>
        <button type="button" data-act="reject">Reject</button>
      </div>
    </div>
  `).join('');

  approvalListEl.querySelectorAll('button[data-act]').forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.vc-approval-card');
      if (!card) return;
      sendVoiceMessage({
        type: button.dataset.act === 'approve' ? 'mesh.voice.approve_action' : 'mesh.voice.reject_action',
        runId: card.dataset.runId,
        actionId: card.dataset.actionId,
      });
      button.disabled = true;
    });
  });
}

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  injectMicButton();
  window.addEventListener('mesh-surface-changed', () => {
    if (isVoiceSurfaceActive()) {
      syncOrbMount();
    } else if (!isActive && orbWrap) {
      destroyOrb();
    }
  });
}

function injectMicButton() {
  const row = document.querySelector('.chat-in-box');
  if (!row || document.querySelector('#vcMic')) return;
  const btn = document.createElement('button');
  btn.className = 'vc-mic';
  btn.id = 'vcMic';
  btn.title = 'Voice Chat (Cmd+M)';
  btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="1" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
  btn.addEventListener('click', toggle);
  row.appendChild(btn);
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'm' && !e.repeat) { e.preventDefault(); toggle(); }
  });
  document.querySelector('#chatModel')?.addEventListener('change', () => {
    voiceRuntime.selectedCodingModel = getSelectedCodingModel();
    renderVoiceRunPanel();
    if (isActive) sendVoiceConfig();
  });
}

async function toggle() {
  if (isActive) { stop(); return; }
  isActive = true;
  document.querySelector('#vcMic')?.classList.add('active');
  setState('connecting');
  createOrb();
  updateVoiceSurfaceShell();
  appendVoiceViewerEntry('system', 'Voice session starting…', { kind: 'system', label: 'Session' });
  try {
    await startAudio();
    await connectWebSocket();
    setState('listening');
  } catch (e) {
    await surfaceVoiceFailure(`Failed: ${e.message}`, { disconnectLabel: 'Handshake failed' });
    stop();
  }
}

async function surfaceVoiceFailure(message, options = {}) {
  const detail = String(message || 'Voice session failed').trim();
  const disconnectLabel = String(options.disconnectLabel || 'Disconnected').trim();
  setState('error');
  userTranscript = disconnectLabel;
  aiTranscript = detail;
  if (userTxEl) userTxEl.textContent = disconnectLabel;
  if (aiTxEl) aiTxEl.textContent = detail;
  window.MeshActions?.toast?.('Voice', detail);
  await new Promise((resolve) => setTimeout(resolve, Number(options.delayMs || 1600)));
}

function recoverVoiceStateAfterError() {
  if (!isActive || !wsSessionReady) return;
  if (voiceRuntime.pendingActionIds.length) {
    setState('approval');
    return;
  }
  if (voiceRuntime.currentRun && ['running', 'awaiting_approval'].includes(String(voiceRuntime.currentRun.status || ''))) {
    setState('running');
    return;
  }
  setState('ready');
}

function stop() {
  if (voiceRuntime.currentRun && ['running', 'awaiting_approval'].includes(String(voiceRuntime.currentRun.status || ''))) {
    appendChatMessage('assistant', `Voice session closed. Run ${voiceRuntime.currentRun.id || voiceRuntime.currentRunId} may still be active in the workspace.`);
  }
  isActive = false;
  wsSessionReady = false;
  setState('idle');
  document.querySelector('#vcMic')?.classList.remove('active');
  if (ws) { try { ws.close(); } catch {} ws = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close().catch(() => {}); audioCtx = null; }
  micNode = null; speakerNode = null; analyserMic = null; analyserOut = null;
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  destroyOrb();
  userTranscript = '';
  aiTranscript = '';
  voiceRuntime.currentRun = null;
  voiceRuntime.currentRunId = '';
  voiceRuntime.pendingActionIds = [];
  updateVoiceSurfaceShell();
  if (isVoiceSurfaceActive()) {
    createOrb();
    setState('idle');
  }
}

function setState(s) {
  state = s;
  if (orbLabel) {
    const labels = {
      idle: '',
      connecting: 'Connecting',
      listening: 'Listening',
      thinking: 'Thinking',
      speaking: 'Speaking',
      running: 'Running Tools',
      approval: 'Awaiting Approval',
      error: 'Disconnected',
      ready: 'Ready',
    };
    orbLabel.textContent = labels[s] || s;
  }
  const surfaceState = document.querySelector('#voiceSurfaceState');
  if (surfaceState) {
    const surfaceLabels = {
      idle: 'Ready for session',
      connecting: 'Starting session',
      listening: 'Listening',
      thinking: 'Thinking',
      speaking: 'Speaking',
      running: 'Running tools',
      approval: 'Awaiting approval',
      error: 'Voice issue',
      ready: 'Waiting for you',
    };
    surfaceState.textContent = surfaceLabels[s] || s;
  }
}

/* ── Audio ── */
async function startAudio() {
  audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
  await audioCtx.resume();
  await audioCtx.audioWorklet.addModule('/assets/features/voice-audio-worklet.js');
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const source = audioCtx.createMediaStreamSource(micStream);
  analyserMic = audioCtx.createAnalyser();
  analyserMic.fftSize = FFT_SIZE;
  analyserMic.smoothingTimeConstant = 0.8;
  source.connect(analyserMic);
  micNode = new AudioWorkletNode(audioCtx, 'mic-processor');
  source.connect(micNode);
  micNode.port.onmessage = (e) => {
    if (e.data?.type === 'mic-data' && wsSessionReady && ws?.readyState === WebSocket.OPEN && (mode === 'vad' || state === 'listening')) {
      ws.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: arrayBufToBase64(e.data.pcm16) }));
    }
  };
  analyserOut = audioCtx.createAnalyser();
  analyserOut.fftSize = FFT_SIZE;
  analyserOut.smoothingTimeConstant = 0.8;
  speakerNode = new AudioWorkletNode(audioCtx, 'speaker-processor');
  speakerNode.connect(analyserOut);
  analyserOut.connect(audioCtx.destination);
}

/* ── WebSocket ── */
async function connectWebSocket() {
  return new Promise((resolve, reject) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/api/realtime`);
    let settled = false;
    const fail = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      wsSessionReady = false;
      reject(new Error(String(message || 'Voice session closed before startup')));
      try { ws.close(); } catch {}
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      fail('Connection timeout — voice service did not become ready');
    }, 10000);

    let sessionReady = false;

    ws.onopen = () => {
      sendVoiceConfig();
    };
    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      switch (msg.type) {
        case 'session.ready':
        case 'session.updated':
          voiceRuntime.realtimeProfile = msg.profile || voiceRuntime.realtimeProfile;
          voiceRuntime.realtimeDeployment = msg.deployment || voiceRuntime.realtimeDeployment;
          sessionReady = true;
          wsSessionReady = true;
          appendVoiceViewerEntry('system', `Session ready via ${voiceRuntime.realtimeProfile || 'voice transport'}.`, { kind: 'system', label: 'Session' });
          succeed();
          break;
        case 'voice.session.configured':
          voiceRuntime.selectedCodingModel = msg.selectedCodingModel || voiceRuntime.selectedCodingModel || getSelectedCodingModel();
          renderVoiceRunPanel();
          const modelEl = document.querySelector('#voiceSurfaceModel');
          if (modelEl) modelEl.textContent = voiceRuntime.selectedCodingModel;
          break;
        case 'input_audio_buffer.speech_started':
          setState('listening');
          speakerNode?.port.postMessage({ type: 'clear' });
          aiTranscript = '';
          if (aiTxEl) aiTxEl.textContent = '';
          break;
        case 'input_audio_buffer.speech_stopped':
          setState('thinking');
          break;
        case 'response.audio.delta':
        case 'response.output_audio.delta':
          if (state !== 'speaking') setState('speaking');
          playAudioDelta(msg.delta || msg.audio);
          break;
        case 'response.audio_transcript.delta':
        case 'response.output_audio_transcript.delta':
          aiTranscript += (msg.delta || '');
          if (aiTxEl) aiTxEl.textContent = aiTranscript;
          break;
        case 'response.audio_transcript.done':
        case 'response.output_audio_transcript.done':
          if (msg.transcript) {
            aiTranscript = msg.transcript;
            if (aiTxEl) aiTxEl.textContent = aiTranscript;
            appendChatMessage('assistant', msg.transcript);
          }
          break;
        case 'conversation.item.input_audio_transcription.completed':
        case 'conversation.item.audio_transcription.completed':
          if (msg.transcript) {
            userTranscript = msg.transcript;
            if (userTxEl) userTxEl.textContent = '\u201c' + msg.transcript + '\u201d';
            appendChatMessage('user', msg.transcript);
          }
          break;
        case 'voice.narration':
          if (msg.text) {
            if (aiTxEl) aiTxEl.textContent = String(msg.text);
            if (msg.appendToChat) appendChatMessage('assistant', msg.text);
            else appendVoiceViewerEntry('assistant', msg.text);
          }
          break;
        case 'voice.state.empty_transcription':
          if (orbLabel) {
            const prev = orbLabel.textContent;
            orbLabel.textContent = '?';
            setTimeout(() => { if (orbLabel) orbLabel.textContent = prev; }, 600);
          }
          break;
        case 'voice.file.open':
          if (msg.path) {
            appendVoiceViewerEntry('system', `Opened ${msg.path}`, { kind: 'tool', label: 'Open File' });
            window.openFileByPath?.(msg.path);
          }
          break;
        case 'voice.run.started':
          voiceRuntime.selectedCodingModel = msg.selectedCodingModel || voiceRuntime.selectedCodingModel || getSelectedCodingModel();
          voiceRuntime.currentRun = {
            id: msg.currentRunId || '',
            title: msg.prompt || 'Delegated agent task',
            status: 'running',
            actions: [],
          };
          voiceRuntime.currentRunId = msg.currentRunId || voiceRuntime.currentRunId;
          renderVoiceRunPanel();
          setState('running');
          appendVoiceViewerEntry('assistant', msg.prompt || 'Delegated coding task started.', { kind: 'run', label: 'Run Started' });
          break;
        case 'voice.run.updated':
          syncVoiceRun(msg.run);
          if (voiceRuntime.pendingActionIds.length) setState('approval');
          else if (voiceRuntime.currentRun && ['running', 'awaiting_approval'].includes(String(voiceRuntime.currentRun.status || ''))) setState('running');
          appendVoiceViewerEntry('system', `Run updated: ${msg.run?.status || 'running'}`, { kind: 'run', label: 'Run Update' });
          break;
        case 'voice.run.completed':
          syncVoiceRun(msg.run);
          if (state !== 'speaking') setState('ready');
          appendVoiceViewerEntry('assistant', msg.run?.reply || 'Run completed.', { kind: 'run', label: 'Run Complete' });
          break;
        case 'voice.action.requires_approval':
          if (msg.run) syncVoiceRun(msg.run);
          else if (voiceRuntime.currentRun && msg.action) {
            const actions = Array.isArray(voiceRuntime.currentRun.actions) ? voiceRuntime.currentRun.actions.slice() : [];
            const existing = actions.findIndex((entry) => entry.id === msg.action.id);
            if (existing >= 0) actions[existing] = msg.action;
            else actions.push(msg.action);
            voiceRuntime.currentRun = { ...voiceRuntime.currentRun, actions, status: 'awaiting_approval' };
            voiceRuntime.pendingActionIds = actions.filter((entry) => String(entry?.status || '') === 'requires_approval').map((entry) => String(entry.id || ''));
            renderVoiceRunPanel();
          }
          setState('approval');
          appendChatMessage('assistant', `Approval needed: ${msg.action?.title || 'A pending action requires approval.'}`);
          break;
        case 'voice.action.resolved':
          syncVoiceRun(msg.run);
          if (state !== 'speaking') setState('running');
          break;
        case 'response.done':
          setTimeout(() => {
            if (state === 'speaking') {
              if (voiceRuntime.pendingActionIds.length) setState('approval');
              else if (voiceRuntime.currentRun && ['running', 'awaiting_approval'].includes(String(voiceRuntime.currentRun.status || ''))) setState('running');
              else setState('ready');
            }
          }, 500);
          break;
        case 'error':
          if (!sessionReady) {
            fail(msg.error?.message || 'Realtime error');
            return;
          }
          surfaceVoiceFailure(msg.error?.message || 'Realtime error', { disconnectLabel: 'Voice issue', delayMs: 900 })
            .finally(() => {
              recoverVoiceStateAfterError();
            });
          break;
      }
    };
    ws.onclose = (event) => {
      clearTimeout(timeout);
      wsSessionReady = false;
      if (!sessionReady) {
        fail(event.reason || 'Voice session closed before startup');
        return;
      }
      if (isActive) stop();
    };
    ws.onerror = () => {
      fail('WebSocket failed — check voice service configuration');
    };
  });
}

function playAudioDelta(base64) {
  if (!speakerNode || !base64) return;
  if (audioCtx && audioCtx.state !== 'running') audioCtx.resume().catch(() => {});
  const pcm16 = base64ToInt16(base64);
  const float32 = new Float32Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF);
  speakerNode.port.postMessage({ type: 'audio-data', float32: float32.buffer }, [float32.buffer]);
}

/* ══════════════════════════════════════════════════════════
   Floating Orb — Wireframe Mesh Sphere (sci-fi style)
   Rendered with canvas, lives inside #chatMsgs, draggable
   ══════════════════════════════════════════════════════════ */

/* Pre-compute 10 000 points on a unit sphere via Fibonacci (golden-angle) distribution.
   This gives perceptually uniform coverage without polar clustering. */
const PARTICLE_COUNT = 10000;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const SPHERE_PTS = (function buildFibonacciSphere() {
  const pts = new Float32Array(PARTICLE_COUNT * 3);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = GOLDEN_ANGLE * i;
    pts[i * 3]     = Math.cos(theta) * r;  // x
    pts[i * 3 + 1] = y;                    // y
    pts[i * 3 + 2] = Math.sin(theta) * r;  // z
  }
  return pts;
})();

function createOrb() {
  destroyOrb();
  const host = currentOrbHost();
  if (!host) return;
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  orbWrap = document.createElement('div');
  orbWrap.className = 'vc-orb-wrap';
  orbWrap.style.width = ORB_DISPLAY + 'px';
  orbWrap.style.height = ORB_DISPLAY + 'px';

  const dpr = devicePixelRatio;
  orbCanvas = document.createElement('canvas');
  orbCanvas.className = 'vc-orb-canvas';
  orbCanvas.width = ORB_RENDER * dpr;
  orbCanvas.height = ORB_RENDER * dpr;
  orbCanvas.style.width = ORB_DISPLAY + 'px';
  orbCanvas.style.height = ORB_DISPLAY + 'px';
  orbCtx = orbCanvas.getContext('2d');

  orbLabel = document.createElement('div');
  orbLabel.className = 'vc-orb-label';
  orbLabel.textContent = 'Connecting';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'vc-orb-close';
  closeBtn.textContent = '\u2715';
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); stop(); });

  const txWrap = document.createElement('div');
  txWrap.className = 'vc-orb-tx';
  userTxEl = document.createElement('div');
  userTxEl.className = 'vc-orb-tx-user';
  aiTxEl = document.createElement('div');
  aiTxEl.className = 'vc-orb-tx-ai';
  txWrap.appendChild(userTxEl);
  txWrap.appendChild(aiTxEl);

  runPanelEl = document.createElement('div');
  runPanelEl.className = 'vc-run-panel';
  runPanelEl.innerHTML = `
    <div class="vc-run-head">
      <div class="vc-run-kicker">Voice Agent</div>
      <div class="vc-run-model"></div>
    </div>
    <div class="vc-run-title"></div>
    <div class="vc-run-list"></div>
    <div class="vc-approval-list"></div>
  `;
  runModelEl = runPanelEl.querySelector('.vc-run-model');
  runTitleEl = runPanelEl.querySelector('.vc-run-title');
  runListEl = runPanelEl.querySelector('.vc-run-list');
  approvalListEl = runPanelEl.querySelector('.vc-approval-list');

  orbWrap.appendChild(orbCanvas);
  orbWrap.appendChild(orbLabel);
  orbWrap.appendChild(closeBtn);
  orbWrap.appendChild(txWrap);
  orbWrap.appendChild(runPanelEl);
  host.appendChild(orbWrap);
  voiceRuntime.selectedCodingModel = getSelectedCodingModel();
  renderVoiceRunPanel();
  syncOrbMount();
  if (!isActive) {
    userTranscript = '';
    aiTranscript = '';
    if (userTxEl) userTxEl.textContent = '';
    if (aiTxEl) aiTxEl.textContent = '';
  }

  /* Drag */
  orbWrap.addEventListener('pointerdown', onDragStart);
  const escH = (e) => { if (e.key === 'Escape') { stop(); document.removeEventListener('keydown', escH); } };
  document.addEventListener('keydown', escH);

  startVisualization();
}

function onDragStart(e) {
  if (e.target.closest('.vc-orb-close') || e.target.closest('.vc-approval-actions') || e.target.closest('.vc-run-panel button')) return;
  isDragging = true;
  orbInteraction.pointerId = e.pointerId;
  orbInteraction.lastX = e.clientX;
  orbInteraction.lastY = e.clientY;
  orbWrap.classList.add('dragging');
  orbWrap.setPointerCapture(e.pointerId);
  orbWrap.addEventListener('pointermove', onDragMove);
  orbWrap.addEventListener('pointerup', onDragEnd);
  orbWrap.addEventListener('pointercancel', onDragEnd);
}
function onDragMove(e) {
  if (!isDragging || !orbWrap || e.pointerId !== orbInteraction.pointerId) return;
  const dx = e.clientX - orbInteraction.lastX;
  const dy = e.clientY - orbInteraction.lastY;
  orbInteraction.lastX = e.clientX;
  orbInteraction.lastY = e.clientY;
  orbInteraction.targetYaw += dx * 0.014;
  orbInteraction.targetPitch += dy * 0.01;
  orbInteraction.targetPitch = Math.max(-1.1, Math.min(1.1, orbInteraction.targetPitch));
}
function onDragEnd(e) {
  if (e?.pointerId != null && e.pointerId !== orbInteraction.pointerId) return;
  isDragging = false;
  orbInteraction.pointerId = null;
  orbWrap?.classList.remove('dragging');
  orbWrap?.removeEventListener('pointermove', onDragMove);
  orbWrap?.removeEventListener('pointerup', onDragEnd);
  orbWrap?.removeEventListener('pointercancel', onDragEnd);
}

function destroyOrb() {
  if (orbWrap) orbWrap.remove();
  orbWrap = null; orbCanvas = null; orbCtx = null; orbLabel = null; userTxEl = null; aiTxEl = null;
  runPanelEl = null; runTitleEl = null; runModelEl = null; runListEl = null; approvalListEl = null;
}

/* ══════════════════════════════════════════════════════════
   Visualization: Exploding Shell — 10 000 Fibonacci particles
   - Particles erupt outward per-frequency-bin on audio input
   - Quadratic eruption response: quiet = tight sphere, loud = explosive
   - Back-hemisphere visible at low alpha (depth transparency)
   ══════════════════════════════════════════════════════════ */
function startVisualization() {
  let t = 0;

  /* Per-particle random phase and eruption sensitivity (set once, reused every frame) */
  const phase       = new Float32Array(PARTICLE_COUNT);
  const sensitivity = new Float32Array(PARTICLE_COUNT);
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    phase[i]       = Math.random() * Math.PI * 2;
    sensitivity[i] = 0.4 + Math.random() * 0.6;
  }

  /* Smoothed amplitude — snappy attack, slow decay */
  let smoothEnergy = 0;

  function draw() {
    if (!orbCtx || !orbCanvas) return;
    animFrame = requestAnimationFrame(draw);
    t += 0.012;

    const dpr = devicePixelRatio;
    const W  = ORB_RENDER;
    const H  = ORB_RENDER;
    const CX = W / 2;
    const CY = H / 2;

    orbCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    orbCtx.clearRect(0, 0, W, H);

    /* ── Read live frequency data from AnalyserNode ── */
    const analyser = (state === 'speaking') ? analyserOut : analyserMic;
    let rawEnergy = 0;
    let freqData  = null;
    if (analyser) {
      const bufLen = analyser.frequencyBinCount;
      freqData = new Uint8Array(bufLen);
      analyser.getByteFrequencyData(freqData);
      let sum = 0;
      for (let i = 0; i < bufLen; i++) sum += freqData[i];
      rawEnergy = Math.min(1, (sum / bufLen / 255) * 4.0);
    }
    /* Fallback breathing when no audio context */
    if (state === 'connecting') rawEnergy = 0.15 + Math.sin(t * 2.0) * 0.08;
    if (!isActive || state === 'idle') rawEnergy = 0.05 + Math.sin(t * 1.4) * 0.025;
    if (state === 'ready') rawEnergy = 0.06 + Math.sin(t * 0.9) * 0.025;

    /* Snappy attack, slow decay — eruptions feel crisp */
    const lerpSpeed = rawEnergy > smoothEnergy ? 0.22 : 0.045;
    smoothEnergy += (rawEnergy - smoothEnergy) * lerpSpeed;

    const pal     = PALETTES[state] || PALETTES.connecting;
    const BASE_R  = 108;
    const sphereR = BASE_R + smoothEnergy * 18;

    /* ── Rotation (auto + drag interaction) ── */
    orbInteraction.yaw   += (orbInteraction.targetYaw   - orbInteraction.yaw)   * 0.18;
    orbInteraction.pitch += (orbInteraction.targetPitch - orbInteraction.pitch) * 0.18;
    const rotY = t * 0.22 + orbInteraction.yaw;
    const rotX = t * 0.11 + 0.3 + orbInteraction.pitch;
    const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
    const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

    /* ── Ambient halo glow — grows with energy ── */
    const haloR    = sphereR * (1.5 + smoothEnergy * 0.7);
    const haloGrad = orbCtx.createRadialGradient(CX, CY, sphereR * 0.3, CX, CY, haloR);
    haloGrad.addColorStop(0,   `rgba(${pal.r},${pal.g},${pal.b},${0.16 + smoothEnergy * 0.2})`);
    haloGrad.addColorStop(0.5, `rgba(${pal.r},${pal.g},${pal.b},${0.04 + smoothEnergy * 0.06})`);
    haloGrad.addColorStop(1,   'rgba(0,0,0,0)');
    orbCtx.beginPath();
    orbCtx.arc(CX, CY, haloR, 0, Math.PI * 2);
    orbCtx.fillStyle = haloGrad;
    orbCtx.fill();

    /* ── Project & draw all 10 000 particles ── */
    const freqBins = freqData ? freqData.length : 0;
    const freqStep = freqBins > 0 ? freqBins / PARTICLE_COUNT : 0;

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const bx = SPHERE_PTS[i * 3];
      const by = SPHERE_PTS[i * 3 + 1];
      const bz = SPHERE_PTS[i * 3 + 2];

      /* Each particle owns a frequency bin — direct per-particle audio drive */
      const freqVal = freqBins > 0
        ? freqData[Math.min(freqBins - 1, (i * freqStep) | 0)] / 255
        : 0;

      /* Quadratic eruption: barely moves at low amp, explosive at high amp */
      const eruptBase = smoothEnergy * smoothEnergy;
      const eruption  = eruptBase * sensitivity[i] * (0.5 + 0.5 * Math.abs(Math.sin(phase[i] * 1.7 + t * 3.5)))
                      + freqVal * smoothEnergy * 0.18;

      /* Gentle surface wave at rest */
      const wave = 0.012 * Math.sin(phase[i] + t * 1.6)
                 + 0.008 * Math.sin(phase[i] * 1.4 + t * 2.3);

      const r = sphereR * (1 + wave + eruption * 0.55);

      let x = bx * r, y = by * r, z = bz * r;

      /* Rotate Y */
      const x1 =  x * cosY - z * sinY;
      const z1 =  x * sinY + z * cosY;
      /* Rotate X */
      const y2 =  y * cosX - z1 * sinX;
      const z2 =  y * sinX + z1 * cosX;

      /* Depth 0=back, 1=front */
      const depth = (z2 + sphereR * 1.4) / (sphereR * 2.8);

      /* Back hemisphere faintly visible — gives the "see-through sphere" look */
      const eruptGlow  = eruption * 0.75;
      const alphaBase  = depth < 0.5
        ? 0.06 + depth * 0.18 + eruptGlow * 0.5
        : 0.15 + (depth - 0.5) * 0.85 + eruptGlow * 0.3;
      const alpha = Math.min(0.95, alphaBase * (0.45 + smoothEnergy * 1.0));

      /* Erupted particles get larger dots */
      const dotR = 0.5 + depth * 1.1 + eruption * sphereR * 0.045 + freqVal * smoothEnergy * 1.5;

      /* Erupted particles shift toward secondary (brighter) palette color */
      const colorShift = Math.min(1, depth + eruption * 0.8);
      const cr = (pal.r  + (pal.r2  - pal.r)  * colorShift) | 0;
      const cg = (pal.g  + (pal.g2  - pal.g)  * colorShift) | 0;
      const cb = (pal.b  + (pal.b2  - pal.b)  * colorShift) | 0;

      orbCtx.beginPath();
      orbCtx.arc(CX + x1, CY + y2, Math.max(0.3, dotR), 0, Math.PI * 2);
      orbCtx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(2)})`;
      orbCtx.fill();
    }

    /* ── Inner core glow ── */
    const coreGrad = orbCtx.createRadialGradient(CX, CY, 0, CX, CY, sphereR * 0.5);
    coreGrad.addColorStop(0, `rgba(${pal.r2},${pal.g2},${pal.b2},${0.2 + smoothEnergy * 0.22})`);
    coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
    orbCtx.beginPath();
    orbCtx.arc(CX, CY, sphereR * 0.5, 0, Math.PI * 2);
    orbCtx.fillStyle = coreGrad;
    orbCtx.fill();

    /* ── Outer bloom ring ── */
    orbCtx.beginPath();
    orbCtx.arc(CX, CY, sphereR + 2, 0, Math.PI * 2);
    orbCtx.strokeStyle = `rgba(${pal.r2},${pal.g2},${pal.b2},${0.1 + smoothEnergy * 0.16})`;
    orbCtx.lineWidth = 2.5;
    orbCtx.stroke();
  }

  draw();
}

/* ── Helpers ── */
function arrayBufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToInt16(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
