/* Mesh Feature: .meshrules Custom AI Rules */
(function(){
const style = document.createElement('style');
style.textContent = `
.mr-banner { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: rgba(0,152,255,0.06); border: 1px solid rgba(0,152,255,0.15); border-radius: 6px; margin: 6px 12px; font-size: 11px; color: #aaa; }
.mr-banner-icon { font-size: 14px; }
.mr-banner-text { flex: 1; }
.mr-banner-edit { font-size: 10px; color: var(--ac, #0098ff); cursor: pointer; background: none; border: none; }
.mr-banner-edit:hover { text-decoration: underline; }
`;
document.head.appendChild(style);

let rulesContent = null;
let rulesLoaded = false;

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Load .meshrules when workspace opens */
  if (window.MeshBus) {
    window.MeshBus.on('mesh:ready', loadRules);
    window.MeshBus.on('workspace:opened', loadRules);
    window.MeshBus.on('file:saved', (data) => {
      if (data?.path?.endsWith('.meshrules')) loadRules();
    });
  }

  /* Try loading now if workspace is already open */
  if (window.MeshState.dirName) setTimeout(loadRules, 1000);

  /* Inject rules into chat messages */
  if (window.MeshBus) {
    window.MeshBus.on('chat:before-send', (data) => {
      if (rulesContent && data?.messages) {
        injectRules(data.messages);
      }
    });
  }
}

async function loadRules() {
  const api = window.MeshAPI;
  if (!api || !window.MeshState?.dirName) return;

  try {
    const res = await api('/api/assistant/workspace/file?path=' + encodeURIComponent('.meshrules'));
    if (res?.content) {
      rulesContent = res.content;
      rulesLoaded = true;
      showBanner();
    } else {
      rulesContent = null;
      rulesLoaded = true;
      hideBanner();
    }
  } catch {
    rulesContent = null;
    rulesLoaded = true;
    hideBanner();
  }
}

function injectRules(messages) {
  if (!rulesContent) return;

  /* Prepend as system-level context */
  const rulesBlock = `<project-rules>\nThe following project rules from .meshrules must be followed:\n\n${rulesContent}\n</project-rules>`;

  /* Find or create system message, or prepend to first user message */
  if (messages.length > 0 && messages[0].role === 'system') {
    messages[0].content = rulesBlock + '\n\n' + messages[0].content;
  } else if (messages.length > 0) {
    /* Prepend context to first user message */
    const first = messages.find(m => m.role === 'user');
    if (first) {
      if (typeof first.content === 'string') {
        first.content = rulesBlock + '\n\n' + first.content;
      }
    }
  }
}

function showBanner() {
  hideBanner();
  const chatPanel = document.querySelector('#chatPanel');
  if (!chatPanel) return;

  const banner = document.createElement('div');
  banner.className = 'mr-banner';
  banner.id = 'mrBanner';

  const lines = rulesContent.split('\n').filter(l => l.trim()).length;
  banner.innerHTML = `
    <span class="mr-banner-icon">\u2261</span>
    <span class="mr-banner-text">.meshrules loaded (${lines} rules)</span>
    <button class="mr-banner-edit" id="mrEdit">Edit</button>
  `;

  /* Insert at top of chat panel */
  const chatMsgs = chatPanel.querySelector('#chatMsgs');
  if (chatMsgs) chatPanel.insertBefore(banner, chatMsgs);
  else chatPanel.prepend(banner);

  banner.querySelector('#mrEdit').addEventListener('click', () => {
    const A = window.MeshActions;
    const S = window.MeshState;
    if (A && S) {
      const item = A.findInTree(S.tree, '.meshrules');
      if (item) A.openFile(item);
      else {
        /* Create the file */
        createDefaultRules();
      }
    }
  });
}

function hideBanner() {
  const banner = document.querySelector('#mrBanner');
  if (banner) banner.remove();
}

async function createDefaultRules() {
  const api = window.MeshAPI;
  const A = window.MeshActions;
  if (!api) return;

  const defaultContent = `# .meshrules - Project AI Rules
# These rules are automatically injected into every AI chat message.
# Customize them to match your project's conventions.

# Code Style
- Use consistent naming conventions
- Follow existing code patterns in this project
- Add comments only for non-obvious logic

# Testing
- Write tests for new features
- Ensure existing tests pass before submitting

# Documentation
- Update relevant docs when changing APIs
- Keep README up to date
`;

  try {
    await api('/api/assistant/workspace/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '.meshrules', content: defaultContent }),
    });
    rulesContent = defaultContent;
    showBanner();
    A?.toast?.('Rules', '.meshrules created');
    /* Refresh tree to show the new file */
    A?.refreshTree?.();
  } catch (e) {
    A?.toast?.('Error', 'Failed to create .meshrules: ' + e.message);
  }
}

/* Expose */
window.MeshRules = { getRules: () => rulesContent, reload: loadRules };

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
