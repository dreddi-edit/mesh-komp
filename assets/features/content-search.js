/* Mesh Feature: Content Search (Grep in Files) */
(function(){
const style = document.createElement('style');
style.textContent = `
.cs-wrap { display: flex; flex-direction: column; height: 100%; font-family: var(--f, 'Inter', system-ui, sans-serif); }
.cs-controls { padding: 8px; display: flex; flex-direction: column; gap: 6px; }
.cs-row { display: flex; gap: 4px; align-items: center; }
.cs-input { flex: 1; background: var(--bg4, #313131); border: 1px solid var(--bd, #3c3c3c); border-radius: 4px; color: var(--txw, #fff); font-size: 12px; padding: 5px 8px; outline: none; font-family: var(--f); }
.cs-input:focus { border-color: var(--ac, #0098ff); }
.cs-input::placeholder { color: var(--tx3, #777); }
.cs-toggle { background: var(--bg3, #2d2d2d); border: 1px solid var(--bd, #3c3c3c); border-radius: 4px; color: var(--tx3, #777); font-size: 11px; padding: 3px 7px; cursor: pointer; font-family: var(--m, 'JetBrains Mono', monospace); }
.cs-toggle.active { background: var(--ac, #0098ff); color: #fff; border-color: var(--ac, #0098ff); }
.cs-mode-row { display: flex; gap: 0; }
.cs-mode { flex: 1; background: var(--bg3, #2d2d2d); border: 1px solid var(--bd, #3c3c3c); color: var(--tx3, #777); font-size: 11px; padding: 4px; text-align: center; cursor: pointer; border-radius: 0; font-family: var(--f); }
.cs-mode:first-child { border-radius: 4px 0 0 4px; }
.cs-mode:last-child { border-radius: 0 4px 4px 0; }
.cs-mode + .cs-mode { border-left: none; }
.cs-mode.active { background: var(--ac, #0098ff); color: #fff; border-color: var(--ac); }
.cs-summary { padding: 4px 8px; font-size: 11px; color: var(--tx3, #777); border-bottom: 1px solid var(--bd2, #333); }
.cs-results { flex: 1; overflow-y: auto; }
.cs-file { cursor: pointer; }
.cs-file-hdr { padding: 4px 8px; font-size: 12px; color: var(--tx2, #e0e0e0); display: flex; align-items: center; gap: 6px; background: var(--bg2, #252526); position: sticky; top: 0; }
.cs-file-hdr:hover { background: var(--bg3, #2d2d2d); }
.cs-file-hdr .cs-badge { background: var(--bg4, #313131); color: var(--tx3, #777); padding: 0 5px; border-radius: 8px; font-size: 10px; margin-left: auto; font-family: var(--m); }
.cs-match { padding: 2px 8px 2px 24px; font-size: 12px; color: var(--tx, #ccc); cursor: pointer; font-family: var(--m, 'JetBrains Mono', monospace); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cs-match:hover { background: var(--bg3, #2d2d2d); color: var(--txw, #fff); }
.cs-match .cs-ln { color: var(--tx3, #777); min-width: 36px; display: inline-block; }
.cs-match .cs-hl { background: rgba(204,167,0,0.25); color: var(--yel, #e2c556); border-radius: 2px; }
.cs-loading { padding: 12px; text-align: center; color: var(--tx3, #777); font-size: 12px; }
.cs-chevron { font-size: 10px; transition: transform 0.15s; display: inline-block; }
.cs-chevron.open { transform: rotate(90deg); }
`;
document.head.appendChild(style);

let mode = 'content'; // 'filename' | 'content'
let caseSensitive = false;
let useRegex = false;
let debounceTimer = null;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  const panel = document.querySelector('.sb-p[data-panel="search"]');
  if (!panel) return;

  /* Replace search panel body */
  const hdr = panel.querySelector('.sb-hdr');
  const body = panel.querySelector('.sb-body') || panel;
  body.innerHTML = '';
  body.className = 'sb-body cs-wrap';

  body.innerHTML = `
    <div class="cs-controls">
      <div class="cs-mode-row">
        <button class="cs-mode active" data-mode="content">Content</button>
        <button class="cs-mode" data-mode="filename">Filename</button>
      </div>
      <div class="cs-row">
        <input class="cs-input" id="csQuery" placeholder="Search..." autofocus>
        <button class="cs-toggle" id="csCase" title="Case Sensitive">Aa</button>
        <button class="cs-toggle" id="csRegex" title="Use Regex">.*</button>
      </div>
      <input class="cs-input" id="csInclude" placeholder="Include (e.g. *.js, src/**)">
      <input class="cs-input" id="csExclude" placeholder="Exclude (e.g. node_modules)">
    </div>
    <div class="cs-summary" id="csSummary"></div>
    <div class="cs-results" id="csResults"></div>
  `;

  /* Mode toggle */
  body.querySelectorAll('.cs-mode').forEach(btn => {
    btn.addEventListener('click', () => {
      body.querySelectorAll('.cs-mode').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
      doSearch();
    });
  });

  /* Toggles */
  const caseBtn = body.querySelector('#csCase');
  caseBtn.addEventListener('click', () => { caseSensitive = !caseSensitive; caseBtn.classList.toggle('active', caseSensitive); doSearch(); });
  const regexBtn = body.querySelector('#csRegex');
  regexBtn.addEventListener('click', () => { useRegex = !useRegex; regexBtn.classList.toggle('active', useRegex); doSearch(); });

  /* Search on input */
  const qInput = body.querySelector('#csQuery');
  [qInput, body.querySelector('#csInclude'), body.querySelector('#csExclude')].forEach(inp => {
    inp.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(doSearch, 300);
    });
  });

  /* Also listen for Cmd+Shift+F to focus */
  if (window.MeshBus) window.MeshBus.on('search:focus', () => qInput?.focus());
}

