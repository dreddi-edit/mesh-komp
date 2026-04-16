/* Mesh Feature: Cmd+K Inline Edit */
(function(){
const style = document.createElement('style');
style.textContent = `
.ik-widget {
  position: absolute; z-index: 1000;
  background: #1a1a2e; border: 1px solid var(--ac, #0098ff);
  border-radius: 8px; padding: 8px 10px; min-width: 360px; max-width: 500px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6); backdrop-filter: blur(8px);
  display: flex; flex-direction: column; gap: 6px;
}
.ik-row { display: flex; gap: 6px; align-items: center; }
.ik-input {
  flex: 1; background: #111; border: 1px solid #333; border-radius: 6px;
  color: #eee; font-size: 13px; padding: 8px 10px; outline: none; font-family: inherit;
}
.ik-input:focus { border-color: var(--ac, #0098ff); }
.ik-input::placeholder { color: #555; }
.ik-btn {
  padding: 6px 14px; border: none; border-radius: 6px; cursor: pointer;
  font-size: 12px; font-weight: 600; font-family: inherit;
}
.ik-btn-go { background: var(--ac, #0098ff); color: #fff; }
.ik-btn-go:hover { opacity: 0.9; }
.ik-btn-cancel { background: #333; color: #aaa; }
.ik-btn-cancel:hover { background: #444; }
.ik-status { font-size: 11px; color: #777; padding: 0 2px; }
.ik-actions { display: flex; gap: 6px; justify-content: flex-end; }
.ik-accept { background: #2ea043; color: #fff; }
.ik-reject { background: #c44; color: #fff; }
.ik-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #555; border-top-color: var(--ac, #0098ff); border-radius: 50%; animation: ik-spin 0.6s linear infinite; }
@keyframes ik-spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

let widget = null;
let decorations = [];

function init() {
  const S = window.MeshState;
  if (!S) { setTimeout(init, 300); return; }

  /* Wait for Monaco to be ready */
  const checkEditor = setInterval(() => {
    if (!S.editor || !window.MeshEditor?.monaco) return;
    clearInterval(checkEditor);
    registerKeybinding();
  }, 500);
}

function registerKeybinding() {
  const editor = window.MeshState.editor;
  const monaco = window.MeshEditor.monaco;

  editor.addAction({
    id: 'mesh.inlineEdit',
    label: 'Mesh: Inline Edit (Cmd+K)',
    keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
    run: () => showInlineWidget(),
  });
}

function showInlineWidget() {
  if (widget) removeWidget();
  const editor = window.MeshState.editor;
  const monaco = window.MeshEditor.monaco;
  if (!editor || !monaco) return;

  const sel = editor.getSelection();
  const hasSelection = sel && !sel.isEmpty();
  const selectedText = hasSelection ? editor.getModel().getValueInRange(sel) : '';
  const line = sel ? sel.startLineNumber : editor.getPosition()?.lineNumber || 1;

  widget = document.createElement('div');
  widget.className = 'ik-widget';
  widget.innerHTML = `
    <div class="ik-status">${hasSelection ? 'Editing selection (' + selectedText.split('\n').length + ' lines)' : 'Editing at cursor (line ' + line + ')'}</div>
    <div class="ik-row">
      <input class="ik-input" placeholder="Describe the change... (e.g., make async, add error handling)" autofocus>
      <button class="ik-btn ik-btn-go">Generate</button>
      <button class="ik-btn ik-btn-cancel">Esc</button>
    </div>
  `;

  /* Position widget */
  const editorDom = editor.getDomNode();
  const layoutInfo = editor.getLayoutInfo();
  const top = editor.getTopForLineNumber(line) - editor.getScrollTop() + 24;
  widget.style.top = Math.max(10, Math.min(top, layoutInfo.height - 100)) + 'px';
  widget.style.left = '40px';
  editorDom.parentElement.style.position = 'relative';
  editorDom.parentElement.appendChild(widget);

  const inp = widget.querySelector('.ik-input');
  const goBtn = widget.querySelector('.ik-btn-go');
  const cancelBtn = widget.querySelector('.ik-btn-cancel');

  setTimeout(() => inp.focus(), 50);

  cancelBtn.addEventListener('click', removeWidget);
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); removeWidget(); }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doGenerate(inp.value, sel, selectedText); }
  });
  goBtn.addEventListener('click', () => doGenerate(inp.value, sel, selectedText));
}

async function doGenerate(instruction, sel, originalText) {
  if (!instruction.trim()) return;
  const editor = window.MeshState.editor;
  const monaco = window.MeshEditor.monaco;
  const api = window.MeshAPI;
  if (!editor || !monaco || !api) return;

  /* Show loading */
  const inp = widget.querySelector('.ik-input');
  if (inp) inp.disabled = true;
  const goBtn = widget.querySelector('.ik-btn-go');
  if (goBtn) goBtn.innerHTML = '<span class="ik-spinner"></span>';

  const lang = editor.getModel()?.getLanguageId() || 'text';
  const contextLines = 20;
  const fullText = editor.getModel().getValue();
  const startLine = sel ? Math.max(1, sel.startLineNumber - contextLines) : Math.max(1, editor.getPosition().lineNumber - contextLines);
  const endLine = sel ? Math.min(editor.getModel().getLineCount(), sel.endLineNumber + contextLines) : Math.min(editor.getModel().getLineCount(), editor.getPosition().lineNumber + contextLines);

  const surroundingCode = fullText.split('\n').slice(startLine - 1, endLine).join('\n');
  const codeToEdit = originalText || editor.getModel().getLineContent(editor.getPosition()?.lineNumber || 1);

  const prompt = `You are editing ${lang} code. The user selected this code:\n\`\`\`${lang}\n${codeToEdit}\n\`\`\`\n\nSurrounding context:\n\`\`\`${lang}\n${surroundingCode}\n\`\`\`\n\nInstruction: ${instruction}\n\nRespond with ONLY the replacement code, no explanation. Output the new code inside a single code block.`;

  try {
    const res = await api('/api/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: document.querySelector('#chatModel')?.value || 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    let reply = String(res?.content || '');
    /* Extract code from code block */
    const codeMatch = reply.match(/```[\w]*\n([\s\S]*?)```/);
    const newCode = codeMatch ? codeMatch[1].replace(/\n$/, '') : reply.trim();

    /* Show accept/reject */
    if (widget) {
      widget.innerHTML = `
        <div class="ik-status">AI suggestion ready</div>
        <div class="ik-actions">
          <button class="ik-btn ik-accept">✓ Accept (Enter)</button>
          <button class="ik-btn ik-reject">✕ Reject (Esc)</button>
        </div>
      `;

      /* Show preview with decorations */
      const range = sel && !sel.isEmpty() ? sel : new monaco.Range(
        editor.getPosition().lineNumber, 1,
        editor.getPosition().lineNumber, editor.getModel().getLineMaxColumn(editor.getPosition().lineNumber)
      );

      /* Highlight the range being edited */
      decorations = editor.deltaDecorations(decorations, [{
        range: range,
        options: {
          className: 'ik-highlight',
          isWholeLine: false,
          inlineClassName: 'ik-inline-highlight',
        }
      }]);

      /* Add inline highlight CSS if not yet */
      if (!document.querySelector('#ik-deco-style')) {
        const ds = document.createElement('style');
        ds.id = 'ik-deco-style';
        ds.textContent = '.ik-highlight { background: rgba(0,152,255,0.1) !important; } .ik-inline-highlight { background: rgba(0,152,255,0.15); }';
        document.head.appendChild(ds);
      }

      widget.querySelector('.ik-accept').addEventListener('click', () => {
        editor.executeEdits('mesh-inline', [{
          range: range,
          text: newCode,
        }]);
        window.MeshActions?.toast('Applied', 'Inline edit applied');
        removeWidget();
      });
      widget.querySelector('.ik-reject').addEventListener('click', removeWidget);

      /* Keyboard shortcuts for accept/reject */
      const handler = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); widget?.querySelector('.ik-accept')?.click(); document.removeEventListener('keydown', handler, true); }
        if (e.key === 'Escape') { e.preventDefault(); removeWidget(); document.removeEventListener('keydown', handler, true); }
      };
      document.addEventListener('keydown', handler, true);
    }
  } catch (e) {
    if (widget) { widget.textContent = ''; const ikErr = document.createElement('div'); ikErr.className = 'ik-status'; ikErr.style.color = '#f66'; ikErr.textContent = 'Error: ' + String(e.message || 'Failed'); const ikClose = document.createElement('button'); ikClose.className = 'ik-btn ik-btn-cancel'; ikClose.textContent = 'Close'; ikClose.onclick = () => widget && widget.remove(); widget.appendChild(ikErr); widget.appendChild(ikClose); }
  }
}

function removeWidget() {
  if (widget) { widget.remove(); widget = null; }
  const editor = window.MeshState?.editor;
  if (editor && decorations.length) {
    decorations = editor.deltaDecorations(decorations, []);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
