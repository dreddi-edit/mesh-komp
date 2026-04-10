/* Mesh Feature: @-Mentions Context Picker */
(function(){
const SPECIALS = [
  { id: '@terminal', label: 'Terminal Output', icon: '\u276f' },
  { id: '@errors', label: 'Current Problems', icon: '\u26a0' },
  { id: '@git-diff', label: 'Git Changes', icon: '\u2261' },
  { id: '@selection', label: 'Editor Selection', icon: '\u2702' },
  { id: '@open-files', label: 'All Open Files', icon: '\u25a1' },
];

/* ── Inject CSS ── */
const style = document.createElement('style');
style.textContent = `
.mention-dropdown {
  position: fixed; z-index: 9999;
  background: #1e1e1e; border: 1px solid #333; border-radius: 8px;
  min-width: 320px; max-height: 280px; overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5); padding: 4px 0;
  font-family: inherit; font-size: 13px;
  display: none;
}
.mention-dropdown.open { display: block; }
.mention-cat { padding: 4px 12px; font-size: 10px; text-transform: uppercase; color: #666; letter-spacing: 0.5px; }
.mention-item {
  padding: 6px 12px; cursor: pointer; display: flex; align-items: center; gap: 8px;
  color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.mention-item:hover, .mention-item.active { background: #2a2d35; }
.mention-item.active { background: var(--ac, #0098ff); color: #fff; }
.mention-item .mi-icon { flex-shrink: 0; width: 16px; text-align: center; font-size: 13px; }
.mention-item .mi-icon svg { vertical-align: middle; }
.mention-item .mi-path { opacity: 0.5; font-size: 11px; margin-left: auto; }
.mention-badge {
  display: inline-block; background: var(--ac, #0098ff); color: #fff;
  padding: 0 5px; border-radius: 3px; font-size: 11px; font-weight: 500;
  margin: 0 1px; vertical-align: baseline;
}
`;
document.head.appendChild(style);

/* ── Create dropdown ── */
const dd = document.createElement('div');
dd.className = 'mention-dropdown';
document.body.appendChild(dd);

let mentionStart = -1;
let activeIdx = 0;
let items = [];

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  const ta = document.querySelector('#chatIn');
  if (!ta) return;

  ta.addEventListener('input', onInput);
  ta.addEventListener('keydown', onKeyDown, true);
  ta.addEventListener('blur', () => setTimeout(close, 200));
}

function onInput(e) {
  const ta = e.target;
  const val = ta.value;
  const pos = ta.selectionStart;

  /* Find @ trigger */
  let atPos = -1;
  for (let i = pos - 1; i >= 0; i--) {
    if (val[i] === '@') { atPos = i; break; }
    if (val[i] === ' ' || val[i] === '\n') break;
  }

  if (atPos < 0) { close(); return; }

  mentionStart = atPos;
  const query = val.slice(atPos + 1, pos).toLowerCase();
  buildItems(query);
  if (items.length === 0) { close(); return; }
  show(ta);
}

function buildItems(query) {
  items = [];
  const S = window.MeshState;
  const A = window.MeshActions;

  /* Special items */
  for (const sp of SPECIALS) {
    if (!query || sp.id.toLowerCase().includes(query) || sp.label.toLowerCase().includes(query)) {
      items.push({ type: 'special', id: sp.id, label: sp.label, icon: sp.icon });
    }
  }

  /* File items */
  if (S && S.tree && A) {
    const files = A.flatFiles(S.tree);
    const matches = [];
    for (const f of files) {
      const p = f.path.toLowerCase();
      const name = f.name?.toLowerCase() || '';
      if (!query || p.includes(query) || name.includes(query)) {
        const score = !query ? 0 : (name.indexOf(query) === 0 ? -2 : p.indexOf(query));
        matches.push({ file: f, score });
      }
    }
    matches.sort((a, b) => a.score - b.score);
    for (const m of matches.slice(0, 20)) {
      items.push({ type: 'file', id: '@' + m.file.path, label: m.file.name || m.file.path, path: m.file.path, icon: '' });
    }
  }

  activeIdx = 0;
}

function show(ta) {
  const rect = ta.getBoundingClientRect();
  dd.style.left = rect.left + 'px';
  dd.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
  dd.style.top = 'auto';
  dd.classList.add('open');
  render();
}

function close() {
  dd.classList.remove('open');
  mentionStart = -1;
  items = [];
}

function render() {
  let html = '';
  const hasSpecials = items.some(i => i.type === 'special');
  const hasFiles = items.some(i => i.type === 'file');

  if (hasSpecials) {
    html += '<div class="mention-cat">Context</div>';
    items.filter(i => i.type === 'special').forEach((item, idx) => {
      const realIdx = items.indexOf(item);
      html += '<div class="mention-item' + (realIdx === activeIdx ? ' active' : '') + '" data-idx="' + realIdx + '">' +
        '<span class="mi-icon">' + item.icon + '</span>' + esc(item.label) + '</div>';
    });
  }
  if (hasFiles) {
    html += '<div class="mention-cat">Files</div>';
    items.filter(i => i.type === 'file').forEach((item) => {
      const realIdx = items.indexOf(item);
      const A = window.MeshActions;
      const iconHtml = A ? A.fIcon(item.label, false) : '📄';
      html += '<div class="mention-item' + (realIdx === activeIdx ? ' active' : '') + '" data-idx="' + realIdx + '">' +
        '<span class="mi-icon">' + iconHtml + '</span>' + esc(item.label) +
        '<span class="mi-path">' + esc(item.path || '') + '</span></div>';
    });
  }
  dd.innerHTML = html;
  dd.querySelectorAll('.mention-item').forEach(el => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      select(parseInt(el.dataset.idx));
    });
  });
}

