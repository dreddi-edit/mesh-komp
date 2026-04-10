/* Mesh AI IDE v4 — Full Antigravity Clone */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

/* ═══ STATE ═══ */
const S={
  user:null,
  chat:[{role:'assistant',content:"Hi! I'm Mesh AI, your coding assistant. Open a folder to start editing, or ask me anything about code, architecture, or debugging."}],
  tree:[],totalFiles:0,
  tabs:[],activeTab:null,dirHandle:null,dirName:'',
  editor:null,monacoReady:false,modified:new Set(),
  ops:{pending:[],history:[]},
  settings:{theme:'dark',fontSize:14,wordWrap:true,minimap:true,model:'gpt-5.4-mini'},
  switches:{},
  workspaceConfig:{},
  accountProfile:null,
  termWs:null,term:null,termFit:null,
  currentView:'editor',
  surfaceMode:'editor',
  sidebarVisible:true,chatVisible:true,
  git: { branch: 'main', staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0 },
  workspaceIndex: {
    scanEpoch: 0,
    knownFilesByPath: new Map(),
    indexedFingerprintsByPath: new Map(),
    pendingPaths: new Set(),
    deletedPaths: new Set(),
    initialIndexDone: false,
    backgroundIndexRunning: false,
    lastMode: '',
    stats: { discovered: 0, indexed: 0, skipped: 0, deleted: 0 },
  }
};

const SHELL_STATE_KEY = 'mesh-app-shell-state';
let indexProgressHideTimer = null;
// All settings sections live in the single combined /settings page.
// The section is selected via URL hash (e.g. /settings?returnTo=/app#ai).
const SETTINGS_ROUTE_BY_PAGE = {
  account:    'settings',
  security:   'settings',
  billing:    'settings',
  'api-keys': 'settings',
  appearance: 'settings',
  ai:         'settings',
};
const SHELL_ACTIONS = new Map();
const SHELL_WIRES = [];

async function purgeWorkspaceMetadata() {
  if (!S.dirName) { toast('Error', 'Open a folder first'); return; }
  const workspaceId = S.dirName + (S.user?.id ? '-' + S.user.id : '');
  if (!confirm('This will wipe all Mesh metadata for this workspace and re-index. Continue?')) return;
  
  try {
    toast('Mesh', 'Purging metadata...');
    await api('/api/assistant/workspace/purge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId })
    });
    toast('Mesh', 'Cleanup complete. Re-indexing...');
    await refreshTree();
    if (S.currentView === 'graph' && window.initWorkspaceGraph) {
      window.initWorkspaceGraph('graphView');
    }
  } catch (e) {
    toast('Error', e.message);
  }
}

/* ═══ UTIL ═══ */
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function toast(t,m){const s=$('#toasts');if(!s)return;const e=document.createElement('div');e.className='toast';e.innerHTML='<strong>'+esc(t)+'</strong>'+(m?'<span>'+esc(m)+'</span>':'');s.appendChild(e);setTimeout(()=>{e.style.opacity='0'},2500);setTimeout(()=>e.remove(),3000);}
function fmtB(b){if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}
const LANG={js:'javascript',mjs:'javascript',cjs:'javascript',ts:'typescript',tsx:'typescript',jsx:'javascript',py:'python',json:'json',html:'html',htm:'html',css:'css',scss:'scss',md:'markdown',yml:'yaml',yaml:'yaml',sh:'shell',sql:'sql',xml:'xml',java:'java',go:'go',rs:'rust',rb:'ruby',php:'php',c:'c',cpp:'cpp',h:'c',txt:'plaintext'};
function langOf(p){return LANG[(p||'').split('.').pop().toLowerCase()]||'plaintext';}
const INDEX_SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__)(\/|$)/i;
const INDEX_SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|zip|gz|tar|lock)$/i;
const INDEX_SKIP_FILES = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|cargo\.lock)$/i;
const ECOL={js:'#f0db4f',ts:'#3178c6',py:'#3776ab',json:'#a5a500',html:'#e44d26',css:'#264de4',md:'#5b9bd5',yml:'#cb171e',sh:'#89e051',go:'#00add8',rs:'#dea584',java:'#b07219',c:'#555',cpp:'#f34b7d',rb:'#701516',php:'#777bb4'};
function fIcon(n,d){
  if(d)return'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#e8a838" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  const c=ECOL[(n||'').split('.').pop().toLowerCase()]||'#858585';
  return'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function workspaceIdForCurrentFolder() {
  return S.dirName + (S.user?.id ? '-' + S.user.id : '');
}

function isIndexableWorkspacePath(path) {
  const normalized = String(path || '').replace(/\\/g, '/').replace(/^\.?\//, '');
  if (!normalized) return false;
  if (INDEX_SKIP_DIRS.test(normalized)) return false;
  if (INDEX_SKIP_EXTENSIONS.test(normalized)) return false;
  if (INDEX_SKIP_FILES.test(normalized)) return false;
  return true;
}

function updateIndexProgressState(state, detail = {}) {
  const wrap = $('#idxProgWrap');
  const fill = $('#idxProgFill');
  const txt = $('#idxProgText');
  if (indexProgressHideTimer) {
    clearTimeout(indexProgressHideTimer);
    indexProgressHideTimer = null;
  }
  if (wrap) wrap.style.display = state === 'idle' ? 'none' : 'flex';
  if (fill && Number.isFinite(detail.ratio)) fill.style.width = Math.max(0, Math.min(100, Math.round(detail.ratio * 100))) + '%';
  if (txt) {
    if (state === 'scanning') txt.textContent = 'Scanning workspace...';
    else if (state === 'initial-ready') txt.textContent = 'Initial index ready';
    else if (state === 'background') txt.textContent = detail.label || 'Background indexing...';
    else if (state === 'graph-ready') txt.textContent = detail.label || 'Index complete';
    else txt.textContent = '';
  }
  if (state === 'idle' && fill) fill.style.width = '0%';
  if (state === 'graph-ready' && wrap) {
    indexProgressHideTimer = setTimeout(() => {
      if (!S.workspaceIndex.backgroundIndexRunning && S.workspaceIndex.pendingPaths.size === 0) {
        updateIndexProgressState('idle');
      }
    }, 1400);
  }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function scaleProgressRange(start, end, ratio) {
  return start + ((end - start) * clamp01(ratio));
}

function createDeepScanProgress(items) {
  return {
    visitedUnits: 0,
    discoveredUnits: Math.max(1, Array.isArray(items) ? items.length : 0),
    lastPaintAt: 0,
  };
}

function paintDeepScanProgress(progress, options = {}) {
  if (!progress) return;
  const now = Date.now();
  if (!options.force && now - progress.lastPaintAt < 50) return;
  progress.lastPaintAt = now;
  const ratio = progress.visitedUnits / Math.max(1, progress.discoveredUnits);
  updateIndexProgressState('scanning', {
    ratio: scaleProgressRange(0.18, 0.72, ratio),
    label: `Scanning workspace ${Math.round(clamp01(ratio) * 100)}%`,
  });
}

function dispatchWorkspaceIndexEvent(name, detail = {}) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function collectIndexableWorkspaceFiles(tree, mode = 'background') {
  const entries = [];
  const items = flatFiles(tree).filter((item) => isIndexableWorkspacePath(item.path));
  for (const item of items) {
    try {
      const file = await item.handle.getFile();
      entries.push({
        path: item.path,
        item,
        file,
        size: Number(file.size || 0),
        lastModified: Number(file.lastModified || 0),
        fingerprint: `${Number(file.size || 0)}:${Number(file.lastModified || 0)}`,
        mode,
      });
    } catch (error) {
      console.warn('[mesh-index] metadata skip:', item.path, error);
    }
  }
  return entries;
}

function computeWorkspaceIndexDiff(entries) {
  const current = new Map(entries.map((entry) => [entry.path, entry]));
  const previous = S.workspaceIndex.knownFilesByPath;
  const added = [];
  const changed = [];
  const unchanged = [];
  const deleted = [];

  for (const entry of entries) {
    const known = previous.get(entry.path);
    if (!known) {
      added.push(entry);
      continue;
    }
    if (known.fingerprint !== entry.fingerprint) changed.push(entry);
    else unchanged.push(entry);
  }

  for (const [path] of previous) {
    if (!current.has(path)) deleted.push(path);
  }

  return { added, changed, unchanged, deleted, current };
}

async function syncWorkspaceIndexDiff(diff, options = {}) {
  const changedEntries = [...diff.added, ...diff.changed];
  const deletedPaths = Array.isArray(diff.deleted) ? diff.deleted : [];
  const currentMetadata = diff.current instanceof Map
    ? new Map([...diff.current.entries()].map(([path, entry]) => [path, {
      path,
      fingerprint: entry.fingerprint,
      size: entry.size,
      lastModified: entry.lastModified,
    }]))
    : new Map();
  const totalChanged = changedEntries.length;
  const totalDeleted = deletedPaths.length;
  const mode = String(options.mode || 'background');
  const scanEpoch = Number(options.scanEpoch || S.workspaceIndex.scanEpoch || 0);
  const workspaceId = workspaceIdForCurrentFolder();
  const deferReadyState = Boolean(options.deferReadyState);

  if (!totalChanged && !totalDeleted) {
    S.workspaceIndex.knownFilesByPath = currentMetadata;
    S.workspaceIndex.stats = { discovered: diff.current?.size || 0, indexed: 0, skipped: 0, deleted: 0 };
    if (mode === 'initial') {
      S.workspaceIndex.initialIndexDone = true;
      updateIndexProgressState('initial-ready', { ratio: 1 });
      dispatchWorkspaceIndexEvent('mesh-indexing-initial-ready', {
        changed: 0,
        deleted: 0,
        scanEpoch,
      });
    } else if (options.complete) {
      S.workspaceIndex.backgroundIndexRunning = false;
      if (deferReadyState) updateIndexProgressState('background', { ratio: 0.94, label: 'Finalizing graph...' });
      else updateIndexProgressState('graph-ready', { ratio: 1 });
      dispatchWorkspaceIndexEvent('mesh-indexing-complete', {
        changed: 0,
        deleted: 0,
        scanEpoch,
        mode,
      });
    }
    return { ok: true, changed: 0, deleted: 0, skipped: 0 };
  }

  S.workspaceIndex.lastMode = mode;
  S.workspaceIndex.backgroundIndexRunning = mode === 'background' && totalChanged > 0;
  changedEntries.forEach((entry) => S.workspaceIndex.pendingPaths.add(entry.path));
  deletedPaths.forEach((path) => S.workspaceIndex.deletedPaths.add(path));
  updateIndexProgressState(mode === 'initial' ? 'scanning' : 'background', {
    label: mode === 'initial' ? 'Preparing initial index...' : 'Background indexing...',
    ratio: 0,
  });

  const batchSize = mode === 'single-file' ? 1 : 20;
  let synced = 0;
  for (let i = 0; i < changedEntries.length; i += batchSize) {
    const slice = changedEntries.slice(i, i + batchSize);
    const batchFiles = [];
    for (const entry of slice) {
      const content = await entry.file.text();
      batchFiles.push({ path: entry.path, content });
    }
    await api('/api/assistant/workspace/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        folderName: S.dirName,
        files: batchFiles,
        deletedPaths: i === 0 ? deletedPaths : [],
        append: true,
        mode,
        scanEpoch,
        complete: Boolean(options.complete && i + batchSize >= changedEntries.length),
      }),
    });
    synced += slice.length;
    const ratio = totalChanged > 0 ? synced / totalChanged : 1;
    updateIndexProgressState(mode === 'initial' ? 'scanning' : 'background', {
      ratio,
      label: mode === 'initial'
        ? `Initial indexing ${Math.round(ratio * 100)}%`
        : `Background indexing ${Math.round(ratio * 100)}%`,
    });
    dispatchWorkspaceIndexEvent('mesh-indexing-background-progress', {
      mode,
      synced,
      totalChanged,
      deleted: totalDeleted,
      ratio,
    });
  }

  if (!changedEntries.length && totalDeleted > 0) {
    await api('/api/assistant/workspace/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        folderName: S.dirName,
        files: [],
        deletedPaths,
        append: true,
        mode,
        scanEpoch,
        complete: Boolean(options.complete),
      }),
    });
  }

  deletedPaths.forEach((path) => {
    S.workspaceIndex.deletedPaths.delete(path);
    S.workspaceIndex.indexedFingerprintsByPath.delete(path);
  });
  changedEntries.forEach((entry) => {
    S.workspaceIndex.pendingPaths.delete(entry.path);
    S.workspaceIndex.indexedFingerprintsByPath.set(entry.path, entry.fingerprint);
  });
  S.workspaceIndex.knownFilesByPath = currentMetadata;
  S.workspaceIndex.stats = {
    discovered: diff.current?.size || 0,
    indexed: changedEntries.length,
    skipped: flatFiles(S.tree).length - (diff.current?.size || 0),
    deleted: totalDeleted,
  };
  if (mode === 'initial') {
    S.workspaceIndex.initialIndexDone = true;
    updateIndexProgressState('initial-ready', { ratio: 1 });
    dispatchWorkspaceIndexEvent('mesh-indexing-initial-ready', {
      changed: changedEntries.length,
      deleted: totalDeleted,
      scanEpoch,
    });
  } else {
    S.workspaceIndex.backgroundIndexRunning = false;
    if (deferReadyState) updateIndexProgressState('background', { ratio: 0.94, label: 'Finalizing graph...' });
    else updateIndexProgressState('graph-ready', { ratio: 1 });
    dispatchWorkspaceIndexEvent('mesh-indexing-complete', {
      changed: changedEntries.length,
      deleted: totalDeleted,
      scanEpoch,
      mode,
    });
  }
  return { ok: true, changed: changedEntries.length, deleted: totalDeleted, skipped: S.workspaceIndex.stats.skipped };
}

