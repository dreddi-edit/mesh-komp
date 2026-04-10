/* Mesh Feature: Quick Open (Cmd+P) */
(function(){
const STORAGE_KEY = 'mesh-recent-files';

const style = document.createElement('style');
style.textContent = `
.qo-overlay {
  position: fixed; inset: 0; z-index: 10001;
  background: rgba(0,0,0,0.35); display: none;
  align-items: flex-start; justify-content: center;
  padding-top: 16vh;
}
.qo-overlay.open { display: flex; animation: qo-fade 80ms ease-out; }
@keyframes qo-fade { from { opacity: 0; } to { opacity: 1; } }
.qo-box {
  width: 100%; max-width: 600px; background: #1e1e1e; border: 1px solid #333;
  border-radius: 10px; box-shadow: 0 16px 64px rgba(0,0,0,0.6); overflow: hidden;
}
.qo-input-row { display: flex; align-items: center; padding: 0 14px; border-bottom: 1px solid #333; }
.qo-input {
  flex: 1; background: none; border: none; color: #eee; font-size: 15px;
  padding: 14px 10px; outline: none; font-family: inherit;
}
.qo-input::placeholder { color: #555; }
.qo-list { max-height: 360px; overflow-y: auto; padding: 4px 0; }
.qo-item {
  display: flex; align-items: center; gap: 8px; padding: 6px 16px;
  cursor: pointer; color: #ccc; font-size: 13px;
}
.qo-item:hover, .qo-item.active { background: #2a2d35; }
.qo-item.active { background: var(--ac, #0098ff); color: #fff; }
.qo-item .qi-icon { flex-shrink: 0; width: 16px; }
.qo-item .qi-icon svg { vertical-align: middle; }
.qo-item .qi-name { font-weight: 500; }
.qo-item .qi-name b { color: var(--ac, #0098ff); }
.qo-item.active .qi-name b { color: #fff; }
.qo-item .qi-dir { margin-left: auto; font-size: 11px; opacity: 0.4; }
.qo-footer { padding: 6px 16px; font-size: 11px; color: #555; border-top: 1px solid #2a2a2a; }
.qo-empty { padding: 24px; text-align: center; color: #555; }
`;
document.head.appendChild(style);

const overlay = document.createElement('div');
overlay.className = 'qo-overlay';
overlay.innerHTML = `<div class="qo-box">
  <div class="qo-input-row"><input class="qo-input" placeholder="Type to search files... (: for line, > for commands, @ for symbols)" spellcheck="false" autocomplete="off"></div>
  <div class="qo-list"></div>
  <div class="qo-footer"></div>
</div>`;
document.body.appendChild(overlay);

const input = overlay.querySelector('.qo-input');
const list = overlay.querySelector('.qo-list');
const footer = overlay.querySelector('.qo-footer');
let items = [];
let activeIdx = 0;

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function getRecent() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
}
function addRecent(path) {
  let r = getRecent().filter(x => x !== path);
  r.unshift(path);
  if (r.length > 10) r = r.slice(0, 10);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(r));
}

function getFiles() {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S || !A || !S.tree) return [];
  return A.flatFiles(S.tree);
}

function fuzzyMatch(query, text) {
  if (!query) return { match: true, score: 0, html: esc(text) };
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx < 0) return { match: false };
  const before = esc(text.slice(0, idx));
  const mid = '<b>' + esc(text.slice(idx, idx + q.length)) + '</b>';
  const after = esc(text.slice(idx + q.length));
  return { match: true, score: idx, html: before + mid + after };
}

function filter(query) {
  const files = getFiles();
  const recent = getRecent();
  const A = window.MeshActions;

  if (!query) {
    /* Show recent first, then all */
    const recentItems = recent.map(p => files.find(f => f.path === p)).filter(Boolean);
    const rest = files.filter(f => !recent.includes(f.path)).slice(0, 50);
    return [...recentItems, ...rest].map(f => ({
      path: f.path,
      name: f.name || f.path.split('/').pop(),
      dir: f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '',
      icon: A ? A.fIcon(f.name || f.path, false) : '',
      nameHtml: esc(f.name || f.path.split('/').pop()),
      file: f,
    }));
  }

  const results = [];
  for (const f of files) {
    const name = f.name || f.path.split('/').pop();
    const fm = fuzzyMatch(query, f.path);
    const fmName = fuzzyMatch(query, name);
    const best = fmName.match ? fmName : (fm.match ? fm : null);
    if (!best) continue;
    results.push({
      path: f.path,
      name: name,
      dir: f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '',
      icon: A ? A.fIcon(name, false) : '',
      nameHtml: fmName.match ? fmName.html : esc(name),
      score: best.score + (recent.includes(f.path) ? -100 : 0),
      file: f,
    });
  }
  results.sort((a, b) => a.score - b.score);
  return results.slice(0, 60);
}

