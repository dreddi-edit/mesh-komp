/* Mesh Feature: Focused Capsule Viewer Tab */
(function(){
const style = document.createElement('style');
style.textContent = `
.cv-header { display: flex; align-items: center; gap: 12px; padding: 6px 12px; background: #1a1a2e; border-bottom: 1px solid #333; font-size: 12px; color: #ccc; }
.cv-stat { background: #2a2a3a; padding: 2px 8px; border-radius: 4px; font-size: 11px; color: #aaa; }
.cv-stat b { color: var(--ac, #0098ff); }
.cv-editor { flex: 1; overflow: hidden; }
`;
document.head.appendChild(style);

let capsuleEditor = null;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Add "View Capsule" to context menu */
  const ctx = document.querySelector('#ctxMenu');
  if (ctx) {
    const sep = document.createElement('div');
    sep.className = 'ctx-sep';
    ctx.appendChild(sep);
    const btn = document.createElement('button');
    btn.className = 'ctx-i';
    btn.dataset.act = 'viewCapsule';
    btn.textContent = '🧊 View Capsule';
    btn.addEventListener('click', onViewCapsule);
    ctx.appendChild(btn);
  }

  /* Expose for other features */
  window.MeshCapsuleViewer = { openCapsuleView };
}

function onViewCapsule() {
  /* Get context menu target path - find the last right-clicked file */
  const activeFile = document.querySelector('.fi.is-active');
  const path = activeFile?.dataset.path;
  if (path) openCapsuleView(path);
}

async function openCapsuleView(filePath) {
  const S = window.MeshState;
  const A = window.MeshActions;
  const api = window.MeshAPI;
  const monaco = window.MeshEditor?.monaco;
  if (!S || !A || !api || !monaco) return;

  try {
    const res = await api('/api/assistant/workspace/file?path=' + encodeURIComponent(filePath) + '&view=capsule');
    const capsuleContent = res?.content || res?.capsule || res?.capsuleBase || JSON.stringify(res, null, 2);
    const meta = {
      parser: res?.parser || res?.parserFamily || 'unknown',
      symbols: res?.symbolCount || res?.symbols?.length || 0,
      originalSize: res?.originalSize || res?.rawBytes || 0,
      capsuleSize: res?.capsuleSize || Buffer.byteLength?.(capsuleContent) || capsuleContent.length,
      ratio: res?.compressionRatio || 0,
    };

    showCapsuleEditor(filePath, capsuleContent, meta);
  } catch (e) {
    A.toast('Error', 'Capsule view failed: ' + e.message);
  }
}

function showCapsuleEditor(filePath, content, meta) {
  const S = window.MeshState;
  const A = window.MeshActions;
  const monaco = window.MeshEditor?.monaco;
  if (!monaco) return;

  const name = filePath.split('/').pop();
  const lang = A.langOf ? A.langOf(filePath) : 'plaintext';

  /* Hide current views */
  const monacoEl = document.querySelector('#monaco');
  if (monacoEl) monacoEl.style.display = 'none';
  const welcome = document.querySelector('#welcomeScr');
  if (welcome) welcome.style.display = 'none';

  /* Remove previous */
  closeCapsuleEditor();

  const edPane = document.querySelector('#edPane');
  if (!edPane) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'meshCapsuleWrap';
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const header = document.createElement('div');
  header.className = 'cv-header';
  header.innerHTML = `
    <span>🧊 ${A.esc(name)} [Capsule]</span>
    <span class="cv-stat">Parser: <b>${A.esc(meta.parser)}</b></span>
    <span class="cv-stat">Symbols: <b>${meta.symbols}</b></span>
    <span class="cv-stat">Original: <b>${fmtB(meta.originalSize)}</b></span>
    <span class="cv-stat">Capsule: <b>${fmtB(meta.capsuleSize)}</b></span>
    ${meta.ratio > 0 ? '<span class="cv-stat">Ratio: <b>' + meta.ratio.toFixed(1) + 'x</b></span>' : ''}
    <button class="dh-btn" id="cvClose" style="margin-left:auto;padding:3px 10px;border-radius:4px;border:1px solid #444;background:#2a2a2a;color:#ccc;cursor:pointer;font-size:11px;">✕ Close</button>
  `;

  const edDiv = document.createElement('div');
  edDiv.className = 'cv-editor';
  edDiv.style.cssText = 'flex:1;';

  wrapper.appendChild(header);
  wrapper.appendChild(edDiv);
  edPane.appendChild(wrapper);

  capsuleEditor = monaco.editor.create(edDiv, {
    value: content,
    language: lang,
    theme: S.settings?.theme === 'light' ? 'vs' : 'vs-dark',
    fontSize: S.settings?.fontSize || 14,
    fontFamily: "'JetBrains Mono', monospace",
    readOnly: true,
    minimap: { enabled: true },
    automaticLayout: true,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
  });

  /* Add tab */
  const tabBar = document.querySelector('#edTabs');
  if (tabBar) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    const tab = document.createElement('div');
    tab.className = 'tab is-active';
    tab.dataset.t = 'capsule-' + filePath;
    const cvIco = document.createElement('span'); cvIco.style.marginRight = '4px'; cvIco.textContent = '🧊';
    const cvName = document.createElement('span'); cvName.textContent = String(name || '') + ' [Capsule]';
    const cvX = document.createElement('button'); cvX.className = 'tab-x'; cvX.textContent = '×';
    tab.appendChild(cvIco); tab.appendChild(cvName); tab.appendChild(cvX);
    tab.querySelector('.tab-x').addEventListener('click', (e) => { e.stopPropagation(); closeCapsuleEditor(); tab.remove(); A.showView('editor'); });
    tabBar.appendChild(tab);
  }

  header.querySelector('#cvClose').addEventListener('click', () => {
    closeCapsuleEditor();
    document.querySelector('.tab[data-t^="capsule-"]')?.remove();
    A.showView('editor');
  });
}

function closeCapsuleEditor() {
  if (capsuleEditor) { capsuleEditor.dispose(); capsuleEditor = null; }
  const wrap = document.querySelector('#meshCapsuleWrap');
  if (wrap) wrap.remove();
}

function fmtB(b) {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
