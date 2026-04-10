/* Mesh Feature: Diff Editor Integration */
(function(){
const style = document.createElement('style');
style.textContent = `
.diff-tab-icon { color: #fa0; margin-right: 4px; }
.diff-header { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: #1a1a1a; border-bottom: 1px solid #333; font-size: 12px; color: #ccc; }
.diff-header .dh-file { font-weight: 500; flex: 1; }
.diff-header .dh-btn { padding: 3px 10px; border-radius: 4px; border: 1px solid #444; background: #2a2a2a; color: #ccc; cursor: pointer; font-size: 11px; }
.diff-header .dh-btn:hover { background: #333; }
.diff-header .dh-btn-stage { border-color: #2ea043; color: #2ea043; }
.diff-header .dh-btn-stage:hover { background: #2ea043; color: #fff; }
.diff-header .dh-btn-inline { border-color: var(--ac, #0098ff); color: var(--ac); }
.diff-header .dh-btn-inline.active { background: var(--ac); color: #fff; }
.diff-container { flex: 1; overflow: hidden; }
.scm-fi .scm-diff-btn { display: none; font-size: 10px; background: #333; color: #aaa; border: none; border-radius: 3px; padding: 1px 5px; cursor: pointer; margin-left: 4px; }
.scm-fi:hover .scm-diff-btn { display: inline-block; }
.scm-fi .scm-diff-btn:hover { background: var(--ac, #0098ff); color: #fff; }
`;
document.head.appendChild(style);

let diffEditor = null;
let diffContainer = null;
let isInline = false;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  /* Watch for SCM panel re-renders to inject diff buttons */
  const observer = new MutationObserver(injectDiffButtons);
  const chgList = document.querySelector('#chgList');
  if (chgList) observer.observe(chgList, { childList: true, subtree: true });
  /* Initial inject */
  setTimeout(injectDiffButtons, 1000);
}

function injectDiffButtons() {
  document.querySelectorAll('.scm-fi').forEach(el => {
    if (el.querySelector('.scm-diff-btn')) return;
    const fnEl = el.querySelector('.scm-fn');
    if (!fnEl) return;
    const btn = document.createElement('button');
    btn.className = 'scm-diff-btn';
    btn.textContent = '↔ Diff';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fileName = fnEl.textContent.trim();
      openDiff(fileName);
    });
    el.appendChild(btn);
  });
}

async function openDiff(fileName) {
  const S = window.MeshState;
  const A = window.MeshActions;
  const api = window.MeshAPI;
  const monaco = window.MeshEditor?.monaco;
  if (!S || !A || !api || !monaco) return;

  /* Find the full path */
  const allFiles = A.flatFiles(S.tree);
  const file = allFiles.find(f => f.path.endsWith(fileName) || f.name === fileName);
  const filePath = file?.path || fileName;

  try {
    const res = await api('/api/assistant/git/diff?path=' + encodeURIComponent(filePath));
    const beforeContent = res?.beforeContent || '';
    const afterContent = res?.afterContent || '';

    /* Open diff in editor pane */
    showDiffEditor(filePath, beforeContent, afterContent);
  } catch (e) {
    A.toast('Error', 'Diff failed: ' + e.message);
  }
}

function showDiffEditor(filePath, before, after) {
  const S = window.MeshState;
  const A = window.MeshActions;
  const monaco = window.MeshEditor?.monaco;
  if (!monaco) return;

  const name = filePath.split('/').pop();
  const lang = A.langOf ? A.langOf(filePath) : 'plaintext';

  /* Hide regular editor */
  const monacoEl = document.querySelector('#monaco');
  const welcomeEl = document.querySelector('#welcomeScr');
  if (monacoEl) monacoEl.style.display = 'none';
  if (welcomeEl) welcomeEl.style.display = 'none';

  /* Remove previous diff */
  closeDiffEditor();

  /* Create diff container */
  const edPane = document.querySelector('#edPane');
  if (!edPane) return;

  const wrapper = document.createElement('div');
  wrapper.id = 'meshDiffWrap';
  wrapper.style.cssText = 'display:flex;flex-direction:column;height:100%;';

  const header = document.createElement('div');
  header.className = 'diff-header';
  header.innerHTML = `
    <span class="dh-file">↔ ${A.esc(name)}</span>
    <button class="dh-btn dh-btn-inline" id="diffToggleInline">${isInline ? '◫ Side-by-Side' : '≡ Inline'}</button>
    <button class="dh-btn dh-btn-stage" id="diffStageBtn">+ Stage</button>
    <button class="dh-btn" id="diffCloseBtn">✕ Close</button>
  `;

  diffContainer = document.createElement('div');
  diffContainer.className = 'diff-container';
  diffContainer.style.cssText = 'flex:1;';

  wrapper.appendChild(header);
  wrapper.appendChild(diffContainer);
  edPane.appendChild(wrapper);

  /* Create diff editor */
  diffEditor = monaco.editor.createDiffEditor(diffContainer, {
    theme: S.settings?.theme === 'light' ? 'vs' : 'vs-dark',
    renderSideBySide: !isInline,
    automaticLayout: true,
    readOnly: true,
    fontSize: S.settings?.fontSize || 14,
    fontFamily: "'JetBrains Mono', monospace",
    scrollBeyondLastLine: false,
  });

  const originalModel = monaco.editor.createModel(before, lang);
  const modifiedModel = monaco.editor.createModel(after, lang);
  diffEditor.setModel({ original: originalModel, modified: modifiedModel });

  /* Add tab */
  const tabBar = document.querySelector('#edTabs');
  if (tabBar) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('is-active'));
    const tab = document.createElement('div');
    tab.className = 'tab is-active';
    tab.dataset.t = 'diff-' + filePath;
    tab.innerHTML = '<span class="diff-tab-icon">↔</span><span>' + A.esc(name) + '</span><button class="tab-x">×</button>';
    tab.querySelector('.tab-x').addEventListener('click', (e) => { e.stopPropagation(); closeDiffEditor(); tab.remove(); A.showView('editor'); });
    tabBar.appendChild(tab);
  }

  /* Button bindings */
  header.querySelector('#diffCloseBtn').addEventListener('click', () => {
    closeDiffEditor();
    document.querySelector('.tab[data-t^="diff-"]')?.remove();
    A.showView('editor');
  });

  header.querySelector('#diffToggleInline').addEventListener('click', function() {
    isInline = !isInline;
    this.textContent = isInline ? '◫ Side-by-Side' : '≡ Inline';
    this.classList.toggle('active', isInline);
    diffEditor.updateOptions({ renderSideBySide: !isInline });
  });

  header.querySelector('#diffStageBtn').addEventListener('click', async () => {
    try {
      await window.MeshAPI('/api/assistant/git/stage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: [filePath] }),
      });
      A.toast('Staged', name);
      A.refreshGitStatus?.();
    } catch (e) { A.toast('Error', e.message); }
  });
}

function closeDiffEditor() {
  if (diffEditor) { diffEditor.dispose(); diffEditor = null; }
  const wrap = document.querySelector('#meshDiffWrap');
  if (wrap) wrap.remove();
}

/* Expose for other features */
window.MeshDiff = { openDiff, closeDiffEditor };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
