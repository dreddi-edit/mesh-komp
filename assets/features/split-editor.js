/* Mesh Feature: Split Editor / Multi-Pane */
(function(){
const style = document.createElement('style');
style.textContent = `
.split-btn { background: none; border: none; color: #777; cursor: pointer; padding: 2px 6px; font-size: 13px; margin-left: auto; }
.split-btn:hover { color: #eee; }
.split-container { display: grid; grid-template-columns: 1fr; gap: 2px; height: 100%; }
.split-container.split-2 { grid-template-columns: 1fr 1fr; }
.split-container.split-3 { grid-template-columns: 1fr 1fr 1fr; }
.split-pane { position: relative; overflow: hidden; display: flex; flex-direction: column; }
.split-pane.focused { border-top: 2px solid var(--ac, #0098ff); }
.split-pane:not(.focused) { border-top: 2px solid transparent; }
.split-pane-tabs { display: flex; height: 28px; background: #1a1a1a; overflow-x: auto; border-bottom: 1px solid #333; align-items: center; }
.split-pane-tabs .spt { padding: 0 12px; height: 100%; display: flex; align-items: center; font-size: 11px; color: #888; cursor: pointer; white-space: nowrap; gap: 6px; }
.split-pane-tabs .spt.active { color: #eee; background: #252525; }
.split-pane-tabs .spt:hover { background: #222; }
.split-pane-tabs .spt-x { font-size: 14px; opacity: 0.4; margin-left: 4px; }
.split-pane-tabs .spt-x:hover { opacity: 1; }
.split-pane-editor { flex: 1; overflow: hidden; }
.split-close-btn { font-size: 11px; color: #666; padding: 0 6px; cursor: pointer; margin-left: 4px; }
.split-close-btn:hover { color: #f66; }
`;
document.head.appendChild(style);

let panes = []; // { id, editor, tabs: [], activeTab }
let focusedPaneId = null;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Add split button to tab bar */
  const tabBar = document.querySelector('#edTabs');
  if (tabBar) {
    const btn = document.createElement('button');
    btn.className = 'split-btn';
    btn.title = 'Split Editor Right (⌘\\)';
    btn.innerHTML = '⫿';
    btn.addEventListener('click', addSplit);
    tabBar.appendChild(btn);
  }

  /* Keyboard shortcut */
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      addSplit();
    }
  }, true);
}

function addSplit() {
  const S = window.MeshState;
  const monaco = window.MeshEditor?.monaco;
  if (!S || !monaco || !S.editor) return;

  if (panes.length >= 3) {
    window.MeshActions?.toast('Split', 'Maximum 3 splits');
    return;
  }

  /* First time: wrap existing editor in split container */
  if (panes.length === 0) {
    const monacoEl = document.querySelector('#monaco');
    if (!monacoEl) return;
    const parent = monacoEl.parentElement;

    /* Create split container */
    const container = document.createElement('div');
    container.id = 'splitContainer';
    container.className = 'split-container';

    /* Wrap existing editor as pane 0 */
    const pane0 = createPaneElement('pane-0');
    /* Move monaco into pane 0 */
    monacoEl.style.display = 'block';
    pane0.querySelector('.split-pane-editor').appendChild(monacoEl);
    container.appendChild(pane0);

    parent.appendChild(container);
    /* Hide welcome screen */
    const welcome = document.querySelector('#welcomeScr');
    if (welcome) welcome.style.display = 'none';

    panes.push({
      id: 'pane-0',
      editor: S.editor,
      el: pane0,
      tabs: S.tabs.map(t => t.path),
      activeTab: S.activeTab,
    });
    focusedPaneId = 'pane-0';
    pane0.classList.add('focused');
  }

  /* Add new pane */
  const paneId = 'pane-' + panes.length;
  const paneEl = createPaneElement(paneId);
  const container = document.querySelector('#splitContainer');
  container.appendChild(paneEl);
  container.className = 'split-container split-' + (panes.length + 1);

  /* Create new Monaco editor */
  const editorDiv = paneEl.querySelector('.split-pane-editor');
  const newEditor = monaco.editor.create(editorDiv, {
    value: '// Open a file in this pane',
    language: 'plaintext',
    theme: S.settings?.theme === 'light' ? 'vs' : 'vs-dark',
    fontSize: S.settings?.fontSize || 14,
    fontFamily: "'JetBrains Mono', monospace",
    minimap: { enabled: false },
    automaticLayout: true,
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    padding: { top: 4 },
  });

  /* Open same file if active */
  const activeTab = S.activeTab;
  const tab = S.tabs.find(t => t.path === activeTab);
  let tabs = [];
  if (tab) {
    const model = monaco.editor.createModel(tab.content || tab.model?.getValue() || '', window.MeshActions?.langOf(tab.path) || 'plaintext');
    newEditor.setModel(model);
    tabs = [activeTab];
  }

  const pane = {
    id: paneId,
    editor: newEditor,
    el: paneEl,
    tabs: tabs,
    activeTab: activeTab || null,
    models: {},
  };
  panes.push(pane);

  /* Focus new pane */
  setFocusedPane(paneId);
  renderPaneTabs();

  /* Click on pane to focus */
  paneEl.addEventListener('click', () => setFocusedPane(paneId));

  /* Close button */
  paneEl.querySelector('.split-close-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    removeSplit(paneId);
  });
}

function createPaneElement(id) {
  const pane = document.createElement('div');
  pane.className = 'split-pane';
  pane.dataset.pane = id;
  pane.innerHTML = `
    <div class="split-pane-tabs"><span class="split-close-btn" title="Close Split">✕</span></div>
    <div class="split-pane-editor"></div>
  `;
  return pane;
}

function setFocusedPane(id) {
  focusedPaneId = id;
  document.querySelectorAll('.split-pane').forEach(el => el.classList.toggle('focused', el.dataset.pane === id));
}

function removeSplit(paneId) {
  const idx = panes.findIndex(p => p.id === paneId);
  if (idx < 0) return;
  const pane = panes[idx];

  /* Dispose editor */
  if (idx > 0 && pane.editor) {
    pane.editor.dispose();
  }
  pane.el.remove();
  panes.splice(idx, 1);

  if (panes.length <= 1) {
    /* Restore to single editor mode */
    const container = document.querySelector('#splitContainer');
    if (container && panes.length === 1) {
      const monacoEl = document.querySelector('#monaco');
      if (monacoEl) {
        container.parentElement.insertBefore(monacoEl, container);
      }
      container.remove();
      panes = [];
      focusedPaneId = null;
    }
  } else {
    const container = document.querySelector('#splitContainer');
    if (container) container.className = 'split-container split-' + panes.length;
  }

  window.MeshState?.editor?.layout();
}

function renderPaneTabs() {
  /* For now just show active file name in each pane tab bar */
  for (const pane of panes) {
    const tabBar = pane.el.querySelector('.split-pane-tabs');
    if (!tabBar) continue;
    const close = tabBar.querySelector('.split-close-btn');
    tabBar.innerHTML = '';
    if (pane.activeTab) {
      const name = pane.activeTab.split('/').pop();
      const tab = document.createElement('span');
      tab.className = 'spt active';
      tab.textContent = name;
      tabBar.appendChild(tab);
    }
    if (close && panes.indexOf(pane) > 0) tabBar.appendChild(close);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
