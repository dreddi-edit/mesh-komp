/* Mesh Feature: Problems Panel (Live Errors) */
(function(){
const style = document.createElement('style');
style.textContent = `
.pp-list { padding: 4px 0; }
.pp-item { display: flex; align-items: flex-start; gap: 8px; padding: 5px 12px; cursor: pointer; font-size: 12px; color: #ccc; }
.pp-item:hover { background: #222; }
.pp-icon { flex-shrink: 0; width: 16px; font-size: 13px; text-align: center; margin-top: 1px; }
.pp-icon.error { color: #f44; }
.pp-icon.warning { color: #fa0; }
.pp-icon.info { color: #4af; }
.pp-msg { flex: 1; word-break: break-word; line-height: 1.4; }
.pp-loc { font-size: 11px; color: #666; margin-top: 2px; }
.pp-src { font-size: 10px; background: #2a2a2a; color: #888; padding: 1px 5px; border-radius: 3px; margin-left: auto; flex-shrink: 0; }
.pp-fix-btn { font-size: 10px; background: var(--ac, #0098ff); color: #fff; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer; margin-left: 4px; }
.pp-fix-btn:hover { opacity: 0.8; }
.pp-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 12px; border-bottom: 1px solid #2a2a2a; }
.pp-header-title { font-size: 11px; color: #888; }
.pp-clear { font-size: 11px; color: #666; cursor: pointer; background: none; border: none; }
.pp-clear:hover { color: #aaa; }
.pp-empty { padding: 16px; text-align: center; color: #555; font-size: 12px; }
`;
document.head.appendChild(style);

let problems = [];
let terminalErrors = [];

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }
  setInterval(pollProblems, 2000);
}

function pollProblems() {
  if (!window.monaco?.editor) return;

  /* Collect Monaco markers (linting, TypeScript errors, etc.) */
  const markers = window.monaco.editor.getModelMarkers({});
  const monacoProblems = markers.map(m => ({
    severity: m.severity === 8 ? 'error' : (m.severity === 4 ? 'warning' : 'info'),
    message: m.message,
    file: m.resource?.path || '',
    line: m.startLineNumber,
    col: m.startColumn,
    source: m.owner || 'Monaco',
  }));

  problems = [...monacoProblems, ...terminalErrors];

  /* Update status bar */
  const stErrors = document.querySelector('#stErrors');
  if (stErrors) {
    const errCount = problems.filter(p => p.severity === 'error').length;
    const warnCount = problems.filter(p => p.severity === 'warning').length;
    stErrors.textContent = '\u2715 ' + errCount + ' \u26a0 ' + warnCount;
    if (errCount > 0) stErrors.style.color = '#f44';
    else if (warnCount > 0) stErrors.style.color = '#fa0';
    else stErrors.style.color = '';
  }

  render();
}