function render() {
  if (!items.length) { list.innerHTML = '<div class="qo-empty">No files found</div>'; footer.textContent = ''; return; }
  list.innerHTML = items.map((item, i) =>
    '<div class="qo-item' + (i === activeIdx ? ' active' : '') + '" data-idx="' + i + '">' +
    '<span class="qi-icon">' + item.icon + '</span>' +
    '<span class="qi-name">' + item.nameHtml + '</span>' +
    '<span class="qi-dir">' + esc(item.dir) + '</span>' +
    '</div>'
  ).join('');
  footer.textContent = getFiles().length + ' files';
  list.querySelectorAll('.qo-item').forEach(el => {
    el.addEventListener('mousedown', e => { e.preventDefault(); selectItem(parseInt(el.dataset.idx)); });
    el.addEventListener('mouseenter', () => { activeIdx = parseInt(el.dataset.idx); render(); });
  });
  const active = list.querySelector('.qo-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function selectItem(idx) {
  const item = items[idx];
  if (!item) return;
  close();
  addRecent(item.path);
  const A = window.MeshActions;
  const S = window.MeshState;
  if (A && S) {
    const found = A.findInTree(S.tree, item.path);
    if (found) A.openFile(found);
    else A.toast('Error', 'File not in tree: ' + item.path);
  }
}

function open() {
  overlay.classList.add('open');
  input.value = '';
  activeIdx = 0;
  items = filter('');
  render();
  setTimeout(() => input.focus(), 30);
}

function close() {
  overlay.classList.remove('open');
}

input.addEventListener('input', () => {
  const q = input.value;

  /* Special prefixes */
  if (q.startsWith('>')) {
    close();
    if (window.MeshBus) window.MeshBus.emit('command-palette:open');
    return;
  }
  if (q.startsWith(':')) {
    const line = parseInt(q.slice(1));
    if (line > 0) {
      items = [{ path: ':' + line, name: 'Go to line ' + line, dir: '', icon: '🔢', nameHtml: 'Go to line <b>' + line + '</b>', file: null, _line: line }];
      render();
      return;
    }
  }
  if (q.startsWith('@')) {
    /* Symbol search in current file */
    const symbolQ = q.slice(1).toLowerCase();
    const editor = window.MeshState?.editor;
    if (editor) {
      const model = editor.getModel();
      if (model) {
        const text = model.getValue();
        const syms = [];
        const re = /(?:function|class|const|let|var|export|async)\s+(\w+)/g;
        let m;
        while ((m = re.exec(text)) !== null) {
          const name = m[1];
          if (!symbolQ || name.toLowerCase().includes(symbolQ)) {
            const line = model.getPositionAt(m.index).lineNumber;
            syms.push({ path: '@' + name, name: name, dir: 'Line ' + line, icon: '◇', nameHtml: esc(name), file: null, _line: line });
          }
        }
        items = syms.slice(0, 40);
        render();
        return;
      }
    }
  }

  activeIdx = 0;
  items = filter(q);
  render();
});

input.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % Math.max(1, items.length); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % Math.max(1, items.length); render(); }
  else if (e.key === 'Enter') {
    e.preventDefault();
    const item = items[activeIdx];
    if (item && item._line) {
      close();
      const editor = window.MeshState?.editor;
      if (editor) { editor.revealLineInCenter(item._line); editor.setPosition({ lineNumber: item._line, column: 1 }); editor.focus(); }
    } else {
      selectItem(activeIdx);
    }
  }
  else if (e.key === 'Escape') { e.preventDefault(); close(); }
});

overlay.addEventListener('mousedown', e => { if (e.target === overlay) close(); });

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'p') {
    e.preventDefault();
    open();
  }
}, true);

if (window.MeshBus) window.MeshBus.on('quick-open:open', open);
})();
