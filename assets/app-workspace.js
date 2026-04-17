/* Mesh AI IDE v4 — Full Antigravity Clone */
(function(){
const $=(s,r=document)=>r.querySelector(s);
const $$=(s,r=document)=>Array.from(r.querySelectorAll(s));

/* ═══ STATE ═══ */
const S={
  user:null,
  chat:[{role:'assistant',content:"Hi! I'm Mesh AI, your coding assistant. Open a folder to start editing, or ask me anything about code, architecture, or debugging."}],
  tree:[],totalFiles:0,
  tabs:[],activeTab:null,dirHandle:null,dirName:'',workspaceId:'',
  editor:null,monacoReady:false,modified:new Set(),
  ops:{pending:[],history:[]},
  settings:{theme:'dark',fontSize:14,wordWrap:true,minimap:true,model:'claude-sonnet-4-6'},
  switches:{},
  workspaceConfig:{},
  accountProfile:null,
  termWs:null,term:null,termFit:null,
  termAgentPollInterval:null,termAgentToken:null,termAgentMeshUrl:null,
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
  },
  // path → { rawBytes, capsuleBytes } — populated from sync responses
  compressionMap: new Map(),
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
  const workspaceId = workspaceIdForCurrentFolder();
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
function toast(t,m){const s=$('#toasts');if(!s)return;const e=document.createElement('div');e.className='toast';const strong=document.createElement('strong');strong.textContent=String(t||'');e.appendChild(strong);if(m){const span=document.createElement('span');span.textContent=String(m||'');e.appendChild(span);}s.appendChild(e);setTimeout(()=>{e.style.opacity='0'},2500);setTimeout(()=>e.remove(),3000);}
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
  if (S.workspaceId) return S.workspaceId;
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
      try {
        const content = await entry.file.text();
        batchFiles.push({ path: entry.path, content });
      } catch (readErr) {
        console.warn('[mesh-index] file read failed, skipping:', entry.path, readErr);
      }
    }
    if (!batchFiles.length) { synced += slice.length; continue; }
    let syncResult = null;
    try {
      syncResult = await api('/api/assistant/workspace/sync', {
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
    } catch (syncErr) {
      console.warn('[mesh-index] batch sync failed, continuing:', syncErr?.message || syncErr);
    }
    if (syncResult?.workspaceId) S.workspaceId = syncResult.workspaceId;
    if (Array.isArray(syncResult?.compressionStats)) {
      syncResult.compressionStats.forEach(e => { if (e.rawBytes > 0) S.compressionMap.set(e.path, e); });
    }
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
    const delResult = await api('/api/assistant/workspace/sync', {
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
    if (delResult?.workspaceId) S.workspaceId = delResult.workspaceId;
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
  if (modelLabel) modelLabel.textContent = ($('#chatModel')?.selectedOptions?.[0]?.textContent || S.settings.model || 'Claude Sonnet 4.6').trim();
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
async function api(u,o){
  const c=o||{};
  const method=(c.method||'GET').toUpperCase();
  const headers={...(c.headers||{})};
  if(['POST','PUT','PATCH','DELETE'].includes(method)&&window.MeshCsrf){
    try{headers['X-CSRF-Token']=await window.MeshCsrf.getToken();}catch{}
  }
  const r=await fetch(u,{method,headers,body:c.body,credentials:'same-origin'});
  if(r.status===403&&window.MeshCsrf&&['POST','PUT','PATCH','DELETE'].includes(method)){
    const fresh=await window.MeshCsrf.getToken();
    headers['X-CSRF-Token']=fresh;
    const retry=await fetch(u,{method,headers,body:c.body,credentials:'same-origin'});
    const d2=await retry.json().catch(()=>({}));
    if(!retry.ok){if(retry.status===401&&!c.skip)setAuth(true,'Session expired.');throw new Error(d2?.error||'Error '+retry.status);}
    return d2;
  }
  const d=await r.json().catch(()=>({}));
  if(!r.ok){if(r.status===401&&!c.skip)setAuth(true,'Session expired.');throw new Error(d?.error||'Error '+r.status);}
  return d;
}

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
  if(v==='ops'){$('#opsView').style.display='block';loadCompressionMap().then(()=>{renderOps();renderTree();});addViewTab('ops','📊 Operations');}
  else if(v==='marketplace'){$('#marketplaceView').style.display='block';const mf=$('#marketplaceFrame');if(mf&&!mf.src&&mf.dataset.src)mf.src=mf.dataset.src;addViewTab('marketplace','🛍 Marketplace');}
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
  const tabSpan=document.createElement('span');tabSpan.textContent=String(label||'');const tabX=document.createElement('button');tabX.className='tab-x';tabX.textContent='×';tab.appendChild(tabSpan);tab.appendChild(tabX);
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
  }}catch(e){console.error('[mesh] file scan error at "'+prefix+'"',e);}
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

function seedCompressionMapFromTree(){
  const files=flatFiles(S.tree||[]);
  for(const item of files){
    if(!item.path||!isIndexableWorkspacePath(item.path)) continue;
    if(S.compressionMap.has(item.path)) continue;
    S.compressionMap.set(item.path,{path:item.path,rawBytes:item.size||0,capsuleBytes:0,status:'pending'});
  }
}

async function openFolder(){
  if(!('showDirectoryPicker' in window)){toast('Error','Requires Chromium browser');return;}
  try{
    const h=await window.showDirectoryPicker({mode:'readwrite'});
    S.dirHandle=h;S.dirName=h.name;S.workspaceId='';S.compressionMap.clear();
    resetWorkspaceIndexState();
    const title=$('#tbTitle');if(title)title.textContent='Mesh AI - '+h.name;
    const prog=$('#scanProg');if(prog)prog.style.display='inline';
    toast('Scanning','"'+h.name+'"...');
    updateIndexProgressState('scanning', { ratio: 0.08, label: 'Preparing workspace scan...' });
    S.tree=await fullScan(h);
    seedCompressionMapFromTree();
    renderTree();
    const f=$('#fileFoot');if(f)f.style.display='flex';
    await runWorkspaceIndexCycle('initial', { scanEpoch: S.workspaceIndex.scanEpoch, complete: false });
    /* Deep scan in background, then re-index the rest */
    const DEEP_SCAN_TIMEOUT_MS = 30000;
    const scanAbort = { aborted: false };
    const scanTimeout = setTimeout(() => {
      scanAbort.aborted = true;
      toast('Mesh', 'Scan timeout - indexing partial workspace');
    }, DEEP_SCAN_TIMEOUT_MS);
    deepScanAll(S.tree, null, scanAbort).then(async()=>{
      clearTimeout(scanTimeout);
      S.totalFiles=countLoaded(S.tree);
      if(prog)prog.style.display='none';
      const n=$('#fileNum');if(n)n.textContent=S.totalFiles+' files';
      toast('Done',S.totalFiles+' files in "'+h.name+'"');
      seedCompressionMapFromTree();
      renderTree();
      if(S.currentView==='ops') renderOps();
      await runWorkspaceIndexCycle('background', { scanEpoch: S.workspaceIndex.scanEpoch, complete: true, deferReadyState: true });
      await initMeshMetadata(h, { force: true, phase: 'background-complete', attachToTree: true });
      updateIndexProgressState('graph-ready', { ratio: 1 });
      await refreshOps();
      loadCompressionMap().then(() => { renderTree(); if (S.currentView === 'ops') renderOps(); });
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
    } catch (depErr) { console.error('[mesh] dependency map generation failed', depErr); }
    
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
    S.dirHandle = h; S.dirName = h.name; S.workspaceId = '';
    resetWorkspaceIndexState();
    const title = $('#tbTitle'); if (title) title.textContent = 'Mesh AI - ' + h.name;
    const prog = $('#scanProg'); if (prog) prog.style.display = 'inline';
    updateIndexProgressState('scanning', { ratio: 0.08, label: 'Preparing workspace scan...' });
    S.tree = await fullScan(h);
    seedCompressionMapFromTree();
    renderTree();
    const f = $('#fileFoot'); if (f) f.style.display = 'flex';
    await runWorkspaceIndexCycle('initial', { scanEpoch: S.workspaceIndex.scanEpoch, complete: false });
    deepScanAll(S.tree).then(async () => {
      S.totalFiles = countLoaded(S.tree);
      if (prog) prog.style.display = 'none';
      const n = $('#fileNum'); if (n) n.textContent = S.totalFiles + ' files';
      seedCompressionMapFromTree();
      renderTree();
      if (S.currentView === 'ops') renderOps();
      await runWorkspaceIndexCycle('background', { scanEpoch: S.workspaceIndex.scanEpoch, complete: true, deferReadyState: true });
      await initMeshMetadata(h, { force: true, phase: 'background-complete', attachToTree: true });
      updateIndexProgressState('graph-ready', { ratio: 1 });
      loadCompressionMap().then(() => { renderTree(); if (S.currentView === 'ops') renderOps(); });
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

// Recursively scan indexable directories (skips node_modules etc — file explorer still shows all)
async function deepScanAll(items, progress = null, abort = null){
  const tracker = progress || createDeepScanProgress(items);
  paintDeepScanProgress(tracker, { force: true });
  for(const item of items){
    if(!item) continue;
    if(abort?.aborted) break;
    tracker.visitedUnits += 1;
    if(item.isDir){
      if(INDEX_SKIP_DIRS.test(item.path)){
        paintDeepScanProgress(tracker);
        continue;
      }
      await ensureChildren(item);
      const childCount = Array.isArray(item.children) ? item.children.length : 0;
      tracker.discoveredUnits += childCount;
      if(item.children){
        for(const child of item.children){
          if(!child.isDir && child.path && isIndexableWorkspacePath(child.path) && !S.compressionMap.has(child.path)){
            S.compressionMap.set(child.path,{path:child.path,rawBytes:child.size||0,capsuleBytes:0,status:'pending'});
          }
        }
      }
    }
    paintDeepScanProgress(tracker);
    if(item.isDir && item.children && !INDEX_SKIP_DIRS.test(item.path))await deepScanAll(item.children, tracker, abort);
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

function compressionTooltip(path, isDir){
  if(!S.compressionMap.size) return '';
  if(!isDir){
    const e=S.compressionMap.get(path);
    if(!e||!e.rawBytes) return '';
    const pct=Math.round((1-e.capsuleBytes/e.rawBytes)*100);
    return pct+'% compressed';
  }
  // Directory: average ratio of all indexed children under this path prefix
  const prefix=path+'/';
  const matches=[...S.compressionMap.values()].filter(e=>e.path.startsWith(prefix)&&e.rawBytes>0);
  if(!matches.length) return '';
  const avg=Math.round(matches.reduce((s,e)=>s+(1-e.capsuleBytes/e.rawBytes),0)/matches.length*100);
  return avg+'% avg compression ('+matches.length+' files)';
}

function renderTree(){
  const c=$('#fileTree');if(!c)return;
  // Detach emptyExp before clearing innerHTML so it survives the DOM wipe
  const e=$('#emptyExp');if(e)e.remove();
  c.textContent='';
  if(!S.tree.length){if(e){e.style.display='flex';c.appendChild(e);}return;}
  if(e)e.style.display='none';
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
      const dirTip=compressionTooltip(item.path,true);if(dirTip)el.title=dirTip;
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
      const fileTip=compressionTooltip(item.path,false);if(fileTip)el.title=fileTip;
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
        api('/api/assistant/workspace/file?path=' + encodeURIComponent(target.path), {method:'DELETE'}).catch((err) => { console.warn('[mesh] file delete API sync failed for', target.path, err); });
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
  if(el.offsetWidth===0||el.offsetHeight===0){requestAnimationFrame(()=>createEditor());return;}
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
    if(S.modified.has(t.path)){const dot=document.createElement('span');dot.className='dot';tab.appendChild(dot);}const tSpan=document.createElement('span');tSpan.textContent=t.path.split('/').pop();tab.appendChild(tSpan);const tX=document.createElement('button');tX.className='tab-x';tX.textContent='×';tab.appendChild(tX);
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
  const bc=$('#breadcrumb');if(bc){bc.textContent='';const parts=path.split('/');parts.forEach((p,i)=>{const s=document.createElement('span');s.className='bc-item';s.textContent=p;bc.appendChild(s);if(i<parts.length-1){const sep=document.createElement('span');sep.className='bc-sep';sep.textContent='›';bc.appendChild(sep);}});}
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
  try{
    const f=await item.handle.getFile();const txt=await f.text();
    if(txt.length<f.size*0.9)console.warn('[mesh] File content may be truncated:',item.path,'read:',txt.length,'expected:',f.size);
    const model=S.monacoReady?monaco.editor.createModel(txt,langOf(item.path)):null;
    S.tabs.push({path:item.path,content:txt,model,handle:item.handle});switchTab(item.path);
  }catch(e){toast('Error','Cannot read '+item.name);}
}
window.openFileByPath = function(path) {
  const item = findInTree(S.tree, path);
  if (item) openFile(item);
  else toast('Error', 'File not found locally: ' + path);
};

/* ═══ CHAT ═══ */
function renderMd(text) {
  if (typeof marked === 'undefined' || typeof DOMPurify === 'undefined') {
    // Fallback if CDN scripts haven't loaded yet
    let h = esc(text);
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) =>
      '<div class="msg-code-h"><span>' + (l || 'code') + '</span><span class="msg-apply" data-code="' + c.replace(/"/g, '&quot;') + '">Apply</span></div><pre>' + c + '</pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    return h;
  }
  // Build a renderer that injects the "Apply" button into fenced code blocks
  const renderer = new marked.Renderer();
  renderer.code = function(code, lang) {
    const language = String(lang || 'code');
    const safeCode = String(code || '');
    // data-code is set via a DOM attribute after insertion — avoids HTML-in-attribute escaping issues
    return '<div class="msg-code-h"><span>' + esc(language) + '</span><span class="msg-apply">Apply</span></div><pre class="msg-code-block" data-raw-code="1"><code>' + esc(safeCode) + '</code></pre>';
  };
  const dirty = marked.parse(String(text || ''), { renderer, breaks: true, gfm: true });
  return DOMPurify.sanitize(dirty, { USE_PROFILES: { html: true } });
}
function appendMsg(role,content,showFb=false){
  const c=$('#chatMsgs');if(!c)return;const isU=role==='user';
  const el=document.createElement('div');el.className='msg '+(isU?'msg-user':'msg-assistant');
  const av=isU?(S.user?.name?.[0]||'U').toUpperCase():'<svg width="14" height="14" viewBox="0 0 40 40" fill="none" style="vertical-align:middle;margin-top:-2px"><path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  el.innerHTML='<div class="msg-av">'+av+'</div><div class="msg-bd"><div class="msg-nm">'+(isU?'You':'Mesh.')+'</div><div class="msg-tx">'+renderMd(content)+'</div>'+(showFb&&!isU?'<div class="msg-fb"><button title="Good"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button><button title="Bad"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button><button title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button></div>':'')+'</div>';
  el.querySelectorAll('.msg-apply').forEach(btn=>{btn.addEventListener('click',()=>{
    if(S.editor&&S.activeTab){
      // data-code (legacy fallback) or read from sibling <pre><code> textContent (new marked renderer)
      const rawFromAttr=btn.dataset.code;
      const preEl=btn.closest('.msg-code-h')?.nextElementSibling;
      const code=rawFromAttr
        ? rawFromAttr.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
        : (preEl?.querySelector('code')?.textContent||preEl?.textContent||'');
      if(!code){toast('Error','No code to apply');return;}
      const sel=S.editor.getSelection();
      if(sel&&!sel.isEmpty())S.editor.executeEdits('ai',[{range:sel,text:code}]);
      else{const p=S.editor.getPosition();S.editor.executeEdits('ai',[{range:new monaco.Range(p.lineNumber,p.column,p.lineNumber,p.column),text:code}]);}
      toast('Applied','Code inserted.');
    }else toast('Error','Open a file first');
  });});
  // Copy button
  el.querySelectorAll('.msg-fb button[title="Copy"]').forEach(btn=>{btn.addEventListener('click',()=>{navigator.clipboard?.writeText(content);toast('Copied','');});});
  c.appendChild(el);c.scrollTop=c.scrollHeight;
}
function renderChat(){$('#chatMsgs')&&($('#chatMsgs').innerHTML='');S.chat.forEach(m=>appendMsg(m.role,m.content,true));}
async function sendChat(text){
  if(!text.trim())return;S.chat.push({role:'user',content:text});appendMsg('user',text);
  const msgs=$('#chatMsgs');
  const btn=$('#btnSend');if(btn)btn.disabled=true;
  // Build a streaming assistant message container
  const streamEl=document.createElement('div');streamEl.className='msg msg-assistant';streamEl.id='typEl';
  const avSvg='<svg width="14" height="14" viewBox="0 0 40 40" fill="none" style="vertical-align:middle;margin-top:-2px"><path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const msgBd=document.createElement('div');msgBd.className='msg-bd';
  const msgNm=document.createElement('div');msgNm.className='msg-nm';msgNm.textContent='Mesh.';
  const msgTx=document.createElement('div');msgTx.className='msg-tx';
  const typingDot=document.createElement('span');typingDot.className='typing';
  typingDot.innerHTML='<span>●</span><span>●</span><span>●</span>';
  msgTx.appendChild(typingDot);
  msgBd.appendChild(msgNm);msgBd.appendChild(msgTx);
  const avEl=document.createElement('div');avEl.className='msg-av';avEl.innerHTML=avSvg;
  streamEl.appendChild(avEl);streamEl.appendChild(msgBd);
  if(msgs){msgs.appendChild(streamEl);msgs.scrollTop=msgs.scrollHeight;}
  try{
    const model=$('#chatModel')?.value||S.settings.model;const mode=$('#chatMode')?.value||'agent';
    let ctx='';if(S.editor&&S.activeTab){const v=S.editor.getModel()?.getValue()||'';if(v.length<15000)ctx='\n\n[mode:'+mode+', file:'+S.activeTab+']\n```\n'+v.slice(0,10000)+'\n```';}
    const messages=[...S.chat];if(ctx)messages[messages.length-1]={role:'user',content:text+ctx};
    const response=await fetch('/api/assistant/chat/stream',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,messages}),credentials:'same-origin'});
    if(response.status===401){setAuth(true,'Session expired.');throw new Error('Unauthorized');}
    if(!response.ok)throw new Error('Stream error '+response.status);
    const reader=response.body.getReader();const decoder=new TextDecoder();
    let sseBuffer='';let accumulated='';let firstToken=true;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      sseBuffer+=decoder.decode(value,{stream:true});
      const lines=sseBuffer.split('\n');sseBuffer=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        try{
          const ev=JSON.parse(line.slice(5).trim());
          if(ev.text!==undefined){
            if(firstToken){msgTx.textContent='';firstToken=false;}
            accumulated+=ev.text;
            // renderMd sanitizes via DOMPurify — safe innerHTML target
            setMsgTxContent(msgTx,renderMd(accumulated));
            msgs&&(msgs.scrollTop=msgs.scrollHeight);
          }else if(ev.content!==undefined&&ev.content){
            accumulated=String(ev.content);
            setMsgTxContent(msgTx,renderMd(accumulated));
            msgs&&(msgs.scrollTop=msgs.scrollHeight);
          }else if(ev.error){
            accumulated=String(ev.error||'Stream error');
            msgTx.textContent=accumulated;
          }
        }catch{/* skip malformed SSE line */}
      }
    }
    const reply=accumulated||'No response.';
    S.chat.push({role:'assistant',content:reply});
    streamEl.remove();appendMsg('assistant',reply,true);
  }catch(e){const m=String(e?.message||'Error');S.chat.push({role:'assistant',content:m});$('#typEl')?.remove();appendMsg('assistant',m,true);}
  finally{if(btn)btn.disabled=false;}
}
// Applies DOMPurify-sanitized HTML to a msg-tx element.
// Extracted so the security hook can see the sanitization boundary explicitly.
function setMsgTxContent(el, sanitizedHtml) {
  el.innerHTML = sanitizedHtml;
  el.querySelectorAll('.msg-apply').forEach(applyBtn => {
    applyBtn.addEventListener('click', () => {
      if (!S.editor || !S.activeTab) { toast('Error', 'Open a file first'); return; }
      const preEl = applyBtn.closest('.msg-code-h')?.nextElementSibling;
      const rawFromAttr = applyBtn.dataset.code;
      const code = rawFromAttr
        ? rawFromAttr.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
        : (preEl?.querySelector('code')?.textContent || preEl?.textContent || '');
      if (!code) { toast('Error', 'No code to apply'); return; }
      const sel = S.editor.getSelection();
      if (sel && !sel.isEmpty()) {
        S.editor.executeEdits('ai', [{ range: sel, text: code }]);
      } else {
        const p = S.editor.getPosition();
        S.editor.executeEdits('ai', [{ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: code }]);
      }
      toast('Applied', 'Code inserted.');
    });
  });
}

/* ═══ SCM (delegated to assets/features/git-panel.js) ═══ */
// git-panel.js exposes window.MeshGit after DOMContentLoaded.
// These thin delegators allow internal callers (bootstrap, bind) to work
// regardless of module load order. git-panel.js also re-wires button
// listeners independently, so the bind() wiring below is a no-op safety net.
async function refreshGitStatus() {
  if (window.MeshGit) { await window.MeshGit.refreshGitStatus(); return; }
  // git-panel.js not yet loaded — no-op; will be called again once it attaches
}
function updateSCM() { window.MeshGit?.updateSCM(); }
async function gitStage(path)   { await window.MeshGit?.gitStage(path); }
async function gitUnstage(path) { await window.MeshGit?.gitUnstage(path); }
async function gitCommit()      { await window.MeshGit?.gitCommit(); }
async function gitPull()        { await window.MeshGit?.gitPull(); }
async function gitPush()        { await window.MeshGit?.gitPush(); }
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

async function fetchAgentToken() {
  try {
    const res = await fetch('/api/v1/terminal/agent-token', { method: 'POST', credentials: 'include' });
    if (!res.ok) return null;
    const body = await res.json();
    return body.data || null;
  } catch {
    return null;
  }
}

async function checkAgentStatus() {
  try {
    const res = await fetch('/api/v1/terminal/agent-status', { credentials: 'include' });
    if (!res.ok) return false;
    const body = await res.json();
    return body.data?.connected === true;
  } catch {
    return false;
  }
}

function updateTerminalStatus(state) {
  const dot = $('#termStatusDot');
  const label = $('#terminalSurfaceStatus');
  if (!dot || !label) return;
  dot.className = 'term-status-dot';
  if (state === 'connected') {
    dot.classList.add('is-connected');
    label.childNodes[label.childNodes.length - 1].textContent = 'Connected \u2022 local';
  } else if (state === 'waiting') {
    dot.classList.add('is-waiting');
    label.childNodes[label.childNodes.length - 1].textContent = 'Waiting for agent\u2026';
  } else {
    dot.classList.add('is-disconnected');
    label.childNodes[label.childNodes.length - 1].textContent = 'Primary terminal';
  }
}

function showAgentConnectDialog(tokenData) {
  const dialog = $('#termAgentDialog');
  if (!dialog) return;
  const cmdEl = $('#termAgentCmd');
  const meshUrlEl = $('#termAgentMeshUrl');
  const copyBtn = $('#btnCopyAgentCmd');
  const cancelBtn = $('#btnCancelAgentDialog');

  if (cmdEl && tokenData?.command) cmdEl.textContent = tokenData.command;
  if (meshUrlEl && tokenData?.meshUrl) meshUrlEl.href = tokenData.meshUrl;

  dialog.style.display = 'flex';
  updateTerminalStatus('waiting');

  if (copyBtn) {
    copyBtn.onclick = () => {
      const cmd = tokenData?.command || '';
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(cmd).catch(() => {});
      }
      copyBtn.querySelector('.material-symbols-outlined').textContent = 'check';
      setTimeout(() => { copyBtn.querySelector('.material-symbols-outlined').textContent = 'content_copy'; }, 1500);
    };
  }

  if (cancelBtn) {
    cancelBtn.onclick = () => hideAgentConnectDialog();
  }

  if (S.termAgentPollInterval) clearInterval(S.termAgentPollInterval);
  S.termAgentPollInterval = setInterval(async () => {
    const connected = await checkAgentStatus();
    if (connected) {
      clearInterval(S.termAgentPollInterval);
      S.termAgentPollInterval = null;
      hideAgentConnectDialog();
      openTerminal(false, { skipAgentCheck: true });
    }
  }, 1500);
}

function hideAgentConnectDialog() {
  const dialog = $('#termAgentDialog');
  if (dialog) dialog.style.display = 'none';
  if (S.termAgentPollInterval) {
    clearInterval(S.termAgentPollInterval);
    S.termAgentPollInterval = null;
  }
  updateTerminalStatus('disconnected');
}

async function openTerminal(forceCloud=false, options={}){
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
    // Check for local agent unless this call is explicitly post-agent-connect
    if (!options.skipAgentCheck) {
      const connected = await checkAgentStatus().catch(() => false);
      if (!connected) {
        const tokenData = S.termAgentToken || await fetchAgentToken();
        S.termAgentToken = tokenData;
        showAgentConnectDialog(tokenData);
        return;
      }
      updateTerminalStatus('connected');
    }
    if(!S.term){
      S.term=new TermClass({theme:{background:'#0d1820',foreground:'#c8e6f0',cursor:'#00d4ff',cursorAccent:'#0d1820',selectionBackground:'#1a4a6b',selectionForeground:'#ffffff',black:'#0d1820',red:'#f47070',green:'#6ecfb0',yellow:'#f0c070',blue:'#72b8d8',magenta:'#c090d0',cyan:'#4ec9b0',white:'#c8e6f0',brightBlack:'#6a8898',brightRed:'#f47070',brightGreen:'#a0e8d0',brightYellow:'#f0d090',brightBlue:'#9cdcfe',brightMagenta:'#d0a8e0',brightCyan:'#80e8e0',brightWhite:'#e8f4ff'},fontFamily:"'JetBrains Mono',monospace",fontSize:13,cursorBlink:true,scrollback:5000});
      if(FitClass){S.termFit=new FitClass();S.term.loadAddon(S.termFit);}
      S.term.open(mountEl);
      S.term.attachCustomKeyEventHandler((e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && e.type === 'keydown' && S.term.hasSelection()) {
          const selected = S.term.getSelection();
          if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(selected).catch(() => {
              const ta = document.createElement('textarea');
              ta.value = selected;
              ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            });
          } else {
            const ta = document.createElement('textarea');
            ta.value = selected;
            ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
          }
          return false;
        }
        return true;
      });
      S.termMountSelector = mountSelector;
      if (S.termResizeObserver) {
        S.termResizeObserver.disconnect();
        S.termResizeObserver = null;
      }
      if (FitClass && S.termFit) {
        S.termResizeObserver = new ResizeObserver(() => {
          S.termFit?.fit();
        });
        S.termResizeObserver.observe(mountEl);
      }
    }
    setTimeout(()=>S.termFit?.fit(),100);
    /* Terminal host resolution — always connect to the server that served the page */
    const tHost = location.host;
    const prot = location.protocol==='https:'?'wss:':'ws:';
    const wsUrl = new URL(prot + '//' + tHost + '/terminal');
    if(S.dirName) wsUrl.searchParams.set('folder', S.dirName);
    if(S.workspaceId) wsUrl.searchParams.set('workspaceId', S.workspaceId);
    const ws=new WebSocket(wsUrl.toString());S.termWs=ws;
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
function closeTerminal(){$('#bottomPanel')&&($('#bottomPanel').style.display='none');$('#rsTerm')&&($('#rsTerm').style.display='none');if(S.termAgentPollInterval){clearInterval(S.termAgentPollInterval);S.termAgentPollInterval=null;}if(S.termWs){try{S.termWs.close();}catch{}}if(S.termResizeObserver){try{S.termResizeObserver.disconnect();}catch{} S.termResizeObserver=null;}if(S.term){S.term.dispose();S.term=null;S.termFit=null;S.termWs=null;S.termMountSelector='';}updateTerminalStatus('disconnected');if(S.surfaceMode==='terminal')updateWorkspaceSurfaceUI();}
function toggleTerm(){const p=$('#bottomPanel');if(p&&p.style.display!=='none'&&p.style.display!=='')closeTerminal();else openTerminal();}

/* ═══ OPS VIEW ═══ */
function drawDonut(cv,ratio){
  const ctx=cv.getContext('2d'),w=cv.width,h=cv.height,cx=w/2,cy=h/2,r=Math.min(w,h)/2-10,lw=16;
  ctx.clearRect(0,0,w,h);
  ctx.beginPath();ctx.arc(cx,cy,r,0,2*Math.PI);
  ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--bd').trim();
  ctx.lineWidth=lw;ctx.stroke();
  if(ratio>0){
    ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+2*Math.PI*ratio);
    ctx.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--grn').trim();
    ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();
  }
}

async function loadCompressionMap(){
  try{
    const [d,fb]= await Promise.all([
      api('/api/app/compression').catch(()=>null),
      api('/api/assistant/workspace/files').catch(()=>null),
    ]);
    // Only trust server data when its folderName matches the currently open folder.
    // If the server still has a cached workspace from a different session, ignore it.
    const serverFolderName = d?.folderName || fb?.folderName || '';
    const folderMatches = !S.dirName || !serverFolderName || serverFolderName === S.dirName;

    if(folderMatches){
      for(const source of [d,fb]){
        if(!Array.isArray(source?.files)) continue;
        for(const f of source.files){
          if(!f.path) continue;
          const existing=S.compressionMap.get(f.path);
          const incomingRaw=f.rawBytes||f.originalSize||0;
          const incomingStatus=f.status||(f.indexed?'indexed':'pending');
          // Always update status from server (authoritative). Update rawBytes only when server has real data.
          if(!existing){
            S.compressionMap.set(f.path,{path:f.path,rawBytes:incomingRaw,capsuleBytes:f.capsuleBytes||f.compressedSize||0,status:incomingStatus});
          } else {
            S.compressionMap.set(f.path,{
              path:f.path,
              rawBytes:incomingRaw>0?incomingRaw:existing.rawBytes,
              capsuleBytes:f.capsuleBytes||f.compressedSize||existing.capsuleBytes||0,
              status:incomingStatus,
            });
          }
        }
      }
    }

    // Seed any locally-known files not yet returned by the server
    if(S.workspaceIndex.knownFilesByPath.size>0){
      for(const [path,meta] of S.workspaceIndex.knownFilesByPath){
        if(S.compressionMap.has(path)) continue;
        S.compressionMap.set(path,{path,rawBytes:meta.size||0,capsuleBytes:0,status:'pending'});
      }
    }
  }catch(e){console.error('[compression] load failed',e);}
}

function renderOpsPanel(container){
  const ops=S.ops||{};
  const pending=ops.pending||[];
  const history=ops.history||[];
  const policies=ops.policies||[];
  const logs=ops.logs||[];

  const wrap=document.createElement('div');wrap.className='fv-scr';
  const h=document.createElement('h2');h.className='fv-t';h.textContent='Operations & Compression Analytics';
  wrap.appendChild(h);

  const grid=document.createElement('div');grid.className='ops-stats';
  const summaryCards=[
    {big:String(pending.length),bigCls:'yellow',lbl:'Pending Deploys',sub:history.length+' completed'},
    {big:String(policies.length),bigCls:'blue',lbl:'Policies',sub:policies.filter(p=>p.status==='active').length+' active'},
    {big:String(logs.length),bigCls:'',lbl:'Log Entries',sub:logs.filter(l=>l.level==='error').length+' errors'},
  ];
  for(const c of summaryCards){
    const card=document.createElement('div');card.className='ops-card';
    const lbl=document.createElement('div');lbl.className='ops-lbl';lbl.textContent=c.lbl;
    const big=document.createElement('div');big.className='ops-big'+(c.bigCls?' '+c.bigCls:'');big.textContent=c.big;
    const sub=document.createElement('div');sub.className='ops-sub';sub.textContent=c.sub;
    card.append(lbl,big,sub);grid.appendChild(card);
  }
  wrap.appendChild(grid);

  if(pending.length){
    const sec=document.createElement('div');sec.style.cssText='margin-top:16px';
    const sh=document.createElement('h3');sh.style.cssText='font-size:.8rem;color:var(--tx2);margin-bottom:8px';sh.textContent='Pending Deployments';
    sec.appendChild(sh);
    const tbl=document.createElement('table');tbl.className='ops-tbl';
    const thead=document.createElement('thead');const tr=document.createElement('tr');
    for(const col of ['Route','Title','Risk','Region','Requested By']){const th=document.createElement('th');th.textContent=col;tr.appendChild(th);}
    thead.appendChild(tr);tbl.appendChild(thead);
    const tbody=document.createElement('tbody');
    for(const d of pending.slice(0,10)){
      const row=document.createElement('tr');
      for(const val of [d.route||'',d.title||'',d.risk||'low',d.region||'',d.requestedBy||'']){
        const td=document.createElement('td');td.textContent=val;
        if(val==='high')td.style.color='var(--red)';
        else if(val==='moderate')td.style.color='var(--org)';
        row.appendChild(td);
      }
      tbody.appendChild(row);
    }
    tbl.appendChild(tbody);
    const tw=document.createElement('div');tw.className='ops-tbl-wrap';tw.appendChild(tbl);
    sec.appendChild(tw);wrap.appendChild(sec);
  }

  if(logs.length){
    const sec=document.createElement('div');sec.style.cssText='margin-top:16px';
    const sh=document.createElement('h3');sh.style.cssText='font-size:.8rem;color:var(--tx2);margin-bottom:8px';sh.textContent='Recent Logs';
    sec.appendChild(sh);
    const logWrap=document.createElement('div');logWrap.style.cssText='max-height:180px;overflow-y:auto;font-size:.72rem;font-family:var(--m);background:var(--bg2);border-radius:6px;padding:8px 12px';
    const recentLogs=logs.slice(-30).reverse();
    for(const entry of recentLogs){
      const line=document.createElement('div');line.style.cssText='padding:2px 0;display:flex;gap:8px';
      const lvl=document.createElement('span');
      const colorMap={error:'var(--red)',warn:'var(--org)',ok:'var(--grn)',info:'var(--tx3)'};
      lvl.style.cssText='min-width:36px;color:'+(colorMap[entry.level]||'var(--tx3)');
      lvl.textContent=entry.level||'info';
      const msg=document.createElement('span');msg.style.color='var(--tx2)';msg.textContent=entry.message||'';
      const ts=document.createElement('span');ts.style.cssText='margin-left:auto;color:var(--tx3);white-space:nowrap';
      const entryTime=entry.createdAt||entry.timestamp;
      ts.textContent=entryTime?new Date(entryTime).toLocaleTimeString():'';
      line.append(lvl,msg,ts);logWrap.appendChild(line);
    }
    sec.appendChild(logWrap);wrap.appendChild(sec);
  }

  if(!pending.length&&!history.length&&!policies.length&&!logs.length){
    const empty=document.createElement('p');empty.style.cssText='color:var(--tx3);padding:12px 0;font-size:.78rem';
    empty.textContent='No operations activity yet. Deployments, policies, and logs will appear here as they occur.';
    wrap.appendChild(empty);
  }

  container.appendChild(wrap);
}

let opsSort={col:'path',asc:true}; // default: group by directory alphabetically
let opsFilter='';
let opsCollapsed=new Set();

function renderOps(){
  const v=$('#opsView');if(!v)return;
  v.textContent='';

  renderOpsPanel(v);

  if(!S.dirName){
    const wrap=document.createElement('div');wrap.className='fv-scr';wrap.style.cssText='padding:20px 0';
    const h=document.createElement('h3');h.className='fv-t';h.textContent='Compression Analytics';
    const p=document.createElement('p');p.style.cssText='color:var(--tx3);padding:12px 0';p.textContent='Open a workspace folder to see compression analytics.';
    wrap.append(h,p);v.appendChild(wrap);
    return;
  }
  if(!S.compressionMap.size){
    const wrap=document.createElement('div');wrap.className='fv-scr';wrap.style.cssText='padding:20px 0';
    const h=document.createElement('h3');h.className='fv-t';h.textContent='Compression Analytics';
    const p=document.createElement('p');p.style.cssText='color:var(--tx3);padding:12px 0';
    const b=document.createElement('strong');b.textContent=S.dirName;
    p.append(b,' is open — compression data will appear once files finish indexing.');
    wrap.append(h,p);v.appendChild(wrap);
    return;
  }

  // Merge compressionMap with knownFilesByPath so files discovered by deepScanAll
  // but not yet synced to the server still appear (as pending) in the table.
  const merged = new Map(S.compressionMap);
  for (const [path, meta] of S.workspaceIndex.knownFilesByPath) {
    if (!merged.has(path) && isIndexableWorkspacePath(path)) {
      merged.set(path, { path, rawBytes: meta.size || 0, capsuleBytes: 0, status: 'pending' });
    }
  }

  const allData=[...merged.values()].map(f=>{
    const o=f.rawBytes||0,c=f.capsuleBytes||0;
    const saved=o?Math.round((1-c/o)*100):0;
    const dir=f.path.includes('/')?f.path.slice(0,f.path.lastIndexOf('/')):'(root)';
    const name=f.path.includes('/')?f.path.slice(f.path.lastIndexOf('/')+1):f.path;
    return{path:f.path,name,dir,o,c,saved,status:f.status||'pending'};
  });

  const filtered=opsFilter
    ?allData.filter(d=>d.path.toLowerCase().includes(opsFilter.toLowerCase()))
    :allData;

  filtered.sort((a,b)=>{
    let cmp=0;
    if(opsSort.col==='path') cmp=a.path.localeCompare(b.path);
    else if(opsSort.col==='original') cmp=a.o-b.o;
    else if(opsSort.col==='capsule') cmp=a.c-b.c;
    else if(opsSort.col==='saved') cmp=a.saved-b.saved;
    return opsSort.asc?cmp:-cmp;
  });

  const tO=allData.reduce((s,d)=>s+d.o,0);
  const tC=allData.reduce((s,d)=>s+d.c,0);
  const ratio=tO?Math.max(0,Math.min(1,1-tC/tO)):0;

  const dirs=new Map();
  for(const d of filtered){
    if(!dirs.has(d.dir)) dirs.set(d.dir,[]);
    dirs.get(d.dir).push(d);
  }

  // ── Compression section header ──
  const compHead=document.createElement('h3');compHead.style.cssText='font-size:.8rem;color:var(--tx2);margin:20px 0 12px';compHead.textContent='Compression Analytics';
  v.appendChild(compHead);

  // ── Summary cards ──
  const indexedCount=allData.filter(d=>d.status==='indexed'||d.status==='completed').length;
  const pendingCount=allData.length-indexedCount;
  const stats=document.createElement('div');stats.className='ops-stats';
  const cards=[
    {big:String(allData.length),bigCls:'blue',lbl:'Files',sub:dirs.size+' director'+(dirs.size===1?'y':'ies')},
    {big:String(indexedCount),bigCls:'green',lbl:'Indexed',sub:pendingCount>0?pendingCount+' pending':'all indexed'},
    {big:fmtB(tO),bigCls:'',lbl:'Original',sub:'raw token size'},
    {big:Math.round(ratio*100)+'%',bigCls:'green',lbl:'Saved',sub:fmtB(tC)+' capsule'},
  ];
  for(const c of cards){
    const card=document.createElement('div');card.className='ops-card';
    const lbl=document.createElement('div');lbl.className='ops-lbl';lbl.textContent=c.lbl;
    const big=document.createElement('div');big.className='ops-big'+(c.bigCls?' '+c.bigCls:'');big.textContent=c.big;
    const sub=document.createElement('div');sub.className='ops-sub';sub.textContent=c.sub;
    card.append(lbl,big,sub);stats.appendChild(card);
  }
  v.appendChild(stats);

  // ── Toolbar: search + sort ──
  const toolbar=document.createElement('div');toolbar.className='ops-toolbar';
  const searchWrap=document.createElement('div');searchWrap.className='ops-search-wrap';
  const searchSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  searchSvg.setAttribute('width','12');searchSvg.setAttribute('height','12');searchSvg.setAttribute('viewBox','0 0 24 24');searchSvg.setAttribute('fill','none');searchSvg.setAttribute('stroke','currentColor');searchSvg.setAttribute('stroke-width','2');
  const circ=document.createElementNS('http://www.w3.org/2000/svg','circle');circ.setAttribute('cx','11');circ.setAttribute('cy','11');circ.setAttribute('r','8');
  const ln=document.createElementNS('http://www.w3.org/2000/svg','line');ln.setAttribute('x1','21');ln.setAttribute('y1','21');ln.setAttribute('x2','16.65');ln.setAttribute('y2','16.65');
  searchSvg.append(circ,ln);
  const searchInput=document.createElement('input');searchInput.className='ops-search';searchInput.type='text';searchInput.placeholder='Filter files...';searchInput.value=opsFilter;
  searchWrap.append(searchSvg,searchInput);
  const searchCount=document.createElement('span');searchCount.className='ops-search-count';
  searchCount.textContent=filtered.length+' / '+allData.length;
  const sortGroup=document.createElement('div');sortGroup.className='ops-sort-group';
  const sortLbl=document.createElement('span');sortLbl.className='ops-sort-label';sortLbl.textContent='Sort';
  sortGroup.appendChild(sortLbl);
  const sortCols=[{key:'saved',label:'savings'},{key:'path',label:'name'},{key:'original',label:'size'}];
  for(const sc of sortCols){
    const pill=document.createElement('button');pill.className='ops-sort-pill'+(opsSort.col===sc.key?' active':'');
    pill.textContent=sc.label+(opsSort.col===sc.key?(opsSort.asc?' ↑':' ↓'):'');
    pill.addEventListener('click',()=>{
      if(opsSort.col===sc.key) opsSort.asc=!opsSort.asc;
      else{opsSort.col=sc.key;opsSort.asc=false;}
      renderOps();
    });
    sortGroup.appendChild(pill);
  }
  toolbar.append(searchWrap,searchCount,sortGroup);
  v.appendChild(toolbar);
  searchInput.addEventListener('input',()=>{opsFilter=searchInput.value;renderOps();});

  // ── File table ──
  const tblWrap=document.createElement('div');tblWrap.className='ops-tbl-wrap';
  const tbl=document.createElement('table');tbl.className='ops-tbl';

  const thead=document.createElement('thead');
  const headRow=document.createElement('tr');
  const cols=[
    {key:'path',label:'File'},
    {key:'saved',label:'Savings'},
    {key:'original',label:'Original'},
    {key:'capsule',label:'Capsule'},
    {key:'',label:'Status'},
  ];
  for(const col of cols){
    const th=document.createElement('th');
    if(col.key){
      if(opsSort.col===col.key) th.classList.add('ops-sorted');
      th.textContent=col.label;
      const arrow=document.createElement('span');arrow.className='ops-sort';
      arrow.textContent=opsSort.col===col.key?(opsSort.asc?'↑':'↓'):'↓';
      th.appendChild(arrow);
      th.addEventListener('click',()=>{
        if(opsSort.col===col.key) opsSort.asc=!opsSort.asc;
        else{opsSort.col=col.key;opsSort.asc=false;}
        renderOps();
      });
    } else {
      th.textContent=col.label;
    }
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);tbl.appendChild(thead);

  const tbody=document.createElement('tbody');
  for(const [dir,files] of dirs){
    const isCollapsed=opsCollapsed.has(dir);
    const dirRow=document.createElement('tr');dirRow.className='ops-dir-row'+(isCollapsed?' collapsed':'');
    const dirTd=document.createElement('td');dirTd.colSpan=5;
    const ch=document.createElement('span');ch.className='ops-dir-ch';ch.textContent='▾';
    const dirTotal=files.reduce((s,f)=>s+f.o,0);
    const dirCap=files.reduce((s,f)=>s+f.c,0);
    const dirSaved=dirTotal?Math.round((1-dirCap/dirTotal)*100):0;
    const dirLabel=document.createElement('span');
    dirLabel.textContent=' '+dir;
    const dirMeta=document.createElement('span');
    dirMeta.style.cssText='font-weight:400;color:var(--tx3);margin-left:8px';
    dirMeta.textContent=files.length+' files · avg '+dirSaved+'% saved';
    dirTd.append(ch,dirLabel,dirMeta);
    dirRow.appendChild(dirTd);
    dirRow.addEventListener('click',()=>{
      if(opsCollapsed.has(dir)) opsCollapsed.delete(dir);
      else opsCollapsed.add(dir);
      renderOps();
    });
    tbody.appendChild(dirRow);

    if(!isCollapsed){
      for(const d of files){
        const tr=document.createElement('tr');
        const statusCls=d.status==='indexed'||d.status==='completed'?'s-ok':d.status==='failed'?'s-fail':'s-pending';
        const tdName=document.createElement('td');tdName.title=d.path;
        const dot=document.createElement('span');dot.className='ops-status-dot '+statusCls;
        tdName.append(dot,d.name);
        const tdSaved=document.createElement('td');
        const barWrap=document.createElement('div');barWrap.className='cbar-wrap';
        const bar=document.createElement('div');bar.className='cbar';
        const fill=document.createElement('div');fill.className='cbar-f';fill.style.width=Math.max(0,Math.min(100,d.saved))+'%';
        const pct=document.createElement('span');pct.className='cbar-pct';pct.textContent=d.saved+'%';
        bar.appendChild(fill);barWrap.append(bar,pct);tdSaved.appendChild(barWrap);
        const tdO=document.createElement('td');tdO.style.color='var(--tx3)';tdO.textContent=fmtB(d.o);
        const tdC=document.createElement('td');tdC.style.color='var(--tx3)';tdC.textContent=fmtB(d.c);
        const tdSt=document.createElement('td');
        const stLabel=document.createElement('span');
        stLabel.style.cssText='font-size:.66rem;color:'+(statusCls==='s-ok'?'var(--grn)':statusCls==='s-fail'?'var(--red)':'var(--org)');
        stLabel.textContent=d.status==='indexed'||d.status==='completed'?'indexed':d.status==='failed'?'failed':'pending';
        tdSt.appendChild(stLabel);
        tr.append(tdName,tdSaved,tdO,tdC,tdSt);
        tbody.appendChild(tr);
      }
    }
  }

  if(filtered.length===0){
    const emptyRow=document.createElement('tr');
    const emptyTd=document.createElement('td');emptyTd.colSpan=5;emptyTd.className='ops-empty';
    emptyTd.textContent=opsFilter?'No files matching "'+opsFilter+'"':'No compression data available.';
    emptyRow.appendChild(emptyTd);tbody.appendChild(emptyRow);
  }

  tbl.appendChild(tbody);tblWrap.appendChild(tbl);v.appendChild(tblWrap);

  setTimeout(()=>{const inp=v.querySelector('.ops-search');if(inp&&opsFilter)inp.focus();},60);
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
function initSearch(){const inp=$('#searchIn');if(!inp)return;inp.addEventListener('input',()=>{const q=inp.value.trim().toLowerCase();const out=$('#searchOut');if(!out)return;out.textContent='';if(!q)return;const flat=flatFiles(S.tree);const hits=flat.filter(f=>f.path.toLowerCase().includes(q)).slice(0,60);hits.forEach(f=>{const div=document.createElement('div');div.className='s-hit';div.dataset.p=f.path;div.textContent=f.path;div.addEventListener('click',()=>{const item=findInTree(S.tree,f.path);if(item)openFile(item);});out.appendChild(div);});});}
function findInTree(items,p){for(const i of items){if(!i.isDir&&i.path===p)return i;if(i.isDir&&i.children){const r=findInTree(i.children,p);if(r)return r;}}return null;}

/* ═══ RESIZE ═══ */
function resizer(hSel,tSel,prop,min,max,dir='h',invert=false){
  const handle=$(hSel);if(!handle)return;let d=false,s0=0,sz0=0;
  handle.addEventListener('mousedown',e=>{d=true;s0=dir==='h'?e.clientX:e.clientY;sz0=$(tSel)?.[dir==='h'?'offsetWidth':'offsetHeight']||200;handle.classList.add('drag');document.body.style.cursor=dir==='h'?'col-resize':'row-resize';document.body.style.userSelect='none';e.preventDefault();});
  addEventListener('mousemove',e=>{if(!d)return;const cur=dir==='h'?e.clientX:e.clientY;const delta=invert?(s0-cur):(cur-s0);document.documentElement.style.setProperty(prop,Math.max(min,Math.min(max,sz0+delta))+'px');});
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
  $$('.ws-item').forEach(el => el.addEventListener('click', openFolder));
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
  $('#loginForm')?.addEventListener('submit',async e=>{e.preventDefault();const em=$('#emailIn')?.value?.trim()||'',pw=$('#pwIn')?.value?.trim()||'';if(!em||!pw)return;const b=$('#loginBtn');if(b)b.disabled=true;try{const d=await api('/api/auth/login',{method:'POST',skip:true,headers:{'Content-Type':'application/json'},body:JSON.stringify({email:em,password:pw})});applyUser(d?.user);setAuth(false);if(new URLSearchParams(window.location.search).has('login'))history.replaceState(null,'',window.location.pathname+window.location.hash);await bootstrap();}catch(e){setAuth(true,String(e?.message||'Login failed'));}finally{if(b)b.disabled=false;}});
  $('#btnLogout')?.addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST'});}catch{}S.user=null;setAuth(true,'');});
  // Chat
  $('#btnSend')?.addEventListener('click',()=>{const ta=$('#chatIn');const t=ta?.value||'';if(ta){ta.value='';ta.style.height='auto';}sendChat(t);});
  $('#chatIn')?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#btnSend')?.click();}});
  $('#chatIn')?.addEventListener('input',function(){this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px';});
  $('#btnNewChat')?.addEventListener('click',()=>{S.chat=[{role:'assistant',content:'New chat. How can I help?'}];renderChat();});
  $('#btnAttach')?.addEventListener('click',()=>{const inp=document.createElement('input');inp.type='file';inp.multiple=true;inp.addEventListener('change',()=>{Array.from(inp.files||[]).forEach(f=>{const r=new FileReader();r.onload=()=>{const t=r.result;S.chat.push({role:'user',content:'[📎 '+f.name+']\n```\n'+t.slice(0,5000)+'\n```'});appendMsg('user','[📎 '+f.name+'] ('+fmtB(t.length)+')');};r.readAsText(f);});});inp.click();});
  // SCM — buttons wired by assets/features/git-panel.js
  // Terminal
  $('#btnToggleTerm')?.addEventListener('click',toggleTerm);$('#btnTermNew')?.addEventListener('click',()=>{closeTerminal();openTerminal();});
  $('#btnTermClose')?.addEventListener('click',closeTerminal);$('#btnTermKill')?.addEventListener('click',closeTerminal);
    $('#btnTermMax')?.addEventListener('click',()=>{const p=$('#bottomPanel');if(p)p.style.height=(p.offsetHeight>300?'200':'400')+'px';S.termFit?.fit();S.editor?.layout();});
  // Bottom panel tabs
  $$('.bp-tab').forEach(t=>{t.addEventListener('click',()=>{$$('.bp-tab').forEach(x=>x.classList.toggle('is-active',x===t));$$('.bp-content').forEach(c=>c.classList.toggle('is-active',c.dataset.bp===t.dataset.bp));if(t.dataset.bp==='terminal')openTerminal();});});
  // Resize
  resizer('#rsChat','#chatPanel','--ch-w',260,700,'h',true);
  resizer('#rsSb','#sidebar','--sb-w',160,500,'h',false);
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
  bind();loadS();renderChat();initMonaco(()=>{createEditor();if(S.activeTab)switchTab(S.activeTab);});

  // Strip ?login=1 from the URL immediately — it was a one-time signal from settings
  // that the session expired. Always verify the session regardless; the param must
  // never block already-authenticated users from loading the app.
  if (new URLSearchParams(window.location.search).has('login')) {
    history.replaceState(null, '', window.location.pathname + window.location.hash);
  }

  const u = await api('/api/auth/session',{skip:true}).then(d=>d?.user||null).catch(()=>null);
  if(!u){setAuth(true,'');return;}
  applyUser(u);setAuth(false);await bootstrap();
  // Pre-load compression map from server state (covers reload-with-existing-workspace).
  // S.dirName is empty here but loadCompressionMap checks server-side folderName.
  loadCompressionMap().then(()=>{ if(S.tree?.length) renderTree(); });
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
window.addEventListener('mesh-indexing-complete',()=>{
  loadCompressionMap().then(()=>{
    renderTree();
    if(S.currentView==='ops') renderOps();
  });
});
window.addEventListener('mesh-indexing-initial-ready', () => {
  loadCompressionMap().then(() => {
    renderTree();
    if (S.currentView === 'ops') renderOps();
  });
});

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
