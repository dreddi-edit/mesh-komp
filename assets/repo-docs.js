(function () {
  const $ = (selector, root = document) => root.querySelector(selector);

  const state = {
    docs: [],
    tree: [],
    filter: '',
    activePath: '',
  };

  function esc(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  async function loadIndex() {
    const response = await fetch('/api/docs/index', { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Docs index failed (${response.status})`);
    return response.json();
  }

  async function loadFile(filePath) {
    const response = await fetch(`/api/docs/file?path=${encodeURIComponent(filePath)}`, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Docs file failed (${response.status})`);
    return response.json();
  }

  function matchesFilter(value) {
    const query = state.filter.trim().toLowerCase();
    if (!query) return true;
    return String(value || '').toLowerCase().includes(query);
  }

  function renderDocsList() {
    const root = $('#repoDocsList');
    if (!root) return;
    root.innerHTML = '';
    const docs = state.docs.filter((doc) => matchesFilter(`${doc.group} ${doc.path}`));
    for (const doc of docs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'repo-docs-nav-item' + (doc.path === state.activePath ? ' is-active' : '');
      button.innerHTML = `<span>${esc(doc.name)}</span><small>${esc(doc.group)}</small>`;
      button.addEventListener('click', () => openPath(doc.path));
      root.appendChild(button);
    }
  }

  function getFileIcon(ext) {
    const e = String(ext).toLowerCase();
    if (e === ".md") return "📝";
    if (e === ".js" || e === ".cjs" || e === ".mjs") return "⚡";
    if (e === ".css") return "🎨";
    if (e === ".html") return "🌐";
    if (e === ".json") return "⚙️";
    return "📄";
  }

  function createTreeNode(node) {
    if (node.type === 'dir') {
      const wrap = document.createElement('div');
      wrap.className = 'repo-tree-dir is-open';
      if (!matchesFilter(node.path) && !(node.children || []).some((child) => subtreeMatches(child))) {
        return document.createDocumentFragment();
      }
      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'repo-tree-dir-head';
      head.innerHTML = `<span><i class="repo-tree-icon">📁</i>${esc(node.name)}</span>`;
      head.addEventListener('click', () => wrap.classList.toggle('is-open'));
      wrap.appendChild(head);

      const children = document.createElement('div');
      children.className = 'repo-tree-children';
      for (const child of node.children || []) {
        children.appendChild(createTreeNode(child));
      }
      wrap.appendChild(children);
      return wrap;
    }

    if (!matchesFilter(node.path)) return document.createDocumentFragment();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'repo-tree-file' + (node.path === state.activePath ? ' is-active' : '');
    const icon = getFileIcon(node.ext || '');
    button.innerHTML = `<span><i class="repo-tree-icon">${icon}</i>${esc(node.name)}</span><small>${esc(node.ext || '')}</small>`;
    button.addEventListener('click', () => openPath(node.path));
    return button;
  }

  function subtreeMatches(node) {
    if (node.type === 'file') return matchesFilter(node.path);
    return matchesFilter(node.path) || (node.children || []).some((child) => subtreeMatches(child));
  }

  function renderTree() {
    const root = $('#repoTree');
    if (!root) return;
    root.innerHTML = '';
    for (const item of state.tree) {
      root.appendChild(createTreeNode(item));
    }
  }

  function renderMeta(index) {
    const meta = $('#repoDocsMeta');
    if (!meta) return;
    const docsCount = Array.isArray(index.docs) ? index.docs.length : 0;
    meta.textContent = `${docsCount} docs indexed - generated ${new Date(index.generatedAt).toLocaleString()}`;
  }

  function renderBreadcrumbs(filePath) {
    if (!filePath) return "";
    const parts = filePath.split("/");
    let html = '<div class="repo-docs-breadcrumbs">';
    parts.forEach((part, i) => {
      html += `<span class="repo-docs-breadcrumb-part">${esc(part)}</span>`;
      if (i < parts.length - 1) html += `<span class="repo-docs-breadcrumb-sep">/</span>`;
    });
    html += '</div>';
    return html;
  }

  async function openPath(filePath) {
    state.activePath = filePath;
    renderDocsList();
    renderTree();

    const welcome = $('#repoDocsWelcome');
    const content = $('#repoDocsContent');
    if (welcome) welcome.hidden = true;
    if (content) content.hidden = false;
    if (content) content.innerHTML = '<div class="repo-docs-path">Loading...</div>';

    try {
      const data = await loadFile(filePath);
      if (!data.ok) throw new Error(data.error || 'Failed to load file');
      if (content) {
        content.innerHTML = `
          ${renderBreadcrumbs(data.path)}
          <div class="repo-docs-updated">Updated ${esc(new Date(data.updatedAt).toLocaleString())}</div>
          ${data.html || `<pre class="repo-docs-code"><code>${esc(data.content || '')}</code></pre>`}
        `;
      }
    } catch (error) {
      if (content) {
        content.innerHTML = `
          ${renderBreadcrumbs(filePath)}
          <div class="repo-docs-updated">Could not load this file</div>
          <pre class="repo-docs-code"><code>${esc(error.message || 'Unknown error')}</code></pre>
        `;
      }
    }
  }

  async function boot() {
    const search = $('#repoDocsSearch');
    if (search) {
      const clear = $('#repoDocsSearchClear');
      if (clear) clear.addEventListener('click', () => { search.value = ''; state.filter = ''; renderDocsList(); renderTree(); });
      search.addEventListener('input', () => {
        state.filter = search.value || '';
        renderDocsList();
        renderTree();
      });
    }

    try {
      const index = await loadIndex();
      if (!index.ok) throw new Error(index.error || 'Failed to load docs index');
      state.docs = index.docs || [];
      state.tree = index.tree || [];
      renderMeta(index);
      renderDocsList();
      renderTree();

      const initialPath = new URLSearchParams(window.location.search).get('path') || state.docs[0]?.path || '';
      if (initialPath) await openPath(initialPath);
    } catch (error) {
      const meta = $('#repoDocsMeta');
      const content = $('#repoDocsContent');
      const welcome = $('#repoDocsWelcome');
      if (meta) meta.textContent = 'Docs surface failed to initialize';
      if (welcome) welcome.hidden = true;
      if (content) {
        content.hidden = false;
        content.innerHTML = `<pre class="repo-docs-code"><code>${esc(error.message || 'Unknown error')}</code></pre>`;
      }
    }
  }

  boot();
})();
