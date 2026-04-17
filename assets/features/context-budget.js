/* Mesh Feature: Context Budget Visualizer */
(function(){
const style = document.createElement('style');
style.textContent = `
.cb-widget { display: flex; align-items: center; gap: 6px; padding: 0 8px; cursor: pointer; height: 100%; }
.cb-bar { width: 60px; height: 6px; background: var(--bg3, #2d2d2d); border-radius: 3px; overflow: hidden; position: relative; }
.cb-fill { height: 100%; border-radius: 3px; transition: width 0.3s, background 0.3s; }
.cb-fill.low { background: var(--grn, #4ec9b0); }
.cb-fill.mid { background: var(--org, #cca700); }
.cb-fill.high { background: var(--red, #f14c4c); }
.cb-label { font-size: 10px; color: var(--tx3, #777); font-family: var(--m, 'JetBrains Mono', monospace); }
.cb-popup { position: fixed; z-index: 9998; bottom: 28px; right: 12px; background: var(--bg2, #252526); border: 1px solid var(--bd, #3c3c3c); border-radius: 8px; width: 320px; padding: 12px; font-size: 12px; color: var(--tx, #ccc); box-shadow: 0 -4px 16px rgba(0,0,0,.5); font-family: var(--f); }
.cb-popup h4 { margin: 0 0 8px; font-size: 13px; color: var(--txw, #fff); }
.cb-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid var(--bg3, #2d2d2d); }
.cb-row:last-child { border-bottom: none; }
.cb-row-label { color: var(--tx, #ccc); }
.cb-row-val { color: var(--ac, #0098ff); font-family: var(--m, monospace); }
.cb-section { margin-top: 8px; }
.cb-section-title { font-size: 11px; color: var(--tx3, #777); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 4px; }
.cb-file-row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 11px; }
.cb-file-row .name { color: var(--tx, #ccc); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px; }
.cb-file-row .tokens { color: var(--tx3, #777); font-family: var(--m, monospace); }
`;
document.head.appendChild(style);

/**
 * Model context window sizes.
 * The key is matched as a substring against the model selector value.
 */
const MODEL_CONTEXT_WINDOWS = {
  'gpt-5.4-mini':        128000,
  'gpt-5.4':             128000,
  'gpt-4o':              128000,
  'gpt-4':               128000,
  'claude-opus-4-6':     200000,
  'claude-opus-4-5':     200000,
  'claude-sonnet-4-6':   200000,
  'claude-sonnet-4-5':   200000,
  'claude-haiku-4-5':    200000,
  'claude-3.5-sonnet':   200000,
  'claude-3-opus':       200000,
  'o1':                  200000,
  'o1-mini':             128000,
  'o3':                  200000,
  'o3-mini':             200000,
  'o4-mini':             200000,
};
const DEFAULT_CONTEXT_WINDOW = 128000;

let popupEl = null;
let budgetData = { used: 0, limit: DEFAULT_CONTEXT_WINDOW, files: [], chatTokens: 0, capsuleTokens: 0, systemTokens: 0 };

function getActiveModelLimit() {
  const sel = document.querySelector('#chatModel');
  if (!sel) return DEFAULT_CONTEXT_WINDOW;
  const val = sel.value || '';
  for (const [key, limit] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (val.includes(key)) return limit;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Create status bar widget */
  const statusRight = document.querySelector('.stb-r');
  if (statusRight) {
    const widget = document.createElement('div');
    widget.className = 'cb-widget';
    widget.id = 'ctxBudget';
    widget.innerHTML = `
      <span class="cb-label" id="cbLabel">0k / 128k</span>
      <div class="cb-bar"><div class="cb-fill low" id="cbFill" style="width:0%"></div></div>
    `;
    widget.addEventListener('click', togglePopup);
    statusRight.prepend(widget);
  }

  /* Update limit when model selector changes */
  const modelSel = document.querySelector('#chatModel');
  if (modelSel) {
    modelSel.addEventListener('change', () => {
      budgetData.limit = getActiveModelLimit();
      recalc();
    });
    budgetData.limit = getActiveModelLimit();
    recalc();
  }

  /* Listen for chat events to update budget */
  if (window.MeshBus) {
    window.MeshBus.on('chat:response', (data) => {
      if (data?.usage) updateFromUsage(data.usage);
    });
    window.MeshBus.on('chat:transport', (data) => {
      if (data?.contextInfo) updateFromContext(data.contextInfo);
    });
  }

  /* Poll for capsule context info */
  setInterval(fetchBudget, 10000);
  setTimeout(fetchBudget, 3000);
}

async function fetchBudget() {
  const api = window.MeshAPI;
  if (!api || !window.MeshState?.dirName) return;

  try {
    const res = await api('/api/assistant/workspace/context-budget');
    if (res) {
      /* Let the model selector drive the limit, only use server value as fallback */
      budgetData.capsuleTokens = res.capsuleTokens || res.indexTokens || 0;
      budgetData.systemTokens = res.systemTokens || 0;
      if (res.files) budgetData.files = res.files;
      budgetData.limit = getActiveModelLimit();
      recalc();
    }
  } catch { /* endpoint may not exist yet */ }
}

function updateFromUsage(usage) {
  if (usage.input_tokens) budgetData.used = usage.input_tokens;
  if (usage.cache_creation_input_tokens) budgetData.cachedTokens = usage.cache_creation_input_tokens;
  recalc();
}

function updateFromContext(info) {
  if (info.capsuleTokens) budgetData.capsuleTokens = info.capsuleTokens;
  if (info.chatTokens) budgetData.chatTokens = info.chatTokens;
  if (info.files) budgetData.files = info.files;
  recalc();
}

function recalc() {
  const total = budgetData.used || (budgetData.capsuleTokens + budgetData.chatTokens + budgetData.systemTokens);
  const limit = budgetData.limit || DEFAULT_CONTEXT_WINDOW;
  const pct = Math.min(100, (total / limit) * 100);

  const label = document.querySelector('#cbLabel');
  const fill = document.querySelector('#cbFill');
  if (label) label.textContent = fmtK(total) + ' / ' + fmtK(limit);
  if (fill) {
    fill.style.width = pct + '%';
    fill.className = 'cb-fill ' + (pct < 50 ? 'low' : pct < 80 ? 'mid' : 'high');
  }

  /* Update popup if open */
  if (popupEl) renderPopup();
}

function togglePopup() {
  if (popupEl) { closePopup(); return; }
  popupEl = document.createElement('div');
  popupEl.className = 'cb-popup';
  document.body.appendChild(popupEl);
  renderPopup();

  const close = (e) => {
    if (popupEl && !popupEl.contains(e.target) && !e.target.closest('#ctxBudget')) {
      closePopup();
      document.removeEventListener('click', close);
    }
  };
  setTimeout(() => document.addEventListener('click', close), 0);
}

function renderPopup() {
  if (!popupEl) return;
  const total = budgetData.used || (budgetData.capsuleTokens + budgetData.chatTokens + budgetData.systemTokens);
  const limit = budgetData.limit || DEFAULT_CONTEXT_WINDOW;
  const pct = Math.min(100, (total / limit) * 100);

  const modelSel = document.querySelector('#chatModel');
  const modelName = modelSel?.selectedOptions?.[0]?.textContent || modelSel?.value || 'Unknown';

  let html = `<h4>Context Budget</h4>`;
  html += `<div class="cb-row"><span class="cb-row-label">Model</span><span class="cb-row-val">${esc(modelName)}</span></div>`;
  html += `<div class="cb-row"><span class="cb-row-label">Total Used</span><span class="cb-row-val">${fmtK(total)} tokens (${pct.toFixed(0)}%)</span></div>`;
  html += `<div class="cb-row"><span class="cb-row-label">Context Window</span><span class="cb-row-val">${fmtK(limit)} tokens</span></div>`;
  html += `<div class="cb-row"><span class="cb-row-label">Capsule Context</span><span class="cb-row-val">${fmtK(budgetData.capsuleTokens)}</span></div>`;
  html += `<div class="cb-row"><span class="cb-row-label">Chat History</span><span class="cb-row-val">${fmtK(budgetData.chatTokens)}</span></div>`;
  html += `<div class="cb-row"><span class="cb-row-label">System Prompt</span><span class="cb-row-val">${fmtK(budgetData.systemTokens)}</span></div>`;

  if (budgetData.files?.length) {
    html += `<div class="cb-section"><div class="cb-section-title">Top Files by Token Cost</div>`;
    const top = budgetData.files.slice(0, 8);
    for (const f of top) {
      const name = (f.path || f.name || '').split('/').pop();
      html += `<div class="cb-file-row"><span class="name" title="${esc(f.path || f.name)}">${esc(name)}</span><span class="tokens">${fmtK(f.tokens || f.tokenCount || 0)}</span></div>`;
    }
    html += '</div>';
  }

  popupEl.innerHTML = html;
}

function closePopup() {
  if (popupEl) { popupEl.remove(); popupEl = null; }
}

function fmtK(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1) + 'k';
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
