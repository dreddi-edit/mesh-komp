/* Mesh Feature: Capsula Status Overlay in Explorer */
(function(){

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  window.addEventListener('mesh-indexing-complete', applyBadges);
  window.addEventListener('mesh-indexing-initial-ready', applyBadges);

  setInterval(() => {
    if (window.MeshState.dirName) applyBadges();
  }, 15000);

  const tree = document.querySelector('#fileTree');
  if (tree) {
    const observer = new MutationObserver(() => setTimeout(applyBadges, 50));
    observer.observe(tree, { childList: true, subtree: true });
  }

  setTimeout(applyBadges, 2000);
}

/** Read directly from the client-side S.compressionMap (always up-to-date). */
function getMap() {
  return window.MeshState?.compressionMap;
}

function getDirStats(dirPath) {
  const map = getMap();
  if (!map || !map.size) return null;

  const prefix = dirPath + '/';
  let totalOriginal = 0;
  let totalCompressed = 0;
  let indexedCount = 0;
  let pendingCount = 0;
  let failedCount = 0;

  for (const [p, d] of map) {
    if (!p.startsWith(prefix)) continue;
    totalOriginal += d.rawBytes || 0;
    totalCompressed += d.capsuleBytes || 0;
    const st = d.status || 'pending';
    if (st === 'indexed' || st === 'completed') indexedCount++;
    else if (st === 'failed') failedCount++;
    else pendingCount++;
  }

  const fileCount = indexedCount + pendingCount + failedCount;
  if (fileCount === 0) return null;
  const ratio = totalOriginal > 0 ? Math.max(0, 1 - totalCompressed / totalOriginal) : 0;
  const status = failedCount > 0 ? 'failed' : (pendingCount > 0 ? 'pending' : 'indexed');
  return { ratio, status, fileCount };
}

function applyBadges() {
  const tree = document.querySelector('#fileTree');
  if (!tree) return;
  const map = getMap();
  if (!map || !map.size) return;

  tree.querySelectorAll('.fi').forEach(el => {
    el.querySelectorAll('.cap-badge').forEach(b => b.remove());

    const path = el.dataset.path;
    if (!path) return;

    const isDir = el.querySelector('.fi-ch') !== null;
    let status, ratioText;

    if (isDir) {
      const stats = getDirStats(path);
      if (!stats) return;
      status = stats.status;
      ratioText = stats.ratio > 0
        ? Math.round(stats.ratio * 100) + '% (' + stats.fileCount + ')'
        : stats.fileCount + ' files';
    } else {
      const data = map.get(path);
      if (!data) return;
      status = data.status || 'pending';
      const raw = data.rawBytes || 0;
      const cap = data.capsuleBytes || 0;
      const pct = raw > 0 ? Math.round((1 - cap / raw) * 100) : 0;
      ratioText = pct > 0 ? pct + '%' : '';
    }

    const badge = document.createElement('span');
    badge.className = 'cap-badge';
    const statusClass = (status === 'indexed' || status === 'completed') ? 'indexed' : (status === 'failed' ? 'failed' : 'pending');
    const dot = document.createElement('span');
    dot.className = 'cap-dot ' + statusClass;
    badge.appendChild(dot);
    if (ratioText) {
      const span = document.createElement('span');
      span.className = 'cap-ratio';
      span.textContent = ratioText;
      badge.appendChild(span);
    }
    el.appendChild(badge);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