function currentAppUrl(){
  return window.location.pathname + window.location.search + window.location.hash;
}

function saveShellSnapshot(extra = {}) {
  const payload = {
    panel: document.querySelector('.ab[data-panel].is-active')?.dataset.panel || 'explorer',
    currentView: ['editor', 'ops', 'marketplace', 'graph', 'voice'].includes(S.currentView) ? S.currentView : 'editor',
    surfaceMode: ['editor', 'terminal', 'voice'].includes(S.surfaceMode) ? S.surfaceMode : 'editor',
    sidebarVisible: Boolean(S.sidebarVisible),
    chatVisible: Boolean(S.chatVisible),
    activeTabPath: S.activeTab || '',
    savedAt: Date.now(),
    ...extra,
  };
  try { sessionStorage.setItem(SHELL_STATE_KEY, JSON.stringify(payload)); } catch {}
  return payload;
}

function readShellSnapshot() {
  try {
    const raw = sessionStorage.getItem(SHELL_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function applyShellSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  if (snapshot.panel) setPanel(snapshot.panel);
  if (typeof snapshot.sidebarVisible === 'boolean') {
    S.sidebarVisible = snapshot.sidebarVisible;
    const sidebar = $('#sidebar');
    const rsSb = $('#rsSb');
    if (sidebar) sidebar.style.display = S.sidebarVisible ? 'flex' : 'none';
    if (rsSb) rsSb.style.display = S.sidebarVisible ? 'block' : 'none';
  }
  if (typeof snapshot.chatVisible === 'boolean') {
    S.chatVisible = snapshot.chatVisible;
    const chatPanel = $('#chatPanel');
    const rsChat = $('#rsChat');
    if (chatPanel) chatPanel.style.display = S.chatVisible ? 'flex' : 'none';
    if (rsChat) rsChat.style.display = S.chatVisible ? 'block' : 'none';
  }
  if (snapshot.currentView && snapshot.currentView !== 'editor') {
    showView(snapshot.currentView);
  } else {
    showView('editor');
  }
  if (snapshot.surfaceMode) {
    setWorkspaceSurface(snapshot.surfaceMode, { persist: false });
  } else {
    updateWorkspaceSurfaceUI();
  }
}

function updateWorkspaceSurfaceUI() {
  $$('.tb-surface[data-surface]').forEach((button) => {
    const active = button.dataset.surface === S.surfaceMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $('#ide')?.setAttribute('data-surface', S.surfaceMode);
  const modelLabel = $('#voiceSurfaceModel');
  if (modelLabel) modelLabel.textContent = ($('#chatModel')?.selectedOptions?.[0]?.textContent || S.settings.model || 'GPT 5.4 Mini').trim();
  const stateLabel = $('#voiceSurfaceState');
  if (stateLabel) {
    if (S.surfaceMode === 'terminal') stateLabel.textContent = 'Terminal Focus';
    else if (S.surfaceMode === 'voice') stateLabel.textContent = 'Ready for Voice';
    else stateLabel.textContent = 'Idle';
  }
  $('#terminalSurfaceStatus') && ($('#terminalSurfaceStatus').textContent = S.surfaceMode === 'terminal' ? 'Live terminal surface' : 'Primary terminal');
}

function ensureChatVisible() {
  S.chatVisible = true;
  const chatPanel = $('#chatPanel');
  const rsChat = $('#rsChat');
  if (chatPanel) chatPanel.style.display = 'flex';
  if (rsChat) rsChat.style.display = 'block';
}

function triggerVoiceSurfaceStart() {
  const micButton = $('#vcMic');
  if (micButton) {
    micButton.click();
    return;
  }
  toast('Voice', 'Voice controls are still booting. Try again in a second.');
}

function setWorkspaceSurface(surface, options = {}) {
  const nextSurface = ['editor', 'terminal', 'voice'].includes(String(surface || '')) ? String(surface) : 'editor';
  S.surfaceMode = nextSurface;

  if (nextSurface === 'editor') {
    closeTerminal();
    showView('editor');
  } else if (nextSurface === 'terminal') {
    showView('terminal');
    openTerminal(false, { mount: '#terminalSurfacePrimary' });
  } else if (nextSurface === 'voice') {
    closeTerminal();
    showView('voice');
  }

  updateWorkspaceSurfaceUI();
  dispatchWorkspaceIndexEvent('mesh-surface-changed', { surface: nextSurface });
  if (options.persist !== false) saveShellSnapshot();
}

function buildSettingsHref(page = 'account', options = {}) {
  const pageId = SETTINGS_ROUTE_BY_PAGE[page] ? page : 'account';
  const url = new URL(window.location.origin + '/settings');
  const returnTo = String(options.returnTo || currentAppUrl() || '/app').trim() || '/app';
  url.searchParams.set('returnTo', returnTo);
  if (options.from) url.searchParams.set('from', String(options.from));
  // Hash selects the section inside the combined settings SPA.
  return url.pathname + url.search + '#' + pageId;
}

function openStandaloneSettings(page = 'account', options = {}) {
  saveShellSnapshot({ reason: 'open-settings', requestedSettingsPage: page });
  // Strip ?login=1 so returning from settings doesn't re-trigger the login overlay
  const cleanReturnTo = currentAppUrl().replace(/([?&])login=1(&|$)/, '$1').replace(/[?&]$/, '') || '/app';
  window.location.assign(buildSettingsHref(page, { returnTo: cleanReturnTo, ...options }));
}

function registerShellAction(id, handler) {
  SHELL_ACTIONS.set(id, handler);
}

function runShellAction(id, payload) {
  const handler = SHELL_ACTIONS.get(id);
  if (!handler) {
    console.warn('[mesh-shell] Missing action handler:', id);
    return;
  }
  return handler(payload);
}

function wireShellAction(selector, actionId, options = {}) {
  SHELL_WIRES.push({ selector, actionId, optional: Boolean(options.optional) });
  const el = $(selector);
  if (!el) return;
  el.addEventListener(options.event || 'click', (event) => {
    if (options.preventDefault) event.preventDefault();
    runShellAction(actionId, event);
  });
}

function auditShellWiring() {
  const missing = SHELL_WIRES.filter((entry) => !entry.optional && !$(entry.selector));
  if (missing.length) {
    console.warn('[mesh-shell] Missing wired controls:', missing.map((entry) => `${entry.selector} -> ${entry.actionId}`).join(', '));
  }
}

/* ═══ API ═══ */
async function api(u,o){const c=o||{};const r=await fetch(u,{method:c.method||'GET',headers:c.headers||{},body:c.body,credentials:'same-origin'});const d=await r.json().catch(()=>({}));if(!r.ok){if(r.status===401&&!c.skip)setAuth(true,'Session expired.');throw new Error(d?.error||'Error '+r.status);}return d;}

/* ═══ AUTH ═══ */
function setAuth(s,e){$('#authOverlay')?.classList.toggle('is-visible',!!s);const er=$('#loginErr');if(er)er.textContent=e||'';}
function applyUser(u){S.user=u;const n=u?.name||u?.email?.split('@')[0]||'U';$('#abUser').textContent=(n[0]||'U').toUpperCase();$('#accEmail')&&($('#accEmail').textContent=u?.email||'');$('#accName')&&($('#accName').textContent=n);$('#accRole')&&($('#accRole').textContent=u?.role||'user');}

/* ═══ PANELS ═══ */
function setPanel(name){$$('.ab[data-panel]').forEach(b=>b.classList.toggle('is-active',b.dataset.panel===name));$$('.sb-p').forEach(p=>p.classList.toggle('is-active',p.dataset.panel===name));}

function showView(v){
  if (v === 'settings') {
    openStandaloneSettings('account', { from: 'showView' });
    return;
  }
  S.currentView=v;
  [$('#monaco'),$('#welcomeScr'),$('#opsView'),$('#marketplaceView'),$('#graphView'),$('#voiceCodingView'),$('#terminalSurfaceView')].forEach(e=>{if(e)e.style.display='none';});
  $$('.tab[data-t="settings"],.tab[data-t="ops"],.tab[data-t="marketplace"],.tab[data-t="graph"],.tab[data-t="voice"],.tab[data-t="terminal"]').forEach(t=>t.remove());
  if(v==='ops'){$('#opsView').style.display='block';renderOps();addViewTab('ops','📊 Operations');}
  else if(v==='marketplace'){$('#marketplaceView').style.display='block';addViewTab('marketplace','🛍 Marketplace');}
  else if(v==='graph'){$('#graphView').style.display='block';if(window.initWorkspaceGraph)window.initWorkspaceGraph('graphView');addViewTab('graph','🕸 Mesh Graph');}
  else if(v==='voice'){$('#voiceCodingView').style.display='block';}
  else if(v==='terminal'){$('#terminalSurfaceView').style.display='block';}
  else{if(S.activeTab&&$('#monaco'))$('#monaco').style.display='block';else if($('#welcomeScr'))$('#welcomeScr').style.display='grid';renderTabs();}
  updateWorkspaceSurfaceUI();
  saveShellSnapshot();
}
function addViewTab(id,label){
  const bar=$('#edTabs');$$('.tab',bar).forEach(t=>t.classList.remove('is-active'));
  const tab=document.createElement('div');tab.className='tab is-active';tab.dataset.t=id;
  tab.innerHTML='<span>'+esc(label)+'</span><button class="tab-x">×</button>';
  tab.querySelector('.tab-x').addEventListener('click',e=>{e.stopPropagation();tab.remove();showView('editor');});
  tab.addEventListener('click',()=>showView(id));bar.appendChild(tab);
}

function resetWorkspaceIndexState() {
  S.workspaceIndex.scanEpoch += 1;
  S.workspaceIndex.knownFilesByPath = new Map();
  S.workspaceIndex.indexedFingerprintsByPath = new Map();
  S.workspaceIndex.pendingPaths = new Set();
  S.workspaceIndex.deletedPaths = new Set();
  S.workspaceIndex.initialIndexDone = false;
  S.workspaceIndex.backgroundIndexRunning = false;
  S.workspaceIndex.lastMode = '';
  S.workspaceIndex.stats = { discovered: 0, indexed: 0, skipped: 0, deleted: 0 };
}

async function runWorkspaceIndexCycle(mode = 'background', options = {}) {
  const entries = await collectIndexableWorkspaceFiles(S.tree, mode);
  const diff = computeWorkspaceIndexDiff(entries);
  return syncWorkspaceIndexDiff(diff, {
    mode,
    complete: Boolean(options.complete),
    scanEpoch: Number(options.scanEpoch || S.workspaceIndex.scanEpoch),
    deferReadyState: Boolean(options.deferReadyState),
  });
}

/* ═══ FILE EXPLORER — FULL SCAN (NO FILTER) ═══ */
/*
  KEY FIX: We do NOT skip node_modules or any directories.
  Every single file in the selected folder will be shown.
  Binary files are treated as files but won't open in editor.
  We use progressive/chunked scanning so the UI doesn't freeze.
*/
async function fullScan(handle,prefix=''){
  const items=[];
  try{for await(const entry of handle.values()){
    const n=entry.name;
    // Explorer Transparency: show all files, including dotfiles
    if(entry.kind==='directory'){
      // DO NOT SKIP ANY DIRECTORIES — show everything
      items.push({name:n,path:prefix+n,isDir:true,handle:entry,children:null,expanded:false});
    } else {
      items.push({name:n,path:prefix+n,isDir:false,handle:entry});
    }
  }}catch(e){console.warn('scan',prefix,e);}
  items.sort((a,b)=>{if(a.isDir!==b.isDir)return a.isDir?-1:1;return a.name.localeCompare(b.name);});
  return items;
}

// Lazy-scan children when folder is expanded (so 2000+ files work without freezing)
async function ensureChildren(item){
  if(!item.isDir||item.children)return;
  item.children=await fullScan(item.handle,item.path+'/');
}

// Count files recursively (only counts loaded children)
function countLoaded(items){let c=0;for(const i of items){if(i.isDir&&i.children)c+=countLoaded(i.children);else if(!i.isDir)c++;}return c;}

async function openFolder(){
  if(!('showDirectoryPicker' in window)){toast('Error','Requires Chromium browser');return;}
  try{
    const h=await window.showDirectoryPicker({mode:'readwrite'});
    S.dirHandle=h;S.dirName=h.name;
    resetWorkspaceIndexState();
    const title=$('#tbTitle');if(title)title.textContent='Mesh AI — '+h.name;
    const prog=$('#scanProg');if(prog)prog.style.display='inline';
    toast('Scanning','"'+h.name+'"…');
    updateIndexProgressState('scanning', { ratio: 0.08, label: 'Preparing workspace scan...' });
    S.tree=await fullScan(h);
    renderTree();
    const f=$('#fileFoot');if(f)f.style.display='flex';
    await runWorkspaceIndexCycle('initial', { scanEpoch: S.workspaceIndex.scanEpoch, complete: false });
    /* Deep scan in background, then re-index the rest */
    deepScanAll(S.tree).then(async()=>{
      S.totalFiles=countLoaded(S.tree);
      if(prog)prog.style.display='none';
      const n=$('#fileNum');if(n)n.textContent=S.totalFiles+' files';
      toast('Done',S.totalFiles+' files in "'+h.name+'"');
      renderTree();
      await runWorkspaceIndexCycle('background', { scanEpoch: S.workspaceIndex.scanEpoch, complete: true, deferReadyState: true });
      await initMeshMetadata(h, { force: true, phase: 'background-complete', attachToTree: true });
      updateIndexProgressState('graph-ready', { ratio: 1 });
    });
    if (window.idbKeyval) await idbKeyval.set('last-folder', h);
    await initMeshMetadata(h, { attachToTree: false, phase: 'initial' });
  }catch(e){if(e.name!=='AbortError')toast('Error',e.message);}
}

async function readWorkspaceRootJson(handle, filename) {
  try {
    const fileHandle = await handle.getFileHandle(filename);
    const file = await fileHandle.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

async function fetchWorkspaceGraphSummary() {
  try {
    const response = await fetch('/api/assistant/workspace/graph');
    if (!response.ok) return null;
    const graph = await response.json();
    return graph?.ok ? graph : null;
  } catch {
    return null;
  }
}

function buildMeshInstructionsContent({ packageInfo, graph } = {}) {
  const flat = flatFiles(S.tree);
  const topLevel = (S.tree || []).slice(0, 24).map((item) => `${item.isDir ? '📁' : '📄'} ${item.path}`);
  const keyFiles = flat
    .map((item) => item.path)
    .filter((filePath) => /(^|\/)(package\.json|README\.md|tsconfig\.json|vite\.config|next\.config|webpack\.config|docker-compose|Dockerfile|src\/.*|app\/.*|pages\/.*|server\.)/i.test(filePath))
    .slice(0, 20);
  const packageScripts = Object.keys(packageInfo?.scripts || {}).slice(0, 12);
  const packageDeps = Object.keys({
    ...(packageInfo?.dependencies || {}),
    ...(packageInfo?.devDependencies || {}),
  }).slice(0, 20);
  const graphNodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const graphEdges = Array.isArray(graph?.edges) ? graph.edges : [];
  const inbound = new Map();
  for (const edge of graphEdges) inbound.set(edge.to, (inbound.get(edge.to) || 0) + 1);
  const graphHubs = graphNodes
    .map((node) => ({ path: node.path || node.name || node.id, count: inbound.get(node.id) || 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path))
    .slice(0, 10);

  const lines = [
    `# Mesh Workspace Instructions: ${S.dirName || 'workspace'}`,
    '',
    '## Purpose',
    '',
    'This file is the workspace-local operating note for Mesh-based coding and analysis.',
    'It describes the current project shape, likely stack, high-signal files, and how AI should treat compressed file views.',
    '',
    '## Capsula Rules',
    '',
    '1. Capsule views are intentionally compressed summaries, not file corruption.',
    '2. Use capsule or focused views first for understanding large files.',
    '3. If exact implementation detail is needed, recover raw spans before editing.',
    '4. Prefer minimal, local edits over broad rewrites.',
    '',
    '## Workspace Snapshot',
    '',
    `- Folder: \`${S.dirName || 'workspace'}\``,
    `- Loaded files: ${flat.length}`,
    `- Indexed files: ${S.workspaceIndex?.stats?.indexed || 0}`,
    `- Skipped files: ${S.workspaceIndex?.stats?.skipped || 0}`,
    `- Surface modes: Editor / Terminal / Voice-Coding`,
    '',
    '## Detected Stack',
    '',
    `- Tooling: ${packageScripts.length ? 'package.json scripts detected' : 'No root package.json scripts detected'}`,
    `- Dependencies: ${packageDeps.length ? packageDeps.slice(0, 10).join(', ') : 'No package dependencies detected'}`,
    '',
  ];

  if (packageScripts.length) {
    lines.push('## Common Scripts', '');
    for (const scriptName of packageScripts) {
      lines.push(`- \`${scriptName}\`: ${String(packageInfo.scripts[scriptName] || '').slice(0, 120)}`);
    }
    lines.push('');
  }

  if (keyFiles.length) {
    lines.push('## Key Files', '');
    for (const filePath of keyFiles) lines.push(`- \`${filePath}\``);
    lines.push('');
  }

  lines.push('## Top-Level Structure', '');
  for (const entry of topLevel) lines.push(`- ${entry}`);
  lines.push('');

  lines.push('## Dependency Picture', '');
  lines.push(`- Nodes: ${graphNodes.length}`);
  lines.push(`- Edges: ${graphEdges.length}`);
  if (graphHubs.length) {
    lines.push('', '### Most Referenced Files', '');
    for (const hub of graphHubs) lines.push(`- \`${hub.path}\` — imported by ${hub.count} file(s)`);
  } else {
    lines.push('- Dependency hubs are not available yet or no import graph has been detected.');
  }
  lines.push('', '## AI Working Rules', '');
  lines.push('1. Respect existing naming, module boundaries, and architecture shape.');
  lines.push('2. Prefer reading compressed context first and recovering exact source only where needed.');
  lines.push('3. When changing code, keep edits narrow and aligned with the current file structure.');
  lines.push('4. Treat `.mesh/dependency-map.md` as a graph summary, not as the sole source of truth.');
  lines.push('', '---', '*Generated by Mesh from the active workspace and refreshed after indexing.*');
  return lines.join('\n');
}

function buildDependencyMapContent(graph) {
  const nodes = Array.isArray(graph?.nodes) ? graph.nodes : [];
  const edges = Array.isArray(graph?.edges) ? graph.edges : [];
  const lines = [
    `# Dependency Map: ${S.dirName || 'workspace'}`,
    '',
    `- Nodes: ${nodes.length}`,
    `- Edges: ${edges.length}`,
    '',
  ];
  if (!nodes.length) {
    lines.push('No dependency graph data is available yet for this workspace.');
    lines.push('', 'This can currently mean:');
    lines.push('- indexing is still running');
    lines.push('- no dependency-bearing source files have been indexed yet');
    lines.push('- the graph source is still warming up');
    lines.push('', '---', '*Generated by Mesh.*');
    return lines.join('\n');
  }

  const nameById = new Map();
  for (const node of nodes) nameById.set(node.id, node.path || node.name || node.id);
  const imports = new Map();
  const importedBy = new Map();
  for (const edge of edges) {
    const from = nameById.get(edge.from) || edge.from;
    const to = nameById.get(edge.to) || edge.to;
    if (!imports.has(from)) imports.set(from, []);
    imports.get(from).push(to);
    if (!importedBy.has(to)) importedBy.set(to, []);
    importedBy.get(to).push(from);
  }

  const hubs = [...importedBy.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, 12);
  lines.push('## Most Connected', '');
  if (hubs.length) {
    for (const [filePath, refs] of hubs) lines.push(`- \`${filePath}\` — imported by ${refs.length} file(s)`);
  } else {
    lines.push('- No resolved import edges yet.');
  }

  lines.push('', '## Dependencies', '');
  const sortedImports = [...imports.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!sortedImports.length) {
    lines.push('- No explicit import edges were resolved.');
  } else {
    for (const [filePath, deps] of sortedImports) {
      lines.push(`### \`${filePath}\``, '');
      for (const dep of deps.sort()) lines.push(`- \`${dep}\``);
      lines.push('');
    }
  }
  lines.push('---', '*Generated by Mesh AI Dependency Analysis Engine.*');
  return lines.join('\n');
}

async function initMeshMetadata(h, options = {}) {
  try {
    const meshDir = await h.getDirectoryHandle('.mesh', { create: true });
    const instrFile = await meshDir.getFileHandle('instructions.md', { create: true });
    const force = Boolean(options.force);
    const fData = await instrFile.getFile();
    const packageInfo = await readWorkspaceRootJson(h, 'package.json');
    const graph = await fetchWorkspaceGraphSummary();

    if (force || fData.size === 0) {
      const writable = await instrFile.createWritable();
      await writable.write(buildMeshInstructionsContent({ packageInfo, graph }));
      await writable.close();
    }

    // --- Generate dependency-map.md ---
    try {
      const depFile = await meshDir.getFileHandle('dependency-map.md', { create: true });
      const depData = await depFile.getFile();
      if (force || depData.size === 0) {
        const depWritable = await depFile.createWritable();
        await depWritable.write(buildDependencyMapContent(graph));
        await depWritable.close();
      }
    } catch (depErr) { console.warn('Dependency map generation skipped', depErr); }
    
    // Keep the current scanned tree intact. Replacing S.tree here creates a
    // new shallow tree while the background deep scan is still walking the old
    // one, which makes the later background index cycle run against the wrong
    // file graph.
    if (options.attachToTree !== false) {
      ensureTopLevelDirectoryInTree('.mesh', meshDir);
      renderTree();
      const n = $('#fileNum');
      if (n) n.textContent = S.totalFiles + ' files';
    }
  } catch (e) { console.warn('Mesh metadata init skipped (read-only or error)', e); }
}

async function restoreFolder(options = {}) {
  if (!window.idbKeyval) return;
  try {
    const h = await idbKeyval.get('last-folder');
    if (!h) return false;
    const opt = { mode: 'readwrite' };
    if ((await h.queryPermission(opt)) !== 'granted') {
      if (options.interactive === false) return false;
      if ((await h.requestPermission(opt)) !== 'granted') return false;
    }
    S.dirHandle = h; S.dirName = h.name;
    resetWorkspaceIndexState();
    const title = $('#tbTitle'); if (title) title.textContent = 'Mesh AI — ' + h.name;
    const prog = $('#scanProg'); if (prog) prog.style.display = 'inline';
    updateIndexProgressState('scanning', { ratio: 0.08, label: 'Preparing workspace scan...' });
    S.tree = await fullScan(h);
    renderTree();
    const f = $('#fileFoot'); if (f) f.style.display = 'flex';
    await runWorkspaceIndexCycle('initial', { scanEpoch: S.workspaceIndex.scanEpoch, complete: false });
    deepScanAll(S.tree).then(async () => {
      S.totalFiles = countLoaded(S.tree);
      if (prog) prog.style.display = 'none';
      const n = $('#fileNum'); if (n) n.textContent = S.totalFiles + ' files';
      renderTree();
      await runWorkspaceIndexCycle('background', { scanEpoch: S.workspaceIndex.scanEpoch, complete: true, deferReadyState: true });
      await initMeshMetadata(h, { force: true, phase: 'background-complete', attachToTree: true });
      updateIndexProgressState('graph-ready', { ratio: 1 });
      if (options.reopenPath) {
        const item = findInTree(S.tree, options.reopenPath);
        if (item) openFile(item);
      }
    });
    await initMeshMetadata(h, { attachToTree: false, phase: 'initial' });
    return true;
  } catch (e) {
    console.error('Restore failed', e);
    if (options.interactive !== false) toast('Error', 'Could not restore folder');
    return false;
  }
}

async function indexWorkspace(handle, tree) {
  const mode = S.workspaceIndex.initialIndexDone ? 'background' : 'initial';
  return runWorkspaceIndexCycle(mode, {
    scanEpoch: S.workspaceIndex.scanEpoch,
    complete: mode !== 'initial',
  });
}

// Recursively scan ALL directories to count everything
async function deepScanAll(items, progress = null){
  const tracker = progress || createDeepScanProgress(items);
  paintDeepScanProgress(tracker, { force: true });
  for(const item of items){
    if(!item) continue;
    tracker.visitedUnits += 1;
    if(item.isDir){
      await ensureChildren(item);
      const childCount = Array.isArray(item.children) ? item.children.length : 0;
      tracker.discoveredUnits += childCount;
    }
    paintDeepScanProgress(tracker);
    if(item.isDir && item.children)await deepScanAll(item.children, tracker);
  }
  paintDeepScanProgress(tracker, { force: true });
  return tracker;
}

function flatFiles(items,out=[]){for(const i of items){if(i.isDir&&i.children)flatFiles(i.children,out);else if(!i.isDir)out.push(i);}return out;}

function ensureTopLevelDirectoryInTree(name, handle) {
  if (!Array.isArray(S.tree) || !name || !handle) return;
  const existing = S.tree.find((item) => item?.isDir && item.name === name);
  if (existing) {
    existing.handle = existing.handle || handle;
    return;
  }
  S.tree.push({
    name,
    path: name,
    isDir: true,
    handle,
    children: null,
    expanded: false,
  });
  S.tree.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function renderTree(){
  const c=$('#fileTree');if(!c)return;c.innerHTML='';
  if(!S.tree.length){const e=$('#emptyExp');if(e){e.style.display='flex';c.appendChild(e);}return;}
  const e=$('#emptyExp');if(e)e.style.display='none';
  buildTree(S.tree,c,0);
}

function buildTree(items,parent,depth){
  for(const item of items){
    const el=document.createElement('div');el.className='fi';el.style.paddingLeft=(4+depth*12)+'px';el.dataset.path=item.path;
    if(item.isDir){
      const ch=document.createElement('span');ch.className='fi-ch'+(item.expanded?' open':'');ch.textContent='▸';
      el.appendChild(ch);
      const ic=document.createElement('span');ic.className='fi-i';ic.innerHTML=fIcon(item.name,true);el.appendChild(ic);
      el.appendChild(document.createTextNode(item.name));
      const kids=document.createElement('div');kids.className='fi-kids'+(item.expanded?' open':'');
      if(item.expanded&&item.children)buildTree(item.children,kids,depth+1);
      el.addEventListener('click',async e=>{
        e.stopPropagation();
        item.expanded=!item.expanded;
        ch.classList.toggle('open',item.expanded);
        kids.classList.toggle('open',item.expanded);
        if(item.expanded){
          await ensureChildren(item);
          if(!kids.children.length&&item.children)buildTree(item.children,kids,depth+1);
          // Update count
          S.totalFiles=countLoaded(S.tree);
          const n=$('#fileNum');if(n)n.textContent=S.totalFiles+' files';
        }
      });
      el.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,item);});
      parent.appendChild(el);parent.appendChild(kids);
    } else {
      const sp=document.createElement('span');sp.style.width='12px';sp.style.display='inline-block';el.appendChild(sp);
      const ic=document.createElement('span');ic.className='fi-i';ic.innerHTML=fIcon(item.name,false);el.appendChild(ic);
      el.appendChild(document.createTextNode(item.name));
      el.addEventListener('click',()=>openFile(item));
      el.addEventListener('contextmenu',e=>{e.preventDefault();showCtx(e,item);});
      parent.appendChild(el);
    }
  }
}

/* Context menu */
let ctxTarget=null;
function showCtx(e,item){ctxTarget=item;const m=$('#ctxMenu');if(!m)return;m.style.display='block';m.style.left=Math.min(e.clientX,innerWidth-160)+'px';m.style.top=Math.min(e.clientY,innerHeight-100)+'px';}
document.addEventListener('click',()=>{$('#ctxMenu').style.display='none';ctxTarget=null;});

async function ctxAction(act){
  if(!ctxTarget||!S.dirHandle)return;
  // Capture the target synchronously before async operations yield control
  // to prevent global 'document' click listener from nullifying it.
  const target = ctxTarget; 
  
  let ph=S.dirHandle;
  const parts = target.path.split('/').filter(p => !!p);
  const name = parts.pop(); 
  
  for (const p of parts) {
    try { ph = await ph.getDirectoryHandle(p); } 
    catch { toast('Error','Parent directory not found'); return; }
  }

  if(act==='newFile'){
    const n=prompt('New file name:'); if(!n) return;
    try {
      const targetDir = target.isDir ? await ph.getDirectoryHandle(name) : ph;
      await targetDir.getFileHandle(n, {create:true});
      toast('Created', n); await refreshTree();
    } catch(e) { toast('Error', e.message); }
  }
  if(act==='newFolder'){
    const n=prompt('New folder name:'); if(!n) return;
    try {
      const targetDir = target.isDir ? await ph.getDirectoryHandle(name) : ph;
      await targetDir.getDirectoryHandle(n, {create:true});
      toast('Created', n); await refreshTree();
    } catch(e) { toast('Error', e.message); }
  }
  if(act==='rename'){toast('Rename','Not supported in all browsers yet');}
  if(act==='copyPath'){navigator.clipboard?.writeText(target.path); toast('Copied', target.path);}
  if(act==='delete'){
    if(confirm('Delete "'+target.name+'"?')){
      try {
        await ph.removeEntry(name, {recursive: true});
        // API sync logic
        api('/api/assistant/workspace/file?path=' + encodeURIComponent(target.path), {method:'DELETE'}).catch(()=>{});
        toast('Deleted', name); 
        await refreshTree();
      } catch(e) { toast('Error', e.message); }
    }
  }
}

async function refreshTree(){
  if(!S.dirHandle)return;
  S.workspaceIndex.scanEpoch += 1;
  updateIndexProgressState('scanning', { ratio: 0.08, label: 'Refreshing workspace scan...' });
  S.tree=await fullScan(S.dirHandle);await deepScanAll(S.tree);S.totalFiles=countLoaded(S.tree);renderTree();
  const n=$('#fileNum');if(n)n.textContent=S.totalFiles+' files';
  await runWorkspaceIndexCycle('refresh', { scanEpoch: S.workspaceIndex.scanEpoch, complete: true, deferReadyState: true });
  await initMeshMetadata(S.dirHandle, { force: true, phase: 'refresh' });
  updateIndexProgressState('graph-ready', { ratio: 1 });
}

/* ═══ MONACO ═══ */
function initMonaco(cb){if(typeof require==='undefined')return;require.config({paths:{vs:'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs'}});require(['vs/editor/editor.main'],()=>{S.monacoReady=true;cb();});}
function createEditor(){
  if(S.editor||!S.monacoReady)return;const el=$('#monaco');if(!el)return;el.style.display='block';$('#welcomeScr')?.remove();
  S.editor=monaco.editor.create(el,{value:'',language:'plaintext',theme:S.settings.theme==='light'?'vs':'vs-dark',fontSize:S.settings.fontSize,fontFamily:"'JetBrains Mono',monospace",minimap:{enabled:S.settings.minimap},automaticLayout:true,wordWrap:S.settings.wordWrap?'on':'off',padding:{top:8},scrollBeyondLastLine:false,renderLineHighlight:'all',cursorBlinking:'smooth',smoothScrolling:true,bracketPairColorization:{enabled:true}});
  S.editor.onDidChangeCursorPosition(e=>{$('#stPos')&&($('#stPos').textContent='Ln '+e.position.lineNumber+', Col '+e.position.column);});
  S.editor.onDidChangeModelContent(()=>{if(S.activeTab){S.modified.add(S.activeTab);renderTabs();refreshGitStatus();}});
  registerInlineCompletions();
}

function registerInlineCompletions(){
  let debounceTimer=null;
  let activeAbort=null;
  monaco.languages.registerInlineCompletionsProvider({pattern:'**'},(model,position)=>{
    return {
      provideInlineCompletions(_m,_p,_ctx,token){
        return new Promise((resolve)=>{
          if(debounceTimer)clearTimeout(debounceTimer);
          if(activeAbort){activeAbort.abort();activeAbort=null;}
          debounceTimer=setTimeout(async()=>{
            if(token.isCancellationRequested){resolve({items:[]});return;}
            const abort=new AbortController();
            activeAbort=abort;
            const offset=model.getOffsetAt(position);
            const prefix=model.getValue().slice(0,offset);
            const language=model.getLanguageId();
            try{
              const resp=await fetch('/api/inline-complete',{
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({prefix,language}),
                signal:abort.signal,
              });
              if(!resp.ok||!resp.body){resolve({items:[]});return;}
              let completion='';
              const reader=resp.body.getReader();
              const dec=new TextDecoder();
              while(true){
                const{done,value}=await reader.read();
                if(done)break;
                const chunk=dec.decode(value,{stream:true});
                for(const line of chunk.split('\n')){
                  const t=line.trim();
                  if(!t.startsWith('data:'))continue;
                  const d=t.slice(5).trim();
                  if(d==='[DONE]')break;
                  try{const p=JSON.parse(d);if(p.text)completion+=p.text;}catch{}
                }
              }
              if(!completion||token.isCancellationRequested){resolve({items:[]});return;}
              resolve({items:[{insertText:completion,range:{startLineNumber:position.lineNumber,startColumn:position.column,endLineNumber:position.lineNumber,endColumn:position.column}}]});
            }catch(e){
              if(e.name!=='AbortError')console.warn('[inline-complete]',e.message);
              resolve({items:[]});
            }finally{activeAbort=null;}
          },300);
        });
      },
      freeInlineCompletions(){},
    };
  });
}

/* ═══ TABS ═══ */
function renderTabs(){
  const bar=$('#edTabs');if(!bar)return;bar.innerHTML='';
  S.tabs.forEach(t=>{
    const tab=document.createElement('div');tab.className='tab'+(t.path===S.activeTab?' is-active':'');
    tab.innerHTML=(S.modified.has(t.path)?'<span class="dot"></span>':'')+'<span>'+esc(t.path.split('/').pop())+'</span><button class="tab-x">×</button>';
    tab.addEventListener('click',e=>{if(!e.target.classList.contains('tab-x'))switchTab(t.path);});
    tab.querySelector('.tab-x').addEventListener('click',e=>{e.stopPropagation();closeTab(t.path);});
    bar.appendChild(tab);
  });
}
function switchTab(path){
  const t=S.tabs.find(x=>x.path===path);if(!t)return;S.activeTab=path;S.currentView='editor';
  [$('#opsView'),$('#marketplaceView'),$('#graphView')].forEach(e=>{if(e)e.style.display='none';});
  createEditor();$('#monaco')&&($('#monaco').style.display='block');
  if(S.editor){if(!t.model)t.model=monaco.editor.createModel(t.content||'',langOf(path));S.editor.setModel(t.model);}
  renderTabs();$('#stLang')&&($('#stLang').textContent=langOf(path));
  $$('.fi').forEach(f=>f.classList.toggle('is-active',f.dataset.path===path));
  // Notify Git
  refreshGitStatus();
  // Breadcrumb
  const bc=$('#breadcrumb');if(bc){const parts=path.split('/');bc.innerHTML=parts.map((p,i)=>'<span class="bc-item">'+esc(p)+'</span>'+(i<parts.length-1?'<span class="bc-sep">›</span>':'')).join('');}
}
function closeTab(path){
  const i=S.tabs.findIndex(x=>x.path===path);if(i<0)return;
  if(S.tabs[i].model)S.tabs[i].model.dispose();S.tabs.splice(i,1);
  if(S.activeTab===path){
    if(S.tabs.length) switchTab(S.tabs[Math.max(0,i-1)].path);
    else { S.activeTab=null; showView('editor'); }
  } else {
    renderTabs();
    if(!S.tabs.length) { S.activeTab=null; showView('editor'); }
  }
}
async function openFile(item){
  if(S.tabs.find(x=>x.path===item.path)){switchTab(item.path);return;}
  try{const f=await item.handle.getFile();const txt=await f.text();S.tabs.push({path:item.path,content:txt,model:null,handle:item.handle});switchTab(item.path);}catch(e){toast('Error','Cannot read '+item.name);}
}
window.openFileByPath = function(path) {
  const item = findInTree(S.tree, path);
  if (item) openFile(item);
  else toast('Error', 'File not found locally: ' + path);
};

/* ═══ CHAT ═══ */
function renderMd(text){
  let h=esc(text);
  h=h.replace(/```(\w*)\n([\s\S]*?)```/g,(_,l,c)=>'<div class="msg-code-h"><span>'+(l||'code')+'</span><span class="msg-apply" data-code="'+c.replace(/"/g,'&quot;')+'">Apply</span></div><pre>'+c+'</pre>');
  h=h.replace(/`([^`]+)`/g,'<code>$1</code>');return h;
}
function appendMsg(role,content,showFb=false){
  const c=$('#chatMsgs');if(!c)return;const isU=role==='user';
  const el=document.createElement('div');el.className='msg '+(isU?'msg-user':'msg-assistant');
  const av=isU?(S.user?.name?.[0]||'U').toUpperCase():'<svg width="14" height="14" viewBox="0 0 40 40" fill="none" style="vertical-align:middle;margin-top:-2px"><path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.innerHTML='<div class="msg-av">'+av+'</div><div class="msg-bd"><div class="msg-nm">'+(isU?'You':'Mesh.')+'</div><div class="msg-tx">'+renderMd(content)+'</div>'+(showFb&&!isU?'<div class="msg-fb"><button title="Good"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button><button title="Bad"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button><button title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>':'')+'</div>';
  el.querySelectorAll('.msg-apply').forEach(btn=>{btn.addEventListener('click',()=>{
    if(S.editor&&S.activeTab){const code=btn.dataset.code.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');const sel=S.editor.getSelection();if(sel&&!sel.isEmpty())S.editor.executeEdits('ai',[{range:sel,text:code}]);else{const p=S.editor.getPosition();S.editor.executeEdits('ai',[{range:new monaco.Range(p.lineNumber,p.column,p.lineNumber,p.column),text:code}]);}toast('Applied','Code inserted.');}else toast('Error','Open a file first');
  });});
  // Copy button
  el.querySelectorAll('.msg-fb button[title="Copy"]').forEach(btn=>{btn.addEventListener('click',()=>{navigator.clipboard?.writeText(content);toast('Copied','');});});
  c.appendChild(el);c.scrollTop=c.scrollHeight;
}
function renderChat(){$('#chatMsgs')&&($('#chatMsgs').innerHTML='');S.chat.forEach(m=>appendMsg(m.role,m.content,true));}
async function sendChat(text){
  if(!text.trim())return;S.chat.push({role:'user',content:text});appendMsg('user',text);
  const typing=document.createElement('div');typing.className='msg msg-assistant';typing.id='typEl';
  typing.innerHTML='<div class="msg-av">⬡</div><div class="msg-bd"><div class="msg-nm">Mesh AI</div><div class="msg-tx"><span class="typing"><span>●</span><span>●</span><span>●</span></span></div></div>';
  const msgs=$('#chatMsgs');if(msgs){msgs.appendChild(typing);msgs.scrollTop=msgs.scrollHeight;}
  const btn=$('#btnSend');if(btn)btn.disabled=true;
  try{
    const model=$('#chatModel')?.value||S.settings.model;const mode=$('#chatMode')?.value||'agent';
    let ctx='';if(S.editor&&S.activeTab){const v=S.editor.getModel()?.getValue()||'';if(v.length<15000)ctx='\n\n[mode:'+mode+', file:'+S.activeTab+']\n```\n'+v.slice(0,10000)+'\n```';}
    const messages=[...S.chat];if(ctx)messages[messages.length-1]={role:'user',content:text+ctx};
    const res=await api('/api/assistant/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages})});
    let reply='';const comp=String(res?.contentCompressed||'').trim();
    if(comp){try{const d=await api('/api/assistant/codec/decode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payload:comp})});reply=String(d?.content||'');}catch{}}
    if(!reply)reply=String(res?.content||res?.error||'No response.');
    S.chat.push({role:'assistant',content:reply});$('#typEl')?.remove();appendMsg('assistant',reply,true);
  }catch(e){const m=String(e?.message||'Error');S.chat.push({role:'assistant',content:m});$('#typEl')?.remove();appendMsg('assistant',m,true);}
  finally{if(btn)btn.disabled=false;}
}

/* ═══ SCM (REAL GIT INTEGRATION) ═══ */
async function refreshGitStatus() {
  if (!S.dirHandle) return;
  try {
    const res = await api('/api/assistant/git/status');
    if (res.ok) {
      S.git = {
        branch: res.branch || 'main',
        staged: res.staged || [],
        unstaged: res.unstaged || [],
        untracked: res.untracked || [],
        ahead: res.ahead || 0,
        behind: res.behind || 0
      };
      updateSCM();
    } else {
      S.git = { branch: '', staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0, noRepo: true };
      updateSCM();
    }
  } catch (e) {
    S.git = { branch: '', staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0, noRepo: true };
    updateSCM();
  }
}

function updateSCM() {
  const cl = $('#chgList'); if (!cl) return;
  cl.innerHTML = '';
  
  const bName = $('#branchName'); if (bName) bName.textContent = S.git.branch || 'no branch';
  
  const initPanel = $('#scmInit'); 
  const branchRow = $('.scm-branch');
  const commitRow = $('.scm-row');
  const actRow = $('.scm-acts');
  const secRow = $('.scm-sec');

  if (S.git.noRepo) {
    if (initPanel) initPanel.style.display = 'flex';
    if (branchRow) branchRow.style.display = 'none';
    if (commitRow) commitRow.style.display = 'none';
    if (actRow) actRow.style.display = 'none';
    if (secRow) secRow.style.display = 'none';
    const cc = $('#chgCnt'); if (cc) cc.textContent = '0';
    const badge = $('#scmBadge'); if (badge) badge.style.display = 'none';
    return;
  }

  if (initPanel) initPanel.style.display = 'none';
  if (branchRow) branchRow.style.display = 'flex';
  if (commitRow) commitRow.style.display = 'flex';
  if (actRow) actRow.style.display = 'flex';
  if (secRow) secRow.style.display = 'block';

  const total = S.git.staged.length + S.git.unstaged.length + S.git.untracked.length;
  const cc = $('#chgCnt'); if (cc) cc.textContent = total;
  const badge = $('#scmBadge'); if (badge) {
    badge.textContent = total;
    badge.style.display = total > 0 ? 'flex' : 'none';
  }

  const sections = [
    { label: 'Staged Changes', items: S.git.staged, type: 'staged', icon: 'S' },
    { label: 'Changes', items: S.git.unstaged, type: 'unstaged', icon: 'M' },
    { label: 'Untracked', items: S.git.untracked.map(f => ({ file: f })), type: 'untracked', icon: 'U' }
  ];

  sections.forEach(sec => {
    if (sec.items.length === 0) return;
    const hdr = document.createElement('div');
    hdr.className = 'scm-sec-h';
    hdr.textContent = sec.label + ' (' + sec.items.length + ')';
    cl.appendChild(hdr);

    sec.items.forEach(item => {
      const p = item.file || item;
      const el = document.createElement('div');
      el.className = 'scm-fi';
      el.innerHTML = `<span class="fi-i">${fIcon(p.split('/').pop(), false)}</span><span class="scm-fn">${esc(p.split('/').pop())}</span><span class="scm-s ${item.status || sec.icon}">${item.status || sec.icon}</span>`;
      
      const actions = document.createElement('div');
      actions.className = 'scm-fi-acts';
      if (sec.type === 'staged') {
        actions.innerHTML = `<button title="Unstage" class="sca-i">-(V)</button>`;
        actions.querySelector('button').onclick = () => gitUnstage(p);
      } else {
        actions.innerHTML = `<button title="Stage" class="sca-i">+(V)</button>`;
        actions.querySelector('button').onclick = () => gitStage(p);
      }
      el.appendChild(actions);
      cl.appendChild(el);
    });
  });
}

async function gitStage(path) {
  try {
    await api('/api/assistant/git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [path] }) });
    toast('Staged', path);
    await refreshGitStatus();
  } catch (e) { toast('Error', e.message); }
}

async function gitUnstage(path) {
  try {
    await api('/api/assistant/git/unstage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [path] }) });
    toast('Unstaged', path);
    await refreshGitStatus();
  } catch (e) { toast('Error', e.message); }
}

async function gitCommit() {
  const m = $('#commitMsg')?.value || '';
  if (!m) { toast('Error', 'Message required'); return; }
  try {
    const res = await api('/api/assistant/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
    if (res.ok) {
      toast('Committed', m);
      $('#commitMsg').value = '';
      await refreshGitStatus();
      if (S.term) S.term.writeln('\x1b[32m✔ Git Commit successful: ' + m + '\x1b[0m');
    }
  } catch (e) { toast('Error', e.message); }
}

async function gitPull() {
  try {
    toast('Git Pull', 'Updating...');
    const res = await api('/api/assistant/git/pull', { method: 'POST' });
    if (res.ok) {
      toast('Updated', 'Git pull completed.');
      await refreshGitStatus();
      if (S.term) S.term.writeln('\x1b[34m● git pull\x1b[0m\r\n' + (res.output || 'Already up to date.'));
    }
  } catch (e) { toast('Error', e.message); }
}

async function gitPush() {
  try {
    toast('Git Push', 'Syncing...');
    const res = await api('/api/assistant/git/push', { method: 'POST' });
    if (res.ok) {
      toast('Pushed', 'Git push completed.');
      await refreshGitStatus();
      if (S.term) S.term.writeln('\x1b[34m● git push\x1b[0m\r\n' + (res.output || 'Sync successful.'));
    }
  } catch (e) { toast('Error', e.message); }
}

async function gitInit() {
  try {
    toast('Git Init', 'Initializing...');
    const res = await api('/api/assistant/git/init', { method: 'POST' });
    if (res.ok) {
      toast('Initialized', 'Repository created successfully.');
      await refreshGitStatus();
      if (S.term) S.term.writeln('\x1b[32m✔ Git repository initialized.\x1b[0m');
    }
  } catch (e) { toast('Error', e.message); }
}

async function gitInit() {
  try {
    toast('Git Init', 'Initializing...');
    const res = await api('/api/assistant/git/init', { method: 'POST' });
    if (res.ok) {
      toast('Initialized', 'Repository created successfully.');
      await refreshGitStatus();
      if (S.term) S.term.writeln('\x1b[32m✔ Git repository initialized.\x1b[0m');
    }
  } catch (e) { toast('Error', e.message); }
}

/* ═══ TERMINAL (WebSocket) ═══ */
function terminalMountSelector() {
  return S.surfaceMode === 'terminal' ? '#terminalSurfacePrimary' : '#termContainer';
}

function openTerminal(forceCloud=false, options={}){
  const mountSelector = options.mount || terminalMountSelector();
  const mountEl = $(mountSelector);
  if (!mountEl) {
    toast('Terminal', 'Terminal surface is still booting...');
    return;
  }
  const p=$('#bottomPanel'),r=$('#rsTerm');
  if (S.surfaceMode === 'terminal') {
    if(p)p.style.display='none';
    if(r)r.style.display='none';
  } else {
    if(p)p.style.display='flex';
    if(r)r.style.display='block';
  }
  if (S.surfaceMode === 'terminal') updateWorkspaceSurfaceUI();
  if(S.term && S.termMountSelector !== mountSelector){
    if(S.termWs){try{S.termWs.close();}catch{}}
    S.term.dispose();
    S.term=null;
    S.termFit=null;
    S.termWs=null;
  }
  if(S.term && !forceCloud){S.termFit?.fit();return;}
  try{
    const TermClass = window.Terminal;
    if(!TermClass){
      if(!S._termWaiting){
        S._termWaiting=true;
        window.addEventListener('xterm-ready',()=>openTerminal(),{once:true});
        toast('Terminal','Standardizing library connection...');
      }
      return;
    }
    const FitClass = window.FitAddon;
    if(!S.term){
      S.term=new TermClass({theme:{background:'#1a1a1a',foreground:'#ccc',cursor:'#0098ff',cursorAccent:'#1a1a1a'},fontFamily:"'JetBrains Mono',monospace",fontSize:13,cursorBlink:true,scrollback:5000});
      if(FitClass){S.termFit=new FitClass();S.term.loadAddon(S.termFit);}
      S.term.open(mountEl);
      S.termMountSelector = mountSelector;
    }
    setTimeout(()=>S.termFit?.fit(),100);
    /* Terminal host resolution — always connect to the server that served the page */
    const tHost = location.host;
    const prot = location.protocol==='https:'?'wss:':'ws:';
    const ws=new WebSocket(prot+'//'+tHost+'/terminal');S.termWs=ws;
    ws.onopen=()=>{
      S.term.writeln('\x1b[36m\u25cf Terminal connected\x1b[0m');
      const {cols,rows}=S.term;ws.send(JSON.stringify({type:'resize',cols,rows}));
    };
    ws.onmessage=ev=>{try{const m=JSON.parse(ev.data);if(m.type==='output')S.term.write(m.data);if(m.type==='exit')S.term.writeln('\r\n\x1b[31m\u25cf Process exited\x1b[0m');}catch{S.term.write(ev.data);}};
    ws.onclose=()=>S.term.writeln('\r\n\x1b[33m\u25cf Connection closed\x1b[0m');
    ws.onerror=()=>{
      S.term.writeln('\r\n\x1b[31m\u25cf Terminal connection failed. Server might be offline.\x1b[0m');
    };
    S.term.onData(d=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'input',data:d}));});
    S.term.onResize(({cols,rows})=>{if(ws.readyState===1)ws.send(JSON.stringify({type:'resize',cols,rows}));});
  }catch(e){console.error(e);toast('Error','Terminal init failed: '+e.message);}
}
function closeTerminal(){$('#bottomPanel')&&($('#bottomPanel').style.display='none');$('#rsTerm')&&($('#rsTerm').style.display='none');if(S.termWs){try{S.termWs.close();}catch{}}if(S.term){S.term.dispose();S.term=null;S.termFit=null;S.termWs=null;S.termMountSelector='';}if(S.surfaceMode==='terminal')updateWorkspaceSurfaceUI();}
function toggleTerm(){const p=$('#bottomPanel');if(p&&p.style.display!=='none'&&p.style.display!=='')closeTerminal();else openTerminal();}

/* ═══ OPS VIEW ═══ */
function genComp(){
  const fl=flatFiles(S.tree);
  if(!fl.length)return[{n:'index.js',o:145200,c:38700},{n:'app.html',o:12800,c:3900},{n:'styles.css',o:28400,c:7100},{n:'utils.ts',o:34500,c:9200},{n:'server.js',o:253787,c:56200},{n:'package.json',o:2100,c:890},{n:'README.md',o:5600,c:2100},{n:'config.yml',o:1800,c:620}];
  // Real-ish data based on workspace structure
  return fl.slice(0,100).map(f=>{
    const ext=(f.path.split('.').pop()||'').toLowerCase();
    const isCode=['js','ts','py','go','rs','java','cpp','c','h','html','css'].includes(ext);
    const baseSize=isCode?Math.floor(Math.random()*45000+2500):Math.floor(Math.random()*850000+10000);
    const r=isCode?(.15+Math.random()*.25):(.5+Math.random()*.4); // Code compresses better than binaries/others in our simulation
    return{n:f.path.split('/').pop(),o:baseSize,c:Math.floor(baseSize*r)};
  });
}
function drawDonut(cv,ratio){const ctx=cv.getContext('2d'),w=cv.width,h=cv.height,cx=w/2,cy=h/2,r=Math.min(w,h)/2-8,lw=14;ctx.clearRect(0,0,w,h);ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--bd').trim();ctx.lineWidth=lw;ctx.stroke();ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+2*Math.PI*ratio);ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--grn').trim();ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();}
function renderOps(){
  const v=$('#opsView');if(!v)return;
  const data=genComp();const tO=data.reduce((s,d)=>s+d.o,0),tC=data.reduce((s,d)=>s+d.c,0),ratio=tO?1-tC/tO:0;
  v.innerHTML='<div class="fv-scr"><h2 class="fv-t">Operations & Compression Analytics</h2><div class="ops-stats"><div class="ops-card"><canvas id="compChart" width="120" height="120"></canvas><div class="ops-big" id="compRatio">'+Math.round(ratio*100)+'% saved</div><div class="ops-lbl">Compression</div></div><div class="ops-card"><div class="ops-big">'+fmtB(tO)+'</div><div class="ops-lbl">Original</div></div><div class="ops-card"><div class="ops-big">'+fmtB(tC)+'</div><div class="ops-lbl">Compressed</div></div><div class="ops-card"><div class="ops-big">'+data.length+'</div><div class="ops-lbl">Files</div></div></div><h3 class="fv-sub">File Breakdown</h3><table class="ops-tbl"><thead><tr><th>File</th><th>Original</th><th>Compressed</th><th>Saved</th><th></th></tr></thead><tbody>'+data.map(d=>{const sv=d.o?Math.round((1-d.c/d.o)*100):0;return'<tr><td>'+esc(d.n)+'</td><td>'+fmtB(d.o)+'</td><td>'+fmtB(d.c)+'</td><td>'+sv+'%</td><td><div class="cbar"><div class="cbar-f" style="width:'+sv+'%"></div></div></td></tr>';}).join('')+'</tbody></table></div>';
  setTimeout(()=>{const cv=v.querySelector('#compChart');if(cv)drawDonut(cv,ratio);},50);
}

/* ═══ SETTINGS LOGIC ═══ */
function loadS(){try{Object.assign(S.settings,JSON.parse(localStorage.getItem('meshSettings')||'{}'));}catch{}applyTheme(S.settings.theme);}
function save(){localStorage.setItem('meshSettings',JSON.stringify(S.settings));}
function applyTheme(t){S.settings.theme=t;document.documentElement.dataset.theme=t;if(S.editor)monaco.editor.setTheme(t==='light'?'vs':'vs-dark');save();}
async function loadUserStore(){try{const d=await api('/api/user/store?keys=meshApiKeys,meshAppearance,meshSwitches,meshAiBehaviour,meshWorkspaceConfig,meshAccountProfile');const data=d?.data||{};
  const ap=data.meshAppearance||{};
  if(ap.theme)applyTheme(ap.theme);
  if(ap.accent&&ap.accent!=='indigo')document.documentElement.dataset.accent=ap.accent;
  else delete document.documentElement.dataset.accent;
  if(ap.density&&ap.density!=='default')document.documentElement.dataset.density=ap.density;
  else delete document.documentElement.dataset.density;
  if(ap.motion&&ap.motion!=='full')document.documentElement.dataset.motion=ap.motion;
  else delete document.documentElement.dataset.motion;
  if(ap.fontSize){S.settings.fontSize=Number(ap.fontSize)||14;if(S.editor)S.editor.updateOptions({fontSize:S.settings.fontSize});}
  if(ap.minimap!==undefined){S.settings.minimap=ap.minimap;if(S.editor)S.editor.updateOptions({minimap:{enabled:!!ap.minimap}});}
  if(ap.wordWrap!==undefined){S.settings.wordWrap=ap.wordWrap;if(S.editor)S.editor.updateOptions({wordWrap:ap.wordWrap?'on':'off'});}
  const FONT_MAP={berkeley:"'JetBrains Mono',monospace",mono:'monospace',fira:"'Fira Code',monospace"};
  if(ap.font&&FONT_MAP[ap.font]){S.settings.font=ap.font;document.documentElement.style.setProperty('--m',FONT_MAP[ap.font]);if(S.editor)S.editor.updateOptions({fontFamily:FONT_MAP[ap.font]});}
  if(data.meshAiBehaviour){if(data.meshAiBehaviour.model)S.settings.model=data.meshAiBehaviour.model;const sel=$('#chatModel');if(sel&&data.meshAiBehaviour.model){for(const o of sel.options){if(o.value===data.meshAiBehaviour.model){sel.value=data.meshAiBehaviour.model;break;}}}}
  if(data.meshSwitches)S.switches=Object.assign(S.switches||{},data.meshSwitches);
  if(data.meshWorkspaceConfig)S.workspaceConfig=Object.assign(S.workspaceConfig||{},data.meshWorkspaceConfig);
  if(data.meshAccountProfile){S.accountProfile=data.meshAccountProfile;const avatar=$('#abUser');if(avatar&&data.meshAccountProfile.name)avatar.textContent=data.meshAccountProfile.name.charAt(0).toUpperCase();}
}catch{}}

/* ═══ SEARCH ═══ */
function initSearch(){const inp=$('#searchIn');if(!inp)return;inp.addEventListener('input',()=>{const q=inp.value.trim().toLowerCase();const out=$('#searchOut');if(!out)return;if(!q){out.innerHTML='';return;}const flat=flatFiles(S.tree);const hits=flat.filter(f=>f.path.toLowerCase().includes(q)).slice(0,60);out.innerHTML=hits.map(f=>'<div class="s-hit" data-p="'+esc(f.path)+'">'+esc(f.path)+'</div>').join('');out.querySelectorAll('.s-hit').forEach(el=>{el.addEventListener('click',()=>{const item=findInTree(S.tree,el.dataset.p);if(item)openFile(item);});});});}
function findInTree(items,p){for(const i of items){if(!i.isDir&&i.path===p)return i;if(i.isDir&&i.children){const r=findInTree(i.children,p);if(r)return r;}}return null;}

/* ═══ RESIZE ═══ */
function resizer(hSel,tSel,prop,min,max,dir='h'){
  const handle=$(hSel);if(!handle)return;let d=false,s0=0,sz0=0;
  handle.addEventListener('mousedown',e=>{d=true;s0=dir==='h'?e.clientX:e.clientY;sz0=$(tSel)?.[dir==='h'?'offsetWidth':'offsetHeight']||200;handle.classList.add('drag');document.body.style.cursor=dir==='h'?'col-resize':'row-resize';document.body.style.userSelect='none';e.preventDefault();});
  addEventListener('mousemove',e=>{if(!d)return;const delta=s0-(dir==='h'?e.clientX:e.clientY);document.documentElement.style.setProperty(prop,Math.max(min,Math.min(max,sz0+delta))+'px');});
  addEventListener('mouseup',()=>{if(!d)return;d=false;handle.classList.remove('drag');document.body.style.cursor='';document.body.style.userSelect='';S.editor?.layout();S.termFit?.fit();});
}

/* ═══ KEYBOARD ═══ */
document.addEventListener('keydown',e=>{
  const m=e.metaKey||e.ctrlKey;
  if(m&&e.shiftKey&&e.key==='E'){e.preventDefault();setPanel('explorer');}
  if(m&&e.shiftKey&&e.key==='F'){e.preventDefault();setPanel('search');$('#searchIn')?.focus();}
  if(m&&e.shiftKey&&e.key==='G'){e.preventDefault();setPanel('scm');}
  if(m&&e.key===','){e.preventDefault();openStandaloneSettings('account', { from: 'shortcut' });}
  if(m&&e.key==='`'){e.preventDefault();toggleTerm();}
  if(m&&e.key==='b'){e.preventDefault();toggleSidebar();}
  if(m&&e.key==='j'){e.preventDefault();toggleTerm();}
});

function toggleSidebar(){S.sidebarVisible=!S.sidebarVisible;$('#sidebar').style.display=S.sidebarVisible?'flex':'none';$('#rsSb').style.display=S.sidebarVisible?'block':'none';S.editor?.layout();saveShellSnapshot();}
function toggleChat(){S.chatVisible=!S.chatVisible;$('#chatPanel').style.display=S.chatVisible?'flex':'none';$('#rsChat').style.display=S.chatVisible?'block':'none';S.editor?.layout();saveShellSnapshot();}

function createNewFile() {
  return (async () => {
    if(!S.dirHandle){toast('Error','Open folder first');return;}
    const n=prompt('New file name:');if(!n)return;
    try{await S.dirHandle.getFileHandle(n,{create:true});toast('Created',n);await refreshTree();}catch(e){toast('Error',e.message);}
  })();
}

function createNewFolder() {
  return (async () => {
    if(!S.dirHandle){toast('Error','Open folder first');return;}
    const n=prompt('New folder name:');if(!n)return;
    try{await S.dirHandle.getDirectoryHandle(n,{create:true});toast('Created',n);await refreshTree();}catch(e){toast('Error',e.message);}
  })();
}

function collapseAllFolders() {
  function collapse(items){items.forEach(i=>{if(i.isDir){i.expanded=false;if(i.children)collapse(i.children);}});}
  collapse(S.tree);
  renderTree();
}

function registerDefaultShellActions() {
  ['explorer','search','scm','debug','extensions'].forEach((panel) => {
    registerShellAction(`panel:${panel}`, () => {
      setPanel(panel);
      if (S.currentView !== 'editor') showView('editor');
      saveShellSnapshot();
    });
  });
  registerShellAction('settings:open', () => openStandaloneSettings('account', { from: 'shell' }));
  registerShellAction('view:ops', () => showView('ops'));
  registerShellAction('view:graph', () => showView('graph'));
  registerShellAction('view:marketplace', () => showView('marketplace'));
  registerShellAction('surface:editor', () => setWorkspaceSurface('editor'));
  registerShellAction('surface:terminal', () => setWorkspaceSurface('terminal'));
  registerShellAction('surface:voice', () => setWorkspaceSurface('voice'));
  registerShellAction('workspace:open-folder', () => openFolder());
  registerShellAction('workspace:restore-folder', () => restoreFolder({ interactive: true }));
  registerShellAction('workspace:refresh', () => refreshTree());
  registerShellAction('workspace:collapse-all', () => collapseAllFolders());
  registerShellAction('workspace:new-file', () => createNewFile());
  registerShellAction('workspace:new-folder', () => createNewFolder());
  registerShellAction('shell:toggle-sidebar', () => toggleSidebar());
  registerShellAction('shell:toggle-chat', () => toggleChat());
  registerShellAction('shell:focus-search', () => { setPanel('search'); $('#searchIn')?.focus(); if (S.currentView !== 'editor') showView('editor'); });
  registerShellAction('terminal:toggle', () => toggleTerm());
}

/* ═══ BINDINGS ═══ */
function bind(){
  registerDefaultShellActions();
  $$('.ab[data-panel]').forEach(b=>b.addEventListener('click',()=>runShellAction(`panel:${b.dataset.panel}`)));
  wireShellAction('#abSettings', 'settings:open');
  wireShellAction('#abOps', 'view:ops');
  wireShellAction('#btnTopSettings', 'settings:open');
  wireShellAction('#btnSurfaceEditor', 'surface:editor');
  wireShellAction('#btnSurfaceTerminal', 'surface:terminal');
  wireShellAction('#btnSurfaceVoice', 'surface:voice');
  wireShellAction('#abGraph', 'view:graph');
  wireShellAction('#btnOpenFolder', 'workspace:open-folder');
  wireShellAction('#btnOpen2', 'workspace:open-folder');
  wireShellAction('#wOpen', 'workspace:open-folder');
  wireShellAction('#btnRefresh', 'workspace:refresh');
  wireShellAction('#btnCollapseAll', 'workspace:collapse-all');
  wireShellAction('#btnNewFile', 'workspace:new-file');
  wireShellAction('#btnNewFolder', 'workspace:new-folder');
  wireShellAction('#btnOpenMarketplace', 'view:marketplace');
  wireShellAction('#btnToggleSB', 'shell:toggle-sidebar');
  wireShellAction('#btnToggleChat', 'shell:toggle-chat');
  wireShellAction('#btnGSearch', 'shell:focus-search');
  wireShellAction('#btnStTerm', 'terminal:toggle');
  wireShellAction('#wRestore', 'workspace:restore-folder');
  wireShellAction('#btnRestore2', 'workspace:restore-folder');
  $('#abUser')?.addEventListener('click',()=>openStandaloneSettings('account',{from:'avatar'}));
  $('#wChat')?.addEventListener('click',()=>$('#chatIn')?.focus());
  $('#btnVoiceSurfaceStart')?.addEventListener('click', triggerVoiceSurfaceStart);
  $('#btnVoiceSurfaceStop')?.addEventListener('click', () => $('#vcMic')?.click());
  $('#btnVoiceSurfaceChat')?.addEventListener('click', () => {
    setWorkspaceSurface('editor');
    ensureChatVisible();
    $('#chatIn')?.focus();
  });
  $('#btnTerminalSurfaceSingle')?.addEventListener('click', () => {
    $('#terminalSurfaceGrid')?.classList.remove('is-grid');
    $('#terminalSurfaceGrid')?.classList.add('is-single');
  });
  $('#btnTerminalSurfaceGrid')?.addEventListener('click', () => {
    $('#terminalSurfaceGrid')?.classList.remove('is-single');
    $('#terminalSurfaceGrid')?.classList.add('is-grid');
  });
  $('#btnTerminalSurfaceNewSplit')?.addEventListener('click', () => {
    $('#terminalSurfaceGrid')?.classList.remove('is-single');
    $('#terminalSurfaceGrid')?.classList.add('is-grid');
    toast('Terminal', 'Grid layout ready for additional live panes.');
  });
  $('#btnPurgeGraph')?.addEventListener('click',purgeWorkspaceMetadata);
  // Context menu
  $$('#ctxMenu .ctx-i').forEach(b=>b.addEventListener('click',()=>ctxAction(b.dataset.act)));
  // Accordion
  $$('.sb-acc-h').forEach(h=>{h.addEventListener('click',()=>{const body=document.querySelector('.sb-acc-body[data-acc="'+h.dataset.acc+'"]');if(body){body.classList.toggle('open');h.textContent=(body.classList.contains('open')?'▾ ':'▸ ')+h.dataset.acc.toUpperCase();}});});
  // Auth
  $('#loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const em=$('#emailIn')?.value?.trim()||'',pw=$('#pwIn')?.value?.trim()||'';if(!em||!pw)return;const b=$('#loginBtn');if(b)b.disabled=true;try{const d=await api('/api/auth/login',{method:'POST',skip:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});applyUser(d?.user);setAuth(false);await bootstrap();}catch(e){setAuth(true,String(e?.message||'Login failed'));}finally{if(b)b.disabled=false;}});
  $('#btnLogout')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});}catch{}S.user=null;setAuth(true,'');});
  // Chat
  $('#btnSend')?.addEventListener('click',()=>{const ta=$('#chatIn');const t=ta?.value||'';if(ta){ta.value='';ta.style.height='auto';}sendChat(t);});
  $('#chatIn')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#btnSend')?.click();}});
  $('#chatIn')?.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px';});
  $('#btnNewChat')?.addEventListener('click',()=>{S.chat=[{role:'assistant',content:'New chat. How can I help?'}];renderChat();});
  $('#btnAttach')?.addEventListener('click',()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.addEventListener('change',()=>{Array.from(inp.files||[]).forEach(f=>{const r=new FileReader();r.onload=()=>{const t=r.result;S.chat.push({role:'user',content:'[📎 '+f.name+']\n```\n'+t.slice(0,5000)+'\n```'});appendMsg('user','[📎 '+f.name+'] ('+fmtB(t.length)+')');};r.readAsText(f);});});inp.click();});
  // SCM
  $('#btnCommit')?.addEventListener('click', gitCommit);
  $('#btnPull')?.addEventListener('click', gitPull);
  $('#btnPush')?.addEventListener('click', gitPush);
  $('#btnGitInit')?.addEventListener('click', gitInit);
  // Terminal
  $('#btnToggleTerm')?.addEventListener('click',toggleTerm);$('#btnTermNew')?.addEventListener('click',()=>{closeTerminal();openTerminal();});
  $('#btnTermClose')?.addEventListener('click',closeTerminal);$('#btnTermKill')?.addEventListener('click',closeTerminal);
    $('#btnTermMax')?.addEventListener('click',()=>{const p=$('#bottomPanel');if(p)p.style.height=(p.offsetHeight>300?'200':'400')+'px';S.termFit?.fit();S.editor?.layout();});
  // Bottom panel tabs
  $$('.bp-tab').forEach(t=>{t.addEventListener('click',()=>{$$('.bp-tab').forEach(x=>x.classList.toggle('is-active',x===t));$$('.bp-content').forEach(c=>c.classList.toggle('is-active',c.dataset.bp===t.dataset.bp));if(t.dataset.bp==='terminal')openTerminal();});});
  // Resize
  resizer('#rsChat','#chatPanel','--ch-w',260,700);
  resizer('#rsSb','#sidebar','--sb-w',160,500);
  // Terminal resize
  const rT=$('#rsTerm');if(rT){let d=false,s0=0,h0=0;rT.addEventListener('mousedown',e=>{d=true;s0=e.clientY;h0=$('#bottomPanel')?.offsetHeight||200;document.body.style.cursor='row-resize';document.body.style.userSelect='none';e.preventDefault();});addEventListener('mousemove',e=>{if(!d)return;const h=Math.max(80,Math.min(500,h0+(s0-e.clientY)));$('#bottomPanel').style.height=h+'px';S.termFit?.fit();});addEventListener('mouseup',()=>{if(!d)return;d=false;document.body.style.cursor='';document.body.style.userSelect='';S.termFit?.fit();S.editor?.layout();});}
  window.addEventListener('resize',()=>{S.termFit?.fit();S.editor?.layout();});
  window.addEventListener('beforeunload',()=>saveShellSnapshot({ reason: 'unload' }));
  auditShellWiring();
  initSearch();
  updateWorkspaceSurfaceUI();
}

