/* Mesh Feature: Span Navigation – Click @sp_xxx in chat to jump to code */
(function(){
const style = document.createElement('style');
style.textContent = `
.sp-link { color: var(--ac, #0098ff); cursor: pointer; text-decoration: underline dotted; font-family: 'JetBrains Mono', monospace; font-size: 0.9em; background: rgba(0,152,255,0.08); padding: 0 3px; border-radius: 3px; }
.sp-link:hover { background: rgba(0,152,255,0.18); text-decoration: underline solid; }
.sp-popup { position: fixed; z-index: 9999; background: #1e1e2e; border: 1px solid #444; border-radius: 6px; padding: 8px 12px; font-size: 12px; color: #ccc; max-width: 420px; box-shadow: 0 4px 16px rgba(0,0,0,.5); }
.sp-popup-title { font-weight: 600; margin-bottom: 4px; color: #eee; }
.sp-popup-path { font-size: 11px; color: #888; margin-bottom: 6px; }
.sp-popup-actions { display: flex; gap: 6px; margin-top: 6px; }
.sp-popup-actions button { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid #444; background: #2a2a2a; color: #ccc; cursor: pointer; }
.sp-popup-actions button:hover { background: #333; }
.sp-popup-actions button.primary { border-color: var(--ac, #0098ff); color: var(--ac); }
`;
document.head.appendChild(style);

let popup = null;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Observe chat area for new messages */
  const chatArea = document.querySelector('#chatMsgs');
  if (chatArea) {
    const obs = new MutationObserver(() => setTimeout(linkifySpans, 50));
    obs.observe(chatArea, { childList: true, subtree: true });
  }

  /* Close popup on outside click */
  document.addEventListener('click', (e) => {
    if (popup && !popup.contains(e.target) && !e.target.classList.contains('sp-link')) {
      closePopup();
    }
  });

  /* Initial pass */
  setTimeout(linkifySpans, 1000);
}

function linkifySpans() {
  const chatMsgs = document.querySelector('#chatMsgs');
  if (!chatMsgs) return;

  /* Find all text nodes with @sp_ patterns */
  const walker = document.createTreeWalker(chatMsgs, NodeFilter.SHOW_TEXT, null, false);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (/@sp_\w+/.test(node.textContent) && !node.parentElement?.classList.contains('sp-link')) {
      nodes.push(node);
    }
  }

  for (const textNode of nodes) {
    const text = textNode.textContent;
    const parts = text.split(/(@sp_\w+)/g);
    if (parts.length <= 1) continue;

    const frag = document.createDocumentFragment();
    for (const part of parts) {
      if (/^@sp_\w+$/.test(part)) {
        const link = document.createElement('span');
        link.className = 'sp-link';
        link.textContent = part;
        link.dataset.span = part;
        link.addEventListener('click', (e) => { e.stopPropagation(); onSpanClick(link, part); });
        frag.appendChild(link);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    }
    textNode.parentNode.replaceChild(frag, textNode);
  }
}

async function onSpanClick(el, spanId) {
  closePopup();
  const api = window.MeshAPI;
  if (!api) return;

  try {
    const res = await api('/api/assistant/workspace/span?id=' + encodeURIComponent(spanId));
    if (res?.file) {
      showPopup(el, {
        spanId,
        file: res.file,
        line: res.startLine || res.line || 1,
        endLine: res.endLine || res.startLine || res.line || 1,
        symbol: res.symbol || res.name || spanId,
        kind: res.kind || 'symbol',
        preview: res.preview || '',
      });
    } else {
      /* Try direct navigation — extract file path from capsule data */
      window.MeshActions?.toast('Span', 'Span not found: ' + spanId);
    }
  } catch {
    window.MeshActions?.toast('Span', 'Could not resolve ' + spanId);
  }
}

function showPopup(anchorEl, info) {
  popup = document.createElement('div');
  popup.className = 'sp-popup';

  const name = info.file.split('/').pop();
  popup.innerHTML = `
    <div class="sp-popup-title">${esc(info.symbol)} <span style="color:#666;font-weight:normal">(${esc(info.kind)})</span></div>
    <div class="sp-popup-path">${esc(info.file)}:${info.line}${info.endLine > info.line ? '-' + info.endLine : ''}</div>
    ${info.preview ? '<pre style="margin:0;padding:6px;background:#111;border-radius:4px;font-size:11px;max-height:120px;overflow:auto;color:#aaa;white-space:pre-wrap;">' + esc(info.preview) + '</pre>' : ''}
    <div class="sp-popup-actions">
      <button class="primary" id="spGo">Go to Definition</button>
      <button id="spCapsule">View Capsule</button>
    </div>
  `;

  document.body.appendChild(popup);

  /* Position near anchor */
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = Math.min(rect.left, window.innerWidth - 440) + 'px';
  popup.style.top = (rect.bottom + 6) + 'px';

  popup.querySelector('#spGo').addEventListener('click', () => {
    navigateToSpan(info.file, info.line);
    closePopup();
  });

  popup.querySelector('#spCapsule')?.addEventListener('click', () => {
    if (window.MeshCapsuleViewer) window.MeshCapsuleViewer.openCapsuleView(info.file);
    closePopup();
  });
}

function navigateToSpan(filePath, line) {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S || !A) return;

  const item = A.findInTree(S.tree, filePath);
  if (item) {
    A.openFile(item);
    setTimeout(() => {
      if (S.editor && line > 0) {
        S.editor.revealLineInCenter(line);
        S.editor.setPosition({ lineNumber: line, column: 1 });
        S.editor.focus();
      }
    }, 300);
  }
}

function closePopup() {
  if (popup) { popup.remove(); popup = null; }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
