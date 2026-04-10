/* Mesh Feature: Checkpoint / Snapshot System for AI Edits Rollback */
(function(){
const style = document.createElement('style');
style.textContent = `
.cp-panel { padding: 8px; }
.cp-list { display: flex; flex-direction: column; gap: 4px; }
.cp-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; background: #1e1e2e; border: 1px solid #2a2a2a; border-radius: 6px; cursor: pointer; font-size: 12px; color: #ccc; }
.cp-item:hover { border-color: #444; background: #222; }
.cp-item.active { border-color: var(--ac, #0098ff); background: rgba(0,152,255,0.06); }
.cp-time { font-size: 10px; color: #666; font-family: 'JetBrains Mono', monospace; }
.cp-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cp-actions { display: flex; gap: 4px; }
.cp-actions button { font-size: 10px; padding: 2px 6px; border-radius: 3px; border: 1px solid #444; background: #2a2a2a; color: #aaa; cursor: pointer; }
.cp-actions button:hover { background: #333; color: #eee; }
.cp-actions button.restore { border-color: #2ea043; color: #2ea043; }
.cp-actions button.restore:hover { background: #2ea043; color: #fff; }
.cp-actions button.del { border-color: #f85149; color: #f85149; }
.cp-actions button.del:hover { background: #f85149; color: #fff; }
.cp-empty { text-align: center; padding: 24px; color: #555; font-size: 12px; }
.cp-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.cp-header-title { font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; }
.cp-create-btn { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid var(--ac, #0098ff); color: var(--ac); background: none; cursor: pointer; }
.cp-create-btn:hover { background: var(--ac); color: #fff; }
.cp-diff-count { font-size: 10px; background: #333; color: #888; padding: 1px 5px; border-radius: 3px; }
`;
document.head.appendChild(style);

const STORAGE_KEY = 'mesh-checkpoints';
let checkpoints = [];

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  loadCheckpoints();

  /* Auto-checkpoint before AI edits */
  if (window.MeshBus) {
    window.MeshBus.on('ai:before-edit', (data) => {
      createCheckpoint('Before AI edit' + (data?.description ? ': ' + data.description : ''), true);
    });
    window.MeshBus.on('chat:response', (data) => {
      if (data?.hasEdits) {
        createCheckpoint('After AI response', true);
      }
    });
  }

  /* Inject checkpoint panel into sidebar */
  injectPanel();
}

function loadCheckpoints() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) checkpoints = JSON.parse(stored);
  } catch { checkpoints = []; }
}

function saveCheckpoints() {
  try {
    /* Keep max 50 checkpoints */
    if (checkpoints.length > 50) checkpoints = checkpoints.slice(-50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(checkpoints));
  } catch { /* storage full */ }
}

async function createCheckpoint(label, auto) {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S) return;

  /* Snapshot all open tab contents */
  const files = {};
  for (const tab of S.tabs) {
    if (tab.model) {
      files[tab.path] = tab.model.getValue();
    } else if (tab.content) {
      files[tab.path] = tab.content;
    }
  }

  const cp = {
    id: 'cp-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    label: label || 'Checkpoint',
    timestamp: Date.now(),
    auto: !!auto,
    fileCount: Object.keys(files).length,
    files,
  };

  checkpoints.push(cp);
  saveCheckpoints();
  render();

  if (!auto) A?.toast?.('Checkpoint', 'Created: ' + label);
  return cp;
}

async function restoreCheckpoint(cpId) {
  const S = window.MeshState;
  const A = window.MeshActions;
  const api = window.MeshAPI;
  if (!S || !A) return;

  const cp = checkpoints.find(c => c.id === cpId);
  if (!cp) return;

  /* Create a checkpoint of current state before restore */
  await createCheckpoint('Before restore to: ' + cp.label, true);

  /* Restore file contents */
  for (const [path, content] of Object.entries(cp.files)) {
    /* Update open tabs */
    const tab = S.tabs.find(t => t.path === path);
    if (tab?.model) {
      tab.model.setValue(content);
    }

    /* Write back to server */
    if (api) {
      try {
        await api('/api/assistant/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path, content }),
        });
      } catch { /* best effort */ }
    }
  }

  A.toast('Checkpoint', 'Restored: ' + cp.label);
  render();
}

function deleteCheckpoint(cpId) {
  checkpoints = checkpoints.filter(c => c.id !== cpId);
  saveCheckpoints();
  render();
}

function injectPanel() {
  /* Add checkpoint tab to activity bar or bottom panel */
  const bpTabs = document.querySelector('.bp-tabs');
  if (bpTabs && !document.querySelector('[data-bp="checkpoints"]')) {
    const tab = document.createElement('button');
    tab.className = 'bp-tab';
    tab.dataset.bp = 'checkpoints';
    tab.textContent = 'CHECKPOINTS';
    tab.addEventListener('click', () => {
      document.querySelectorAll('.bp-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      document.querySelectorAll('.bp-content').forEach(c => c.style.display = 'none');
      let panel = document.querySelector('.bp-content[data-bp="checkpoints"]');
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'bp-content';
        panel.dataset.bp = 'checkpoints';
        const bpBody = document.querySelector('.bp-body');
        if (bpBody) bpBody.appendChild(panel);
        else bpTabs.parentElement.appendChild(panel);
      }
      panel.style.display = 'block';
      render();
    });
    bpTabs.appendChild(tab);
  }
  render();
}

function render() {
  let panel = document.querySelector('.bp-content[data-bp="checkpoints"]');
  if (!panel) return;

  if (!checkpoints.length) {
    panel.innerHTML = '<div class="cp-panel"><div class="cp-header"><span class="cp-header-title">Checkpoints</span><button class="cp-create-btn" id="cpCreate">+ Create</button></div><div class="cp-empty">No checkpoints yet. Checkpoints are created automatically before AI edits.</div></div>';
    panel.querySelector('#cpCreate')?.addEventListener('click', () => createCheckpoint('Manual checkpoint'));
    return;
  }

  let html = '<div class="cp-panel"><div class="cp-header"><span class="cp-header-title">Checkpoints (' + checkpoints.length + ')</span><button class="cp-create-btn" id="cpCreate">+ Create</button></div><div class="cp-list">';

  const sorted = [...checkpoints].reverse();
  for (const cp of sorted) {
    const time = formatTime(cp.timestamp);
    html += `<div class="cp-item" data-id="${cp.id}">
      <span class="cp-time">${time}</span>
      <span class="cp-label">${esc(cp.label)}</span>
      <span class="cp-diff-count">${cp.fileCount} files</span>
      <div class="cp-actions">
        <button class="restore" data-id="${cp.id}">Restore</button>
        <button class="del" data-id="${cp.id}">✕</button>
      </div>
    </div>`;
  }
  html += '</div></div>';
  panel.innerHTML = html;

  panel.querySelector('#cpCreate')?.addEventListener('click', () => createCheckpoint('Manual checkpoint'));
  panel.querySelectorAll('.restore').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); restoreCheckpoint(btn.dataset.id); });
  });
  panel.querySelectorAll('.del').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteCheckpoint(btn.dataset.id); });
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* Expose for other features */
window.MeshCheckpoints = { createCheckpoint, restoreCheckpoint };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
