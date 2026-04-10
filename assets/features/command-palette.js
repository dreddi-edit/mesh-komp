/* Mesh Feature: Command Palette (Cmd+Shift+P) */
(function(){
const STORAGE_KEY = 'mesh-cmd-recent';

const style = document.createElement('style');
style.textContent = `
.cmd-overlay {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,0.45); display: none;
  align-items: flex-start; justify-content: center;
  padding-top: 18vh; backdrop-filter: blur(2px);
}
.cmd-overlay.open { display: flex; animation: cmd-fade-in 80ms ease-out; }
@keyframes cmd-fade-in { from { opacity: 0; } to { opacity: 1; } }
.cmd-box {
  width: 100%; max-width: 620px; background: #1e1e1e; border: 1px solid #333;
  border-radius: 10px; box-shadow: 0 16px 64px rgba(0,0,0,0.6); overflow: hidden;
}
.cmd-input-row { display: flex; align-items: center; padding: 0 16px; border-bottom: 1px solid #333; }
.cmd-input-row svg { flex-shrink: 0; opacity: 0.4; }
.cmd-input {
  flex: 1; background: none; border: none; color: #eee; font-size: 15px;
  padding: 14px 12px; outline: none; font-family: inherit;
}
.cmd-input::placeholder { color: #555; }
.cmd-list { max-height: 360px; overflow-y: auto; padding: 4px 0; }
.cmd-item {
  display: flex; align-items: center; gap: 10px; padding: 7px 16px;
  cursor: pointer; color: #ccc; font-size: 13px;
}
.cmd-item:hover, .cmd-item.active { background: #2a2d35; }
.cmd-item.active { background: var(--ac, #0098ff); color: #fff; }
.cmd-item .ci-icon { width: 22px; text-align: center; font-size: 15px; flex-shrink: 0; }
.cmd-item .ci-label { flex: 1; }
.cmd-item .ci-label b { color: var(--ac, #0098ff); }
.cmd-item.active .ci-label b { color: #fff; }
.cmd-item .ci-keys { font-size: 11px; opacity: 0.4; font-family: 'SF Mono', 'JetBrains Mono', monospace; }
.cmd-item.active .ci-keys { opacity: 0.7; }
.cmd-empty { padding: 20px; text-align: center; color: #555; font-size: 13px; }
`;
document.head.appendChild(style);

const overlay = document.createElement('div');
overlay.className = 'cmd-overlay';
overlay.innerHTML = `<div class="cmd-box">
  <div class="cmd-input-row">
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
    <input class="cmd-input" placeholder="Type a command..." autocomplete="off" spellcheck="false">
  </div>
  <div class="cmd-list"></div>
</div>`;
document.body.appendChild(overlay);

const input = overlay.querySelector('.cmd-input');
const list = overlay.querySelector('.cmd-list');
let commands = [];
let filtered = [];
let activeIdx = 0;

function init() {
  const A = window.MeshActions;
  const S = window.MeshState;

  commands = [
    { id:'open-folder', label:'Open Folder', icon:'\u25b7', keys:'', action(){ A?.openFolder(); }},
    { id:'refresh', label:'Refresh Explorer', icon:'\u21bb', keys:'', action(){ A?.refreshTree(); }},
    { id:'save', label:'Save File', icon:'\u2913', keys:'\u2318S', action(){ document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',metaKey:true})); }},
    { id:'close-tab', label:'Close Active Tab', icon:'\u2715', keys:'\u2318W', action(){ if(S?.activeTab) A?.closeTab(S.activeTab); }},
    { id:'toggle-sidebar', label:'Toggle Sidebar', icon:'\u2261', keys:'\u2318B', action(){ document.querySelector('#btnToggleSB')?.click(); }},
    { id:'toggle-chat', label:'Toggle Chat Panel', icon:'\u2192', keys:'', action(){ document.querySelector('#btnToggleChat')?.click(); }},
    { id:'toggle-term', label:'Toggle Terminal', icon:'\u276f', keys:'\u2318`', action(){ A?.toggleTerm(); }},
    { id:'settings', label:'Open Settings', icon:'\u2699', keys:'\u2318,', action(){ A?.openStandaloneSettings?.('account', { from: 'command-palette' }); }},
    { id:'ops', label:'Open Operations', icon:'\u2630', keys:'', action(){ A?.showView('ops'); }},
    { id:'graph', label:'Open Mesh Graph', icon:'\u25cc', keys:'', action(){ A?.showView('graph'); }},
    { id:'search', label:'Search in Files', icon:'\u2315', keys:'\u2318\u21e7F', action(){ A?.setPanel('search'); document.querySelector('#searchIn')?.focus(); }},
    { id:'explorer', label:'Show Explorer', icon:'\u25a1', keys:'\u2318\u21e7E', action(){ A?.setPanel('explorer'); }},
    { id:'scm', label:'Source Control', icon:'\u2387', keys:'\u2318\u21e7G', action(){ A?.setPanel('scm'); }},
    { id:'commit', label:'Git: Commit', icon:'\u2713', keys:'', action(){ document.querySelector('#btnCommit')?.click(); }},
    { id:'push', label:'Git: Push', icon:'\u2191', keys:'', action(){ document.querySelector('#btnPush')?.click(); }},
    { id:'pull', label:'Git: Pull', icon:'\u2193', keys:'', action(){ document.querySelector('#btnPull')?.click(); }},
    { id:'stage-all', label:'Git: Stage All', icon:'+', keys:'', action(){ window.MeshAPI?.('/api/assistant/git/stage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({files:[]})}); }},
    { id:'create-branch', label:'Git: Create Branch', icon:'\u2387', keys:'', action(){ const n=prompt('Branch name:');if(n)window.MeshAPI?.('/api/assistant/git/create-branch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:n})}); }},
    { id:'new-chat', label:'New Chat', icon:'+', keys:'', action(){ S.chat=[{role:'assistant',content:'New chat. How can I help?'}]; A?.renderChat(); }},
    { id:'ask-ai', label:'Ask AI', icon:'\u25cf', keys:'', action(){ document.querySelector('#chatIn')?.focus(); }},
    { id:'theme-dark', label:'Theme: Dark', icon:'\u25d1', keys:'', action(){ A?.applyTheme('dark'); }},
    { id:'theme-light', label:'Theme: Light', icon:'\u25d0', keys:'', action(){ A?.applyTheme('light'); }},
    { id:'copy-path', label:'Copy File Path', icon:'\u2398', keys:'', action(){ if(S?.activeTab) navigator.clipboard?.writeText(S.activeTab); A?.toast('Copied',''); }},
    { id:'goto-line', label:'Go to Line...', icon:'#', keys:'\u2318G', action(){ const n=prompt('Line number:');if(n&&S?.editor) S.editor.revealLineInCenter(parseInt(n)); }},
    { id:'marketplace', label:'Open Marketplace', icon:'\u229e', keys:'', action(){ A?.showView('marketplace'); }},
    { id:'minimap', label:'Toggle Minimap', icon:'\u2592', keys:'', action(){ if(S?.editor){ const on=S.editor.getOption(72);S.editor.updateOptions({minimap:{enabled:!on}}); }}},
    { id:'wordwrap', label:'Toggle Word Wrap', icon:'\u21a9', keys:'', action(){ if(S?.editor){ const cur=S.editor.getOption(133);S.editor.updateOptions({wordWrap:cur==='on'?'off':'on'}); }}},
    { id:'quick-open', label:'Quick Open File', icon:'\u25a1', keys:'\u2318P', action(){ if(window.MeshBus) window.MeshBus.emit('quick-open:open'); }},
  ];
}

function getRecent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function addRecent(id) {
  let r = getRecent().filter(x => x !== id);
  r.unshift(id);
  if (r.length > 8) r = r.slice(0, 8);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
}

function fuzzyMatch(query, text) {
  if (!query) return { match: true, score: 0, html: esc(text) };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx < 0) return { match: false, score: 999, html: esc(text) };
  const before = esc(text.slice(0, idx));
  const mid = '<b>' + esc(text.slice(idx, idx + q.length)) + '</b>';
  const after = esc(text.slice(idx + q.length));
  return { match: true, score: idx, html: before + mid + after };
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function filter(query) {
  if (!commands.length) init();
  const recent = getRecent();
  let results = [];
  for (const cmd of commands) {
    const fm = fuzzyMatch(query, cmd.label);
    if (fm.match) results.push({ ...cmd, score: fm.score, html: fm.html });
  }
  results.sort((a, b) => {
    if (!query) {
      const ra = recent.indexOf(a.id), rb = recent.indexOf(b.id);
      if (ra >= 0 && rb < 0) return -1;
      if (rb >= 0 && ra < 0) return 1;
      if (ra >= 0 && rb >= 0) return ra - rb;
    }
    return a.score - b.score;
  });
  return results;
}

function render() {
  if (!filtered.length) { list.innerHTML = '<div class="cmd-empty">No matching commands</div>'; return; }
  list.innerHTML = filtered.map((cmd, i) =>
    '<div class="cmd-item' + (i === activeIdx ? ' active' : '') + '" data-idx="' + i + '">' +
    '<span class="ci-icon">' + cmd.icon + '</span>' +
    '<span class="ci-label">' + cmd.html + '</span>' +
    (cmd.keys ? '<span class="ci-keys">' + cmd.keys + '</span>' : '') +
    '</div>'
  ).join('');
  list.querySelectorAll('.cmd-item').forEach(el => {
    el.addEventListener('mousedown', e => { e.preventDefault(); execute(parseInt(el.dataset.idx)); });
    el.addEventListener('mouseenter', () => { activeIdx = parseInt(el.dataset.idx); render(); });
  });
  const active = list.querySelector('.cmd-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function execute(idx) {
  const cmd = filtered[idx];
  if (!cmd) return;
  close();
  addRecent(cmd.id);
  try { cmd.action(); } catch(e) { console.error('[cmd-palette]', e); }
}

function open() {
  if (!commands.length) init();
  overlay.classList.add('open');
  input.value = '';
  activeIdx = 0;
  filtered = filter('');
  render();
  setTimeout(() => input.focus(), 30);
}

function close() {
  overlay.classList.remove('open');
}

input.addEventListener('input', () => {
  activeIdx = 0;
  filtered = filter(input.value.trim());
  render();
});

input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % Math.max(1, filtered.length); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + filtered.length) % Math.max(1, filtered.length); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); execute(activeIdx); }
  else if (e.key === 'Escape') { e.preventDefault(); close(); }
});

overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

/* Keyboard shortcut */
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'p') {
    e.preventDefault();
    open();
  }
}, true);

if (window.MeshBus) {
  window.MeshBus.on('command-palette:open', open);
}
})();