/* ═══ BOOTSTRAP ═══ */
async function refreshOps(){try{const d=await api('/api/app/ops');S.ops=d||{};}catch{}}
async function bootstrap(){loadS();await Promise.allSettled([refreshOps(),loadUserStore(),refreshGitStatus()]);setInterval(()=>refreshOps().catch(()=>{}),15000);}
async function init(){
  bind();loadS();renderChat();initMonaco(()=>{});
  const params = new URLSearchParams(window.location.search);
  const forceLogin = params.get('login') === '1';

  if (forceLogin) {
    setAuth(true, '');
    return;
  }

  const u = await api('/api/auth/session',{skip:true}).then(d=>d?.user||null).catch(()=>null);
  if(!u){setAuth(true,'');return;}
  applyUser(u);setAuth(false);await bootstrap();
  const snapshot = readShellSnapshot();
  applyShellSnapshot(snapshot);
  if (snapshot?.reason === 'open-settings') {
    await restoreFolder({ interactive: false, reopenPath: snapshot.activeTabPath });
  }
  // Check for saved workspace
  if (window.idbKeyval) {
    const h = await idbKeyval.get('last-folder');
    if (h) {
      if ($('#wRestore')) $('#wRestore').style.display = 'flex';
      if ($('#btnRestore2')) $('#btnRestore2').style.display = 'inline-block';
    }
  }
}
document.addEventListener('DOMContentLoaded',()=>void init());

