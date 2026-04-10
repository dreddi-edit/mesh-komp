/* Mesh Feature: Persistent Chat Threads */
(function(){
const style = document.createElement('style');
style.textContent = `
/* Thread Sidebar */
.ct-sidebar {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--bd, #3c3c3c);
  width: 240px;
  background: var(--bg5, #181818);
  font-family: var(--f, 'Inter', system-ui, sans-serif);
  overflow: hidden;
}

.ct-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--bd, #3c3c3c);
}

.ct-header-title {
  font-size: 10px;
  color: var(--tx3, #777);
  text-transform: uppercase;
  letter-spacing: 1.5px;
  font-weight: 600;
}

.ct-new-btn {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  font-size: 15px;
  background: none;
  border: 1px solid var(--bd, #3c3c3c);
  color: var(--tx3, #777);
  cursor: pointer;
  transition: all 0.15s;
  font-family: var(--f);
  line-height: 1;
}
.ct-new-btn:hover {
  color: var(--ac, #0098ff);
  border-color: var(--ac, #0098ff);
  background: rgba(0,152,255,0.06);
}

.ct-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ct-item {
  display: flex;
  align-items: center;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 12px;
  color: var(--tx, #ccc);
  gap: 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  transition: all 0.12s;
  min-height: 40px;
}
.ct-item:hover {
  background: var(--bg3, #2d2d2d);
  border-color: var(--bd, #3c3c3c);
}
.ct-item.active {
  background: var(--acs, rgba(0,152,255,.08));
  border-color: rgba(0,152,255,0.2);
  color: var(--txw, #fff);
}

.ct-item-icon {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--bg3, #2d2d2d);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  font-size: 13px;
  color: var(--tx3, #777);
}
.ct-item.active .ct-item-icon {
  background: rgba(0,152,255,0.12);
  color: var(--ac, #0098ff);
}

.ct-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ct-item-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.3;
}

.ct-item-meta {
  font-size: 10px;
  color: var(--tx3, #777);
  font-family: var(--m, monospace);
  letter-spacing: 0.02em;
}

.ct-item-del {
  width: 22px;
  height: 22px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  font-size: 12px;
  opacity: 0;
  color: var(--tx3, #777);
  cursor: pointer;
  background: none;
  border: none;
  flex-shrink: 0;
  transition: all 0.12s;
}
.ct-item:hover .ct-item-del { opacity: 1; }
.ct-item-del:hover {
  color: var(--red, #f14c4c);
  background: rgba(241,76,76,0.1);
}

/* Toggle Button */
.ct-toggle {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 20px;
  height: 48px;
  background: var(--bg2, #252526);
  border: 1px solid var(--bd, #3c3c3c);
  border-left: none;
  border-radius: 0 6px 6px 0;
  cursor: pointer;
  color: var(--tx3, #777);
  font-size: 10px;
  z-index: 10;
  display: grid;
  place-items: center;
  transition: all 0.15s;
}
.ct-toggle:hover {
  color: var(--txw, #fff);
  background: var(--bg3, #2d2d2d);
}

/* Empty state */
.ct-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
  color: var(--tx3, #777);
  font-size: 11px;
  gap: 8px;
  flex: 1;
}
.ct-empty-icon {
  font-size: 24px;
  opacity: 0.4;
  margin-bottom: 4px;
}
`;
document.head.appendChild(style);

const STORAGE_KEY = 'mesh-chat-threads';
let threads = [];
let activeThreadId = null;
let sidebarVisible = false;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  loadThreads();

  const chatPanel = document.querySelector('#chatPanel');
  if (chatPanel) {
    chatPanel.style.position = 'relative';
    const toggle = document.createElement('button');
    toggle.className = 'ct-toggle';
    toggle.innerHTML = '&#9666;';
    toggle.title = 'Chat Threads';
    toggle.addEventListener('click', toggleSidebar);
    chatPanel.prepend(toggle);
  }

  if (window.MeshBus) {
    window.MeshBus.on('chat:response', () => saveCurrentThread());
    window.MeshBus.on('chat:user-message', () => saveCurrentThread());
  }

  const newChatBtn = document.querySelector('#btnNewChat');
  if (newChatBtn) {
    newChatBtn.addEventListener('click', () => {
      saveCurrentThread();
      createNewThread();
    });
  }
}

function loadThreads() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) threads = JSON.parse(stored);
  } catch { threads = []; }
  if (threads.length > 0) {
    activeThreadId = threads[threads.length - 1].id;
  } else {
    createNewThread();
  }
}