function render() {
  const panel = document.querySelector('.bp-content[data-bp="problems"]');
  if (!panel) return;

  if (!problems.length) {
    panel.innerHTML = '<div class="pp-empty">No problems detected.</div>';
    return;
  }

  /* Sort: errors first */
  const sorted = [...problems].sort((a, b) => {
    const order = { error: 0, warning: 1, info: 2 };
    return (order[a.severity] || 3) - (order[b.severity] || 3);
  });

  panel.textContent = '';

  const header = document.createElement('div'); header.className = 'pp-header';
  const headerTitle = document.createElement('span'); headerTitle.className = 'pp-header-title'; headerTitle.textContent = problems.length + ' problems';
  const clearBtn = document.createElement('button'); clearBtn.className = 'pp-clear'; clearBtn.id = 'ppClear'; clearBtn.textContent = 'Clear All';
  header.appendChild(headerTitle); header.appendChild(clearBtn);
  panel.appendChild(header);

  const list = document.createElement('div'); list.className = 'pp-list';
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const icon = p.severity === 'error' ? '●' : (p.severity === 'warning' ? '▲' : 'ℹ');
    // severity is validated against known values; use a safe allowlist for the CSS class
    const severityClass = ['error', 'warning', 'info'].includes(p.severity) ? p.severity : 'info';

    const item = document.createElement('div'); item.className = 'pp-item'; item.dataset.idx = String(i);
    const iconSpan = document.createElement('span'); iconSpan.className = 'pp-icon ' + severityClass; iconSpan.textContent = icon;
    const inner = document.createElement('div');
    const msgDiv = document.createElement('div'); msgDiv.className = 'pp-msg'; msgDiv.textContent = String(p.message || '');
    const locDiv = document.createElement('div'); locDiv.className = 'pp-loc';
    locDiv.textContent = String(p.file || '') + (p.line ? ':' + p.line : '') + (p.col ? ':' + p.col : '');
    inner.appendChild(msgDiv); inner.appendChild(locDiv);
    const srcSpan = document.createElement('span'); srcSpan.className = 'pp-src'; srcSpan.textContent = String(p.source || '');
    const fixBtn = document.createElement('button'); fixBtn.className = 'pp-fix-btn'; fixBtn.dataset.idx = String(i); fixBtn.textContent = 'AI Fix';
    item.appendChild(iconSpan); item.appendChild(inner); item.appendChild(srcSpan); item.appendChild(fixBtn);
    list.appendChild(item);
  }
  panel.appendChild(list);

  /* Bind clicks */
  panel.querySelectorAll('.pp-item').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.classList.contains('pp-fix-btn')) return;
      const p = sorted[parseInt(el.dataset.idx)];
      if (p) openAtLine(p.file, p.line);
    });
  });

  panel.querySelectorAll('.pp-fix-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const p = sorted[parseInt(btn.dataset.idx)];
      if (p) askAIFix(p);
    });
  });

  panel.querySelector('#ppClear')?.addEventListener('click', () => {
    terminalErrors = [];
    problems = [];
    render();
    pollProblems();
  });
}

function openAtLine(filePath, line) {
  const S = window.MeshState;
  const A = window.MeshActions;
  if (!S || !A || !filePath) return;
  /* Try to find by end of path match */
  const cleanPath = filePath.replace(/^\//, '');
  const item = A.findInTree(S.tree, cleanPath);
  if (item) {
    A.openFile(item);
    setTimeout(() => {
      if (S.editor && line > 0) {
        S.editor.revealLineInCenter(line);
        S.editor.setPosition({ lineNumber: line, column: 1 });
      }
    }, 200);
  }
}

function askAIFix(problem) {
  const chatIn = document.querySelector('#chatIn');
  if (!chatIn) return;
  const msg = 'Fix this error in `' + (problem.file || 'unknown') + '`' + (problem.line ? ' at line ' + problem.line : '') + ':\n\n```\n' + problem.message + '\n```';
  chatIn.value = msg;
  chatIn.style.height = 'auto';
  chatIn.style.height = Math.min(chatIn.scrollHeight, 100) + 'px';
  chatIn.focus();
  window.MeshActions?.toast('Problem', 'Error context added to chat');
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* Listen for terminal errors */
if (window.MeshBus) {
  window.MeshBus.on('terminal:output', (data) => {
    const text = String(data?.text || '');
    const errorPatterns = [
      /(?:Error|TypeError|SyntaxError|ReferenceError|RangeError):\s*(.+)/,
      /FAIL\s+(.+)/,
      /error\[E\d+\]:\s*(.+)/,
      /error TS\d+:\s*(.+)/,
    ];
    for (const pat of errorPatterns) {
      const m = text.match(pat);
      if (m) {
        terminalErrors.push({ severity: 'error', message: m[1] || m[0], file: '', line: 0, source: 'Terminal' });
        if (terminalErrors.length > 50) terminalErrors.shift();
        break;
      }
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