/* ═══ EXPOSE STATE FOR FEATURE MODULES ═══ */
window.MeshState = S;
window.MeshAPI = api;
window.MeshEditor = { get editor(){ return S.editor; }, get monaco(){ return typeof monaco !== 'undefined' ? monaco : null; } };
window.MeshActions = {
  openFile, openFolder, switchTab, closeTab, sendChat, appendMsg, renderMd,
  refreshTree, refreshGitStatus, openTerminal, closeTerminal, toggleTerm,
  showView, setPanel, toast, findInTree, flatFiles, langOf, esc, fIcon,
  renderChat, renderTabs, applyTheme, createEditor, openStandaloneSettings,
  runShellAction, saveShellSnapshot, setWorkspaceSurface,
  get tabs(){ return S.tabs; },
  get activeTab(){ return S.activeTab; },
  get tree(){ return S.tree; },
  get dirHandle(){ return S.dirHandle; },
  get dirName(){ return S.dirName; },
  get workspaceIndex(){ return S.workspaceIndex; },
};

/* Emit lifecycle events */
const _origSendChat = sendChat;
const _origOpenFile = openFile;
const _origSwitchTab = switchTab;

/* Patch sendChat to emit events */
async function sendChatWrapped(text) {
  if (window.MeshBus) window.MeshBus.emit('chat:before-send', { text });
  await _origSendChat(text);
  if (window.MeshBus) window.MeshBus.emit('chat:after-send', { text });
}
// Replace the chat send binding
const _sendBtn = document.querySelector('#btnSend');
if (_sendBtn) {
  _sendBtn.replaceWith(_sendBtn.cloneNode(true));
  document.querySelector('#btnSend')?.addEventListener('click', () => {
    const ta = document.querySelector('#chatIn');
    const t = ta?.value || '';
    if (ta) { ta.value = ''; ta.style.height = 'auto'; }
    sendChatWrapped(t);
  });
}

if (window.MeshBus) window.MeshBus.emit('mesh:ready', { state: S });
})();