function saveThreads() {
  try {
    if (threads.length > 100) threads = threads.slice(-100);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
  } catch {}
}

function createNewThread() {
  const thread = {
    id: 'thread-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    title: 'New Chat',
    messages: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  threads.push(thread);
  activeThreadId = thread.id;
  saveThreads();
  const S = window.MeshState;
  if (S) {
    S.chat = [];
    window.MeshActions?.renderChat?.();
  }
  renderSidebar();
  return thread;
}

function saveCurrentThread() {
  if (!activeThreadId) return;
  const S = window.MeshState;
  if (!S) return;
  const thread = threads.find(t => t.id === activeThreadId);
  if (!thread) return;
  thread.messages = S.chat ? [...S.chat] : [];
  thread.updatedAt = Date.now();
  if (thread.title === 'New Chat' && thread.messages.length > 0) {
    const firstUser = thread.messages.find(m => m.role === 'user');
    if (firstUser) {
      const text = typeof firstUser.content === 'string' ? firstUser.content : (firstUser.content?.[0]?.text || '');
      thread.title = text.slice(0, 50).trim() || 'New Chat';
      if (text.length > 50) thread.title += '\u2026';
    }
  }
  saveThreads();
  renderSidebar();
}

function switchThread(threadId) {
  saveCurrentThread();
  const thread = threads.find(t => t.id === threadId);
  if (!thread) return;
  activeThreadId = threadId;
  const S = window.MeshState;
  if (S) {
    S.chat = thread.messages ? [...thread.messages] : [];
    window.MeshActions?.renderChat?.();
  }
  renderSidebar();
}

function deleteThread(threadId) {
  threads = threads.filter(t => t.id !== threadId);
  if (activeThreadId === threadId) {
    if (threads.length > 0) switchThread(threads[threads.length - 1].id);
    else createNewThread();
  }
  saveThreads();
  renderSidebar();
}

function toggleSidebar() {
  sidebarVisible = !sidebarVisible;
  const chatPanel = document.querySelector('#chatPanel');
  const toggle = chatPanel?.querySelector('.ct-toggle');

  let sidebar = document.querySelector('#ctSidebar');
  if (sidebarVisible) {
    if (!sidebar) {
      sidebar = document.createElement('div');
      sidebar.id = 'ctSidebar';
      sidebar.className = 'ct-sidebar';
      chatPanel.prepend(sidebar);
    }
    sidebar.style.display = 'flex';
    if (toggle) toggle.innerHTML = '&#9656;';
    renderSidebar();
  } else {
    if (sidebar) sidebar.style.display = 'none';
    if (toggle) toggle.innerHTML = '&#9666;';
  }
}

function renderSidebar() {
  const sidebar = document.querySelector('#ctSidebar');
  if (!sidebar || !sidebarVisible) return;

  const sorted = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);

  let html = `<div class="ct-header"><span class="ct-header-title">Threads</span><button class="ct-new-btn" id="ctNewThread" title="New Thread">+</button></div>`;

  if (sorted.length === 0) {
    html += '<div class="ct-empty"><div class="ct-empty-icon">\u2709</div><div>No threads yet</div></div>';
  } else {
    html += '<div class="ct-list">';
    for (const t of sorted) {
      const isActive = t.id === activeThreadId;
      const msgCount = t.messages?.length || 0;
      const time = formatTime(t.updatedAt);
      const meta = msgCount > 0 ? msgCount + ' msg' + (msgCount !== 1 ? 's' : '') + ' \u00b7 ' + time : time;

      html += `<div class="ct-item${isActive ? ' active' : ''}" data-id="${t.id}">
        <div class="ct-item-icon">\u{1F4AC}</div>
        <div class="ct-item-body">
          <div class="ct-item-title">${esc(t.title)}</div>
          <div class="ct-item-meta">${meta}</div>
        </div>
        <button class="ct-item-del" data-id="${t.id}" title="Delete">\u00d7</button>
      </div>`;
    }
    html += '</div>';
  }

  sidebar.innerHTML = html;

  sidebar.querySelector('#ctNewThread')?.addEventListener('click', () => {
    saveCurrentThread();
    createNewThread();
  });
  sidebar.querySelectorAll('.ct-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('ct-item-del')) return;
      switchThread(el.dataset.id);
    });
  });
  sidebar.querySelectorAll('.ct-item-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteThread(btn.dataset.id);
    });
  });
}

function formatTime(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

window.MeshThreads = { createNewThread, switchThread, saveCurrentThread };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
