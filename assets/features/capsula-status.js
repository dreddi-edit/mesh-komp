/* Mesh Feature: Capsula Status Overlay in Explorer */
(function(){
const style = document.createElement('style');
style.textContent = `
.cap-badge { display: inline-flex; align-items: center; gap: 3px; margin-left: auto; padding-left: 8px; font-size: 10px; flex-shrink: 0; }
.cap-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
.cap-dot.indexed { background: #2ea043; }
.cap-dot.pending { background: #d29922; }
.cap-dot.failed { background: #f85149; }
.cap-ratio { color: #666; font-family: 'JetBrains Mono', monospace; }
`;
document.head.appendChild(style);

let capsulaData = {};

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Listen for indexing complete */
  window.addEventListener('mesh-indexing-complete', fetchCapsulaStatus);

  /* Also poll periodically after workspace is open */
  setInterval(() => {
    if (window.MeshState.dirName) fetchCapsulaStatus();
  }, 15000);

  /* MutationObserver to re-apply badges when tree re-renders */
  const tree = document.querySelector('#fileTree');
  if (tree) {
    const observer = new MutationObserver(() => setTimeout(applyBadges, 50));
    observer.observe(tree, { childList: true, subtree: true });
  }

  /* Initial fetch */
  setTimeout(fetchCapsulaStatus, 2000);
}

async function fetchCapsulaStatus() {
  const api = window.MeshAPI;
  if (!api || !window.MeshState?.dirName) return;

  try {
    const res = await api('/api/assistant/workspace/files');
    if (res?.ok && res?.files) {
      capsulaData = {};
      for (const f of res.files) {
        const path = f.path || f.name;
        capsulaData[path] = {
          status: f.status || (f.capsuleBase ? 'indexed' : 'pending'),
          ratio: f.compressionRatio || f.ratio || 0,
          originalSize: f.originalSize || f.rawBytes || 0,
          compressedSize: f.compressedSize || f.capsuleBytes || 0,
        };
      }
      applyBadges();
    }
  } catch { /* silently fail */ }
}

function applyBadges() {
  const tree = document.querySelector('#fileTree');
  if (!tree) return;

  tree.querySelectorAll('.fi').forEach(el => {
    /* Remove existing badges */
    el.querySelectorAll('.cap-badge').forEach(b => b.remove());

    const path = el.dataset.path;
    if (!path) return;
    const data = capsulaData[path];
    if (!data) return;

    const badge = document.createElement('span');
    badge.className = 'cap-badge';
    const statusClass = data.status === 'indexed' ? 'indexed' : (data.status === 'failed' ? 'failed' : 'pending');
    const ratioText = data.ratio > 0 ? data.ratio.toFixed(1) + 'x' : '';
    badge.innerHTML = '<span class="cap-dot ' + statusClass + '"></span>' + (ratioText ? '<span class="cap-ratio">' + ratioText + '</span>' : '');
    el.appendChild(badge);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
