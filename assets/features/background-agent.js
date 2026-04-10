/* Mesh Feature: Background Autonomous AI Agent Mode */
(function(){
const style = document.createElement('style');
style.textContent = `
.ba-bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--bg2, #252526); border-bottom: 1px solid var(--bd, #3c3c3c); font-size: 12px; color: var(--tx, #ccc); font-family: var(--f, 'Inter', system-ui, sans-serif); }
.ba-bar.running { border-bottom-color: var(--grn, #4ec9b0); background: var(--bg3, #2d2d2d); }
.ba-status { display: flex; align-items: center; gap: 6px; }
.ba-dot { width: 8px; height: 8px; border-radius: 50%; }
.ba-dot.idle { background: var(--tx3, #777); }
.ba-dot.running { background: var(--grn, #4ec9b0); animation: ba-pulse 1.5s infinite; }
.ba-dot.error { background: var(--red, #f14c4c); }
@keyframes ba-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.ba-task { flex: 1; font-size: 11px; color: var(--tx3, #777); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ba-actions { display: flex; gap: 4px; }
.ba-actions button { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--bd, #3c3c3c); background: var(--bg4, #313131); color: var(--tx, #ccc); cursor: pointer; font-family: var(--f); }
.ba-actions button:hover { background: var(--bg3, #2d2d2d); border-color: var(--bdhov, #505050); }
.ba-actions button.stop { border-color: var(--red, #f14c4c); color: var(--red); }
.ba-actions button.stop:hover { background: var(--red); color: #fff; }
.ba-actions button.start { border-color: var(--ac, #0098ff); color: var(--ac); }
.ba-actions button.start:hover { background: var(--ac); color: #fff; }
.ba-log { max-height: 200px; overflow-y: auto; padding: 6px 12px; font-size: 11px; font-family: var(--m, 'JetBrains Mono', monospace); color: var(--tx3, #777); background: var(--bg5, #181818); border-bottom: 1px solid var(--bd, #3c3c3c); }
.ba-log-entry { padding: 2px 0; border-bottom: 1px solid var(--bg3, #2d2d2d); }
.ba-log-entry .time { color: var(--tx3, #777); margin-right: 8px; }
.ba-log-entry .action { color: var(--ac, #0098ff); }
.ba-log-entry .result { color: var(--grn, #4ec9b0); }
.ba-log-entry .err { color: var(--red, #f14c4c); }
`;
document.head.appendChild(style);

let agentState = 'idle'; // idle | running | paused | error
let currentTask = '';
let logs = [];
let abortController = null;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Add agent toggle to chat header */
  const chatHeader = document.querySelector('.chat-hdr');
  if (chatHeader) {
    const btn = document.createElement('button');
    btn.id = 'baToggle';
    btn.style.cssText = 'background:none;border:1px solid var(--bd,#3c3c3c);color:var(--tx3,#777);padding:2px 8px;border-radius:4px;cursor:pointer;font-size:11px;margin-left:auto;font-family:var(--f);';
    btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px;margin-right:4px"><circle cx="12" cy="12" r="10"/><path d="M8 12h.01M12 12h.01M16 12h.01"/></svg>Agent';
    btn.addEventListener('click', toggleAgentPanel);
    chatHeader.appendChild(btn);
  }
}

function toggleAgentPanel() {
  let bar = document.querySelector('#baBar');
  let log = document.querySelector('#baLog');

  if (bar) {
    bar.remove();
    if (log) log.remove();
    return;
  }

  const chatPanel = document.querySelector('#chatPanel');
  const chatMsgs = document.querySelector('#chatMsgs');
  if (!chatPanel || !chatMsgs) return;

  /* Agent bar */
  bar = document.createElement('div');
  bar.id = 'baBar';
  bar.className = 'ba-bar' + (agentState === 'running' ? ' running' : '');
  renderBar(bar);
  chatPanel.insertBefore(bar, chatMsgs);

  /* Agent log */
  log = document.createElement('div');
  log.id = 'baLog';
  log.className = 'ba-log';
  log.style.display = 'none';
  chatPanel.insertBefore(log, chatMsgs);
}

function renderBar(bar) {
  if (!bar) bar = document.querySelector('#baBar');
  if (!bar) return;

  const dotClass = agentState === 'running' ? 'running' : agentState === 'error' ? 'error' : 'idle';
  const statusText = agentState === 'running' ? 'Running' : agentState === 'paused' ? 'Paused' : agentState === 'error' ? 'Error' : 'Idle';

  bar.innerHTML = `
    <div class="ba-status"><span class="ba-dot ${dotClass}"></span><span>${statusText}</span></div>
    <span class="ba-task">${currentTask ? esc(currentTask) : 'No active task'}</span>
    <div class="ba-actions">
      <button id="baLogToggle">Log</button>
      ${agentState === 'running' ? '<button class="stop" id="baStop">Stop</button>' : '<button class="start" id="baStart">Start</button>'}
    </div>
  `;

  bar.querySelector('#baLogToggle')?.addEventListener('click', () => {
    const log = document.querySelector('#baLog');
    if (log) {
      log.style.display = log.style.display === 'none' ? 'block' : 'none';
      renderLog();
    }
  });

  bar.querySelector('#baStart')?.addEventListener('click', startAgent);
  bar.querySelector('#baStop')?.addEventListener('click', stopAgent);
}

async function startAgent() {
  const chatIn = document.querySelector('#chatIn');
  const task = chatIn?.value?.trim();
  if (!task) {
    window.MeshActions?.toast?.('Agent', 'Enter a task in the chat input first');
    return;
  }

  agentState = 'running';
  currentTask = task;
  chatIn.value = '';
  abortController = new AbortController();

  addLog('action', 'Agent started: ' + task);
  renderBar();

  /* Create checkpoint before agent runs */
  if (window.MeshCheckpoints) {
    await window.MeshCheckpoints.createCheckpoint('Before agent: ' + task.slice(0, 40));
  }

  try {
    await runAgentLoop(task);
  } catch (e) {
    if (e.name !== 'AbortError') {
      agentState = 'error';
      addLog('err', 'Agent error: ' + e.message);
    }
  } finally {
    if (agentState === 'running') agentState = 'idle';
    abortController = null;
    renderBar();
  }
}

async function runAgentLoop(task) {
  const api = window.MeshAPI;
  const A = window.MeshActions;
  if (!api || !A) return;

  let iteration = 0;
  const maxIterations = 20;
  let context = task;

  while (iteration < maxIterations && agentState === 'running') {
    iteration++;
    addLog('action', `Step ${iteration}: Thinking...`);

    try {
      const res = await api('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an autonomous AI agent working on a codebase. Execute the task step by step. After each step, respond with either:\n1. A JSON block ```json\n{"action": "edit", "file": "path", "content": "..."}\n``` to edit a file\n2. A JSON block ```json\n{"action": "done", "summary": "..."}\n``` when the task is complete\n3. A JSON block ```json\n{"action": "think", "thought": "..."}\n``` to think about the next step\n\nAlways respond with exactly one action block.' },
            { role: 'user', content: context },
          ],
          agentMode: true,
        }),
        signal: abortController?.signal,
      });

      const reply = res?.reply || res?.content || res?.message || '';
      addLog('result', 'Response received');

      /* Parse action from response */
      const actionMatch = reply.match(/```json\s*\n([\s\S]*?)\n```/);
      if (actionMatch) {
        try {
          const action = JSON.parse(actionMatch[1]);

          if (action.action === 'done') {
            addLog('result', 'Task complete: ' + (action.summary || 'Done'));
            A.toast('Agent', 'Task complete');
            A.appendMsg('assistant', 'Agent completed: ' + (action.summary || task));
            agentState = 'idle';
            break;
          }

          if (action.action === 'edit' && action.file && action.content) {
            addLog('action', 'Editing: ' + action.file);
            await api('/api/assistant/workspace/file', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: action.file, content: action.content }),
            });
            addLog('result', 'File saved: ' + action.file);
            context = `File ${action.file} has been updated. Continue with the next step of: ${task}`;
          } else if (action.action === 'think') {
            addLog('action', 'Thinking: ' + (action.thought || '').slice(0, 100));
            context = `Continue. Your thought: "${action.thought}". Now take the next concrete action for: ${task}`;
          } else {
            context = `Your response didn't contain a valid action. Please respond with an edit, think, or done action for: ${task}`;
          }
        } catch {
          context = `Failed to parse your action JSON. Please try again with valid JSON for: ${task}`;
        }
      } else {
        /* No action block, treat as thinking and continue */
        addLog('action', 'No action block, prompting again');
        context = `You didn't include an action block. Respond with a JSON action block (edit/think/done) for: ${task}`;
      }

      renderLog();
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      addLog('err', 'Step failed: ' + e.message);
      context = `Error in last step: ${e.message}. Try a different approach for: ${task}`;
    }
  }

  if (iteration >= maxIterations && agentState === 'running') {
    addLog('err', 'Max iterations reached');
    A?.toast?.('Agent', 'Stopped after ' + maxIterations + ' iterations');
    agentState = 'idle';
  }
}

function stopAgent() {
  agentState = 'idle';
  if (abortController) abortController.abort();
  addLog('action', 'Agent stopped by user');
  renderBar();
  window.MeshActions?.toast?.('Agent', 'Stopped');
}

function addLog(type, message) {
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  logs.push({ type, message, time });
  if (logs.length > 200) logs.shift();
  renderLog();
}

function renderLog() {
  const logEl = document.querySelector('#baLog');
  if (!logEl || logEl.style.display === 'none') return;

  logEl.innerHTML = logs.map(l =>
    `<div class="ba-log-entry"><span class="time">${l.time}</span><span class="${l.type}">${esc(l.message)}</span></div>`
  ).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