async function doSearch() {
  const query = document.querySelector('#csQuery')?.value?.trim() || '';
  const results = document.querySelector('#csResults');
  const summary = document.querySelector('#csSummary');
  if (!query) { if (results) results.innerHTML = ''; if (summary) summary.textContent = ''; return; }

  if (mode === 'filename') {
    doFilenameSearch(query, results, summary);
    return;
  }

  /* Content search via grep API */
  if (results) results.innerHTML = '<div class="cs-loading">Searching...</div>';

  try {
    const api = window.MeshAPI;
    const res = await api('/api/assistant/workspace/grep', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, scope: 'all', limit: 200, caseSensitive }),
    });

    const hits = res?.results || res?.matches || [];
    if (!res?.ok || !hits.length) {
      if (results) results.innerHTML = '<div class="cs-loading">No results</div>';
      if (summary) summary.textContent = '0 results';
      return;
    }

    /* Group by file */
    const groups = {};
    let totalMatches = 0;
    for (const hit of hits) {
      const file = hit.path || hit.file || 'unknown';
      if (!groups[file]) groups[file] = [];
      groups[file].push(hit);
      totalMatches++;
    }

    const fileCount = Object.keys(groups).length;
    if (summary) summary.textContent = totalMatches + ' results in ' + fileCount + ' files';

    if (results) {
      results.innerHTML = '';
      for (const [filePath, hits] of Object.entries(groups)) {
        const fileDiv = document.createElement('div');
        fileDiv.className = 'cs-file';
        const name = filePath.split('/').pop();
        const A = window.MeshActions;
        const icon = A ? A.fIcon(name, false) : '';

        const hdr = document.createElement('div');
        hdr.className = 'cs-file-hdr';
        hdr.innerHTML = '<span class="cs-chevron open">&#9654;</span>' + icon + ' ' + esc(filePath) + '<span class="cs-badge">' + hits.length + '</span>';

        const matchList = document.createElement('div');
        matchList.className = 'cs-match-list';

        for (const hit of hits) {
          const line = hit.lineNumber || (typeof hit.line === 'number' ? hit.line : 0);
          const text = hit.preview || hit.text || (typeof hit.line === 'string' ? hit.line : '') || hit.content || hit.match || '';
          const highlighted = highlightMatch(text, query);
          const el = document.createElement('div');
          el.className = 'cs-match';
          el.innerHTML = '<span class="cs-ln">' + line + '</span>' + highlighted;
          el.addEventListener('click', () => openAtLine(filePath, line));
          matchList.appendChild(el);
        }

        hdr.addEventListener('click', () => {
          const open = matchList.style.display !== 'none';
          matchList.style.display = open ? 'none' : '';
          hdr.querySelector('.cs-chevron').classList.toggle('open', !open);
        });

        fileDiv.appendChild(hdr);
        fileDiv.appendChild(matchList);
        results.appendChild(fileDiv);
      }
    }
  } catch (e) {
    if (results) results.innerHTML = '<div class="cs-loading">Search error: ' + esc(e.message) + '</div>';
  }
}

function doFilenameSearch(query, results, summary) {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S || !A) return;
  const files = A.flatFiles(S.tree);
  const q = query.toLowerCase();
  const hits = files.filter(f => f.path.toLowerCase().includes(q)).slice(0, 100);

  if (summary) summary.textContent = hits.length + ' files';
  if (results) {
    results.innerHTML = hits.map(f => {
      const name = f.name || f.path.split('/').pop();
      const icon = A.fIcon(name, false);
      return '<div class="cs-match" data-path="' + esc(f.path) + '" style="padding-left:8px">' + icon + ' ' + highlightMatch(f.path, query) + '</div>';
    }).join('');
    results.querySelectorAll('.cs-match[data-path]').forEach(el => {
      el.addEventListener('click', () => {
        const item = A.findInTree(S.tree, el.dataset.path);
        if (item) A.openFile(item);
      });
    });
  }
}

function highlightMatch(text, query) {
  const escaped = esc(text);
  if (!query) return escaped;
  const q = esc(query);
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', caseSensitive ? 'g' : 'gi');
  return escaped.replace(re, '<span class="cs-hl">$1</span>');
}

function openAtLine(filePath, lineNumber) {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S || !A) return;
  const item = A.findInTree(S.tree, filePath);
  if (item) {
    A.openFile(item);
    setTimeout(() => {
      if (S.editor && lineNumber > 0) {
        S.editor.revealLineInCenter(lineNumber);
        S.editor.setPosition({ lineNumber, column: 1 });
        S.editor.focus();
      }
    }, 200);
  }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