function select(idx) {
  const item = items[idx];
  if (!item) return;
  const ta = document.querySelector('#chatIn');
  if (!ta) return;

  const before = ta.value.slice(0, mentionStart);
  const after = ta.value.slice(ta.selectionStart);
  const mention = item.type === 'special' ? item.id : '@' + item.path;
  ta.value = before + mention + ' ' + after;
  ta.selectionStart = ta.selectionEnd = before.length + mention.length + 1;
  ta.focus();
  close();
}

function onKeyDown(e) {
  if (!dd.classList.contains('open')) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault(); e.stopPropagation();
    activeIdx = (activeIdx + 1) % items.length;
    render();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    activeIdx = (activeIdx - 1 + items.length) % items.length;
    render();
  } else if (e.key === 'Enter' || e.key === 'Tab') {
    if (items.length > 0) {
      e.preventDefault(); e.stopPropagation();
      select(activeIdx);
    }
  } else if (e.key === 'Escape') {
    e.preventDefault(); e.stopPropagation();
    close();
  }
}

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

/* ── Resolve @mentions on send ── */
if (window.MeshBus) {
  window.MeshBus.on('chat:before-send', async (data) => {
    const text = data?.text || '';
    const mentions = text.match(/@[\w./-]+/g);
    if (!mentions || mentions.length === 0) return;

    const S = window.MeshState;
    const A = window.MeshActions;
    const api = window.MeshAPI;
    let contextParts = [];

    for (const m of mentions) {
      try {
        if (m === '@terminal') {
          const output = S.term ? '(Terminal session active)' : '(No terminal output)';
          contextParts.push('**@terminal** — Terminal Output:\n```\n' + output + '\n```');
        } else if (m === '@errors') {
          contextParts.push('**@errors** — (See Problems panel)');
        } else if (m === '@git-diff') {
          const diff = await api('/api/assistant/git/diff');
          contextParts.push('**@git-diff** — Current Changes:\n```diff\n' + (diff?.diff || diff?.stagedDiff || 'No changes') + '\n```');
        } else if (m === '@selection') {
          const sel = S.editor?.getModel()?.getValueInRange(S.editor?.getSelection()) || '';
          if (sel) contextParts.push('**@selection** — Selected Code:\n```\n' + sel + '\n```');
        } else if (m === '@open-files') {
          const parts = [];
          for (const tab of (S.tabs || [])) {
            const val = tab.model?.getValue() || tab.content || '';
            if (val) parts.push('`' + tab.path + '`:\n```\n' + val.slice(0, 3000) + '\n```');
          }
          if (parts.length) contextParts.push('**@open-files** — Open Files:\n' + parts.join('\n\n'));
        } else {
          /* File mention */
          const filePath = m.slice(1);
          /* Check open tabs first */
          const tab = (S.tabs || []).find(t => t.path === filePath);
          if (tab) {
            const val = tab.model?.getValue() || tab.content || '';
            contextParts.push('**' + m + '** — File Content:\n```\n' + val.slice(0, 8000) + '\n```');
          } else if (api) {
            try {
              const res = await api('/api/assistant/workspace/file?path=' + encodeURIComponent(filePath) + '&view=original');
              const content = res?.content || res?.raw || '';
              if (content) contextParts.push('**' + m + '** — File Content:\n```\n' + content.slice(0, 8000) + '\n```');
            } catch { /* file not found */ }
          }
        }
      } catch (e) { console.warn('[at-mentions] resolve failed:', m, e); }
    }

    if (contextParts.length > 0 && S.chat.length > 0) {
      const lastMsg = S.chat[S.chat.length - 1];
      if (lastMsg.role === 'user') {
        lastMsg.content = '[Context from @mentions]\n---\n' + contextParts.join('\n\n') + '\n---\n\n' + lastMsg.content;
      }
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
