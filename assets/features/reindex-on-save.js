/* Mesh Feature: Auto Re-Index Capsula on Save */
(function(){
const style = document.createElement('style');
style.textContent = `
.ri-indicator { position: fixed; bottom: 28px; right: 12px; background: #1e1e2e; border: 1px solid #444; border-radius: 6px; padding: 6px 12px; font-size: 11px; color: #aaa; z-index: 9000; display: flex; align-items: center; gap: 6px; transition: opacity 0.3s; }
.ri-spinner { width: 10px; height: 10px; border: 2px solid #444; border-top-color: var(--ac, #0098ff); border-radius: 50%; animation: ri-spin 0.8s linear infinite; }
@keyframes ri-spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

let reindexTimer = null;
let isReindexing = false;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Intercept Cmd+S */
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      saveAndReindex();
    }
  }, true);

  /* Listen for file saves via MeshBus */
  if (window.MeshBus) {
    window.MeshBus.on('file:saved', (data) => {
      scheduleReindex(data?.path);
    });
  }
}

async function saveAndReindex() {
  const S = window.MeshState;
  const A = window.MeshActions;
  const api = window.MeshAPI;
  if (!S || !api || !S.editor || !S.activeTab) return;

  const tab = S.tabs.find(t => t.path === S.activeTab);
  if (!tab) return;

  /* Get current content from editor */
  const content = S.editor.getValue();
  const path = tab.path;

  try {
    /* Save file */
    await api('/api/assistant/workspace/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });

    tab.dirty = false;
    A?.renderTabs?.();
    if (window.MeshBus) window.MeshBus.emit('file:saved', { path, content });

    /* Schedule reindex with debounce */
    scheduleReindex(path);
  } catch (e) {
    A?.toast?.('Error', 'Save failed: ' + e.message);
  }
}

function scheduleReindex(path) {
  if (reindexTimer) clearTimeout(reindexTimer);
  reindexTimer = setTimeout(() => reindexFile(path), 800);
}

async function reindexFile(path) {
  if (isReindexing) return;
  isReindexing = true;

  const api = window.MeshAPI;
  const S = window.MeshState;
  if (!api) { isReindexing = false; return; }

  /* Show indicator */
  const indicator = document.createElement('div');
  indicator.className = 'ri-indicator';
  indicator.id = 'riIndicator';
  const riSpinner = document.createElement('div'); riSpinner.className = 'ri-spinner';
  const riText = document.createElement('span'); riText.textContent = 'Re-indexing' + (path ? ' ' + path.split('/').pop() : '') + '...';
  indicator.appendChild(riSpinner); indicator.appendChild(riText);
  document.body.appendChild(indicator);

  try {
    const tab = S?.tabs?.find((entry) => entry.path === path);
    const content = typeof tab?.content === 'string'
      ? tab.content
      : (S?.editor ? S.editor.getValue() : '');
    const item = path && typeof window.MeshActions?.findInTree === 'function'
      ? window.MeshActions.findInTree(S?.tree || [], path)
      : null;
    let fingerprint = '';
    if (item?.handle?.getFile) {
      try {
        const file = await item.handle.getFile();
        fingerprint = `${Number(file.size || 0)}:${Number(file.lastModified || 0)}`;
      } catch {}
    }
    if (!fingerprint) {
      fingerprint = `${new Blob([String(content || '')]).size}:${Date.now()}`;
    }
    if (S?.workspaceIndex?.knownFilesByPath instanceof Map) {
      S.workspaceIndex.knownFilesByPath.set(path, {
        path,
        fingerprint,
      });
    }
    if (S?.workspaceIndex?.indexedFingerprintsByPath instanceof Map) {
      S.workspaceIndex.indexedFingerprintsByPath.set(path, fingerprint);
    }

    await api('/api/assistant/workspace/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: S?.workspaceId || ((S?.dirName || '') + (S?.user?.id ? '-' + S.user.id : '')),
        folderName: S?.dirName || 'workspace',
        files: path ? [{ path, content }] : [],
        deletedPaths: [],
        append: true,
        mode: 'single-file',
        scanEpoch: Number(S?.workspaceIndex?.scanEpoch || 0),
        complete: true,
      }),
    });

    indicator.innerHTML = '<span style="color:#2ea043">✓</span><span>Indexed</span>';
    setTimeout(() => { indicator.style.opacity = '0'; setTimeout(() => indicator.remove(), 300); }, 1500);

    /* Notify capsula-status to refresh */
    if (window.MeshBus) window.MeshBus.emit('mesh-indexing-complete', { path });
    window.dispatchEvent(new CustomEvent('mesh-indexing-complete', { detail: { path, mode: 'single-file' } }));
  } catch {
    indicator.innerHTML = '<span style="color:#f85149">✕</span><span>Index failed</span>';
    setTimeout(() => { indicator.style.opacity = '0'; setTimeout(() => indicator.remove(), 300); }, 2000);
  } finally {
    isReindexing = false;
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
