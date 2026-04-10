/* Mesh Feature: Agentic Multi-File AI Edits with Diff Preview */
(function(){
const style = document.createElement('style');
style.textContent = `
.ae-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 9999; display: flex; align-items: center; justify-content: center; }
.ae-panel { background: #1a1a2e; border: 1px solid #444; border-radius: 10px; width: 90vw; max-width: 900px; max-height: 85vh; display: flex; flex-direction: column; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,.6); }
.ae-header { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #333; }
.ae-header h3 { margin: 0; font-size: 14px; color: #eee; flex: 1; }
.ae-header-actions { display: flex; gap: 6px; }
.ae-header-actions button { font-size: 12px; padding: 5px 14px; border-radius: 5px; border: 1px solid #444; background: #2a2a2a; color: #ccc; cursor: pointer; }
.ae-header-actions button:hover { background: #333; }
.ae-header-actions button.accept { border-color: #2ea043; color: #2ea043; }
.ae-header-actions button.accept:hover { background: #2ea043; color: #fff; }
.ae-header-actions button.reject { border-color: #f85149; color: #f85149; }
.ae-header-actions button.reject:hover { background: #f85149; color: #fff; }
.ae-files { flex: 1; overflow-y: auto; }
.ae-file { border-bottom: 1px solid #2a2a2a; }
.ae-file-header { display: flex; align-items: center; gap: 8px; padding: 8px 16px; background: #151525; cursor: pointer; font-size: 12px; }
.ae-file-header:hover { background: #1a1a30; }
.ae-file-path { flex: 1; color: #aaa; font-family: 'JetBrains Mono', monospace; }
.ae-file-status { font-size: 10px; padding: 2px 6px; border-radius: 3px; }
.ae-file-status.added { background: rgba(46,160,67,0.15); color: #2ea043; }
.ae-file-status.modified { background: rgba(210,153,34,0.15); color: #d29922; }
.ae-file-status.deleted { background: rgba(248,81,73,0.15); color: #f85149; }
.ae-file-actions { display: flex; gap: 4px; }
.ae-file-actions button { font-size: 10px; padding: 2px 8px; border-radius: 3px; border: 1px solid #444; background: #2a2a2a; color: #aaa; cursor: pointer; }
.ae-file-actions button:hover { background: #333; }
.ae-file-diff { max-height: 300px; overflow: auto; padding: 0; display: none; }
.ae-file-diff.open { display: block; }
.ae-diff-line { font-family: 'JetBrains Mono', monospace; font-size: 11px; padding: 1px 12px; white-space: pre-wrap; word-break: break-all; }
.ae-diff-line.add { background: rgba(46,160,67,0.1); color: #3fb950; }
.ae-diff-line.del { background: rgba(248,81,73,0.1); color: #f85149; }
.ae-diff-line.ctx { color: #666; }
.ae-summary { padding: 10px 16px; font-size: 12px; color: #aaa; border-bottom: 1px solid #2a2a2a; background: #141420; }
`;
document.head.appendChild(style);

let pendingEdits = null; // { files: [{ path, action, before, after, diff }], description }

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Listen for AI edit proposals */
  if (window.MeshBus) {
    window.MeshBus.on('chat:response', (data) => {
      if (data?.reply || data?.content) {
        const text = data.reply || data.content || '';
        const edits = parseEdits(text);
        if (edits.length > 0) {
          proposeEdits(edits, text);
        }
      }
    });
  }

  /* Expose for external use */
  window.MeshAgenticEdits = { proposeEdits: proposeEditsExternal, applyEdits };
}

function parseEdits(text) {
  const edits = [];
  /* Match patterns like:
     **File: path/to/file.js** or ### path/to/file.js
     ```language
     content
     ``` */
  const fileBlockPattern = /(?:\*\*File:\s*`?([^`*\n]+)`?\*\*|###\s+`?([^`\n]+)`?)\s*\n```\w*\n([\s\S]*?)```/g;
  let match;

  while ((match = fileBlockPattern.exec(text)) !== null) {
    const path = (match[1] || match[2]).trim();
    const content = match[3];
    edits.push({ path, content, action: 'modify' });
  }

  /* Also match SEARCH/REPLACE blocks */
  const srPattern = /<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/g;
  let currentFile = null;

  /* Find file context before SEARCH/REPLACE */
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const fileMatch = lines[i].match(/(?:File|In|Modify):\s*`?([^`\n]+)`?/i);
    if (fileMatch) currentFile = fileMatch[1].trim();

    if (lines[i].includes('<<<<<<< SEARCH') && currentFile) {
      const blockText = lines.slice(i).join('\n');
      const srMatch = blockText.match(/<<<<<<< SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>> REPLACE/);
      if (srMatch) {
        edits.push({
          path: currentFile,
          searchReplace: { search: srMatch[1], replace: srMatch[2] },
          action: 'search-replace',
        });
      }
    }
  }

  return edits;
}

function proposeEditsExternal(files, description) {
  proposeEdits(files.map(f => ({
    path: f.path,
    content: f.content,
    action: f.action || 'modify',
  })), description || 'AI proposed changes');
}

async function proposeEdits(edits, description) {
  if (!edits.length) return;

  const A = window.MeshActions;
  const api = window.MeshAPI;

  /* Fetch current content for diff */
  for (const edit of edits) {
    if (edit.action !== 'search-replace') {
      try {
        const res = await api('/api/assistant/workspace/file?path=' + encodeURIComponent(edit.path));
        edit.before = res?.content || '';
        edit.after = edit.content || '';
        edit.diff = computeSimpleDiff(edit.before, edit.after);
      } catch {
        edit.before = '';
        edit.after = edit.content || '';
        edit.diff = [{ type: 'add', lines: (edit.after || '').split('\n') }];
        edit.action = 'added';
      }
    }
  }

  pendingEdits = { files: edits, description: description?.slice(0, 200) || 'AI changes' };

  /* Emit event before showing */
  if (window.MeshBus) window.MeshBus.emit('ai:before-edit', { description: pendingEdits.description });

  showEditPanel();
}

function showEditPanel() {
  if (!pendingEdits) return;
  const A = window.MeshActions;

  /* Remove existing */
  document.querySelector('#aeOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.className = 'ae-overlay';
  overlay.id = 'aeOverlay';

  const panel = document.createElement('div');
  panel.className = 'ae-panel';

  let html = `<div class="ae-header">
    <h3>Proposed Changes (${pendingEdits.files.length} files)</h3>
    <div class="ae-header-actions">
      <button class="accept" id="aeAcceptAll">✓ Accept All</button>
      <button class="reject" id="aeRejectAll">✕ Reject All</button>
    </div>
  </div>`;

  if (pendingEdits.description) {
    html += `<div class="ae-summary">${esc(pendingEdits.description)}</div>`;
  }

  html += '<div class="ae-files">';
  for (let i = 0; i < pendingEdits.files.length; i++) {
    const f = pendingEdits.files[i];
    const status = f.action === 'added' ? 'added' : f.action === 'deleted' ? 'deleted' : 'modified';
    html += `<div class="ae-file" data-idx="${i}">
      <div class="ae-file-header" data-idx="${i}">
        <span class="ae-file-path">${esc(f.path)}</span>
        <span class="ae-file-status ${status}">${status}</span>
        <div class="ae-file-actions">
          <button class="ae-accept-file" data-idx="${i}">✓</button>
          <button class="ae-reject-file" data-idx="${i}">✕</button>
        </div>
      </div>
      <div class="ae-file-diff" data-idx="${i}">`;

    if (f.diff) {
      for (const chunk of f.diff) {
        for (const line of chunk.lines || []) {
          const cls = chunk.type === 'add' ? 'add' : chunk.type === 'del' ? 'del' : 'ctx';
          const prefix = chunk.type === 'add' ? '+' : chunk.type === 'del' ? '-' : ' ';
          html += `<div class="ae-diff-line ${cls}">${prefix} ${esc(line)}</div>`;
        }
      }
    } else if (f.after) {
      for (const line of f.after.split('\n').slice(0, 50)) {
        html += `<div class="ae-diff-line add">+ ${esc(line)}</div>`;
      }
    }

    html += '</div></div>';
  }
  html += '</div>';

  panel.innerHTML = html;
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  /* Bind events */
  panel.querySelectorAll('.ae-file-header').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('.ae-file-actions')) return;
      const diff = panel.querySelector(`.ae-file-diff[data-idx="${el.dataset.idx}"]`);
      if (diff) diff.classList.toggle('open');
    });
  });

  panel.querySelector('#aeAcceptAll').addEventListener('click', () => {
    applyEdits(pendingEdits.files);
    closeEditPanel();
  });

  panel.querySelector('#aeRejectAll').addEventListener('click', () => {
    pendingEdits = null;
    closeEditPanel();
    A?.toast?.('Edits', 'Changes rejected');
  });

  panel.querySelectorAll('.ae-accept-file').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      const file = pendingEdits.files[idx];
      if (file) applyEdits([file]);
      btn.closest('.ae-file')?.remove();
      pendingEdits.files.splice(idx, 1);
      if (!pendingEdits.files.length) closeEditPanel();
    });
  });

  panel.querySelectorAll('.ae-reject-file').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      btn.closest('.ae-file')?.remove();
      pendingEdits.files.splice(idx, 1);
      if (!pendingEdits.files.length) closeEditPanel();
    });
  });

  /* Click outside to close */
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeEditPanel();
  });

  /* Escape to close */
  const escHandler = (e) => {
    if (e.key === 'Escape') { closeEditPanel(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

async function applyEdits(files) {
  const api = window.MeshAPI;
  const A = window.MeshActions;
  const S = window.MeshState;
  if (!api || !A) return;

  let applied = 0;
  for (const f of files) {
    try {
      if (f.action === 'search-replace' && f.searchReplace) {
        /* Fetch current, apply search/replace */
        const res = await api('/api/assistant/workspace/file?path=' + encodeURIComponent(f.path));
        const current = res?.content || '';
        const updated = current.replace(f.searchReplace.search, f.searchReplace.replace);
        await api('/api/assistant/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path, content: updated }),
        });
      } else if (f.action === 'deleted') {
        await api('/api/assistant/workspace/file', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path }),
        });
      } else {
        const content = f.after || f.content || '';
        await api('/api/assistant/workspace/file', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: f.path, content }),
        });
      }

      /* Update open tab if applicable */
      if (S) {
        const tab = S.tabs.find(t => t.path === f.path);
        if (tab?.model) {
          tab.model.setValue(f.after || f.content || '');
        }
      }

      applied++;
    } catch (e) {
      A.toast('Error', 'Failed to apply ' + f.path + ': ' + e.message);
    }
  }

  if (applied > 0) {
    A.toast('Applied', applied + ' file(s) updated');
    if (window.MeshBus) window.MeshBus.emit('files:changed', { count: applied });
  }
}

function closeEditPanel() {
  document.querySelector('#aeOverlay')?.remove();
}

function computeSimpleDiff(before, after) {
  const bLines = (before || '').split('\n');
  const aLines = (after || '').split('\n');
  const chunks = [];

  /* Simple line-by-line diff */
  const maxLen = Math.max(bLines.length, aLines.length);
  let i = 0;
  while (i < maxLen) {
    if (i < bLines.length && i < aLines.length && bLines[i] === aLines[i]) {
      /* Context — show around changes */
      i++;
      continue;
    }

    /* Find change extent */
    const start = i;
    const delLines = [];
    const addLines = [];

    /* Collect deleted lines */
    while (i < bLines.length && (i >= aLines.length || bLines[i] !== aLines[i])) {
      delLines.push(bLines[i]);
      i++;
      if (delLines.length > 20) break;
    }

    /* Collect added lines */
    let j = start;
    while (j < aLines.length && (j >= bLines.length || aLines[j] !== bLines[j])) {
      addLines.push(aLines[j]);
      j++;
      if (addLines.length > 20) break;
    }

    if (delLines.length) chunks.push({ type: 'del', lines: delLines });
    if (addLines.length) chunks.push({ type: 'add', lines: addLines });

    i = Math.max(i, j);
  }

  return chunks;
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
