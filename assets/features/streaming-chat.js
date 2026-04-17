/* Mesh Feature: Streaming Chat Responses (SSE) */
(function(){
const STREAM_URL = '/api/assistant/chat/stream';

function waitForReady(fn) {
  if (window.MeshState && window.MeshActions) return fn();
  if (window.MeshBus) window.MeshBus.once('mesh:ready', fn);
  else setTimeout(() => waitForReady(fn), 200);
}

waitForReady(function() {
  const S = window.MeshState;
  const A = window.MeshActions;
  const api = window.MeshAPI; // eslint-disable-line no-unused-vars

  let activeStreamAbort = null;

  function setSendIcon(btn) {
    btn.title = 'Send';
    btn.onclick = null;
    /* safe: no user content, SVG elements only */
    btn.textContent = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '12'); line.setAttribute('y1', '19');
    line.setAttribute('x2', '12'); line.setAttribute('y2', '5');
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', '5 12 12 5 19 12');
    svg.appendChild(line); svg.appendChild(poly);
    btn.appendChild(svg);
  }

  function setStopIcon(btn) {
    btn.title = 'Stop generating';
    /* safe: no user content, SVG elements only */
    btn.textContent = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'currentColor');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', '4'); rect.setAttribute('y', '4');
    rect.setAttribute('width', '16'); rect.setAttribute('height', '16');
    rect.setAttribute('rx', '2');
    svg.appendChild(rect);
    btn.appendChild(svg);
  }

  /* ── markdown renderer (reuse from core) ── */
  function renderMd(text) {
    let h = A.esc(text);
    h = h.replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) =>
      '<div class="msg-code-h"><span>' + (l || 'code') + '</span><span class="msg-copy-code" data-code="' + c.replace(/"/g, '&quot;') + '">Copy</span><span class="msg-apply" data-code="' + c.replace(/"/g, '&quot;') + '">Apply</span></div><pre>' + c + '</pre>');
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/\*(.+?)\*/g, '<em>$1</em>');
    h = h.replace(/\n/g, '<br>');
    return h;
  }

  function makeFeedbackHtml() {
    return '<div class="msg-fb">' +
      '<button title="Copy"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>' +
      '<button title="Good"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg></button>' +
      '<button title="Bad"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17"/></svg></button>' +
      '</div>';
  }

  function bindApplyButtons(el, fullContent) {
    el.querySelectorAll('.msg-apply').forEach(btn => {
      btn.addEventListener('click', () => {
        if (S.editor && S.activeTab) {
          const code = btn.dataset.code.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
          const sel = S.editor.getSelection();
          const monaco = window.MeshEditor?.monaco;
          if (sel && !sel.isEmpty()) S.editor.executeEdits('ai', [{ range: sel, text: code }]);
          else {
            const p = S.editor.getPosition();
            if (p && monaco) S.editor.executeEdits('ai', [{ range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column), text: code }]);
          }
          A.toast('Applied', 'Code inserted.');
        } else A.toast('Error', 'Open a file first');
      });
    });
    el.querySelectorAll('.msg-copy-code').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"');
        navigator.clipboard?.writeText(code);
        A.toast('Copied', '');
      });
    });
    el.querySelectorAll('.msg-fb button[title="Copy"]').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(fullContent);
        A.toast('Copied', '');
      });
    });
  }

  async function streamChat(text) {
    if (activeStreamAbort) return;
    if (!text.trim()) return;
    S.chat.push({ role: 'user', content: text });
    A.appendMsg('user', text);

    const msgs = document.querySelector('#chatMsgs');
    const btn = document.querySelector('#btnSend');
    const ctrl = new AbortController();
    activeStreamAbort = ctrl;
    if (btn) {
      btn.disabled = false;
      setStopIcon(btn);
      btn.onclick = () => { ctrl.abort(); };
    }

    /* Create streaming message element */
    const el = document.createElement('div');
    el.className = 'msg msg-assistant';
    const av = '<svg width="14" height="14" viewBox="0 0 40 40" fill="none" style="vertical-align:middle;margin-top:-2px"><path d="M10 10L5 20L10 30" stroke="var(--ac)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 10L35 20L30 30" stroke="var(--ac2)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    el.innerHTML = '<div class="msg-av">' + av + '</div><div class="msg-bd"><div class="msg-nm">Mesh.</div><div class="msg-tx"><span class="typing"><span>●</span><span>●</span><span>●</span></span></div></div>';
    if (msgs) { msgs.appendChild(el); msgs.scrollTop = msgs.scrollHeight; }

    const txEl = el.querySelector('.msg-tx');
    let accumulated = '';
    let lastRender = 0;
    const RENDER_INTERVAL = 120;

    function renderLive() {
      if (txEl) txEl.innerHTML = renderMd(accumulated) + '<span class="streaming-cursor">▊</span>';
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      lastRender = Date.now();
    }

    /* Read behavior switches saved from settings */
    const switches = S.switches || {};
    const includeContext = switches.includeContext !== false; // default on
    const streamReplies = switches.streamReplies !== false;  // default on
    const showTokens = !!switches.showTokens;

    /* If streaming is disabled by user, delegate immediately to non-streaming path */
    if (!streamReplies) {
      el.remove();
      S.chat.pop();
      await A.sendChat(text);
      return;
    }

    try {
      const model = document.querySelector('#chatModel')?.value || S.settings.model;
      const mode = document.querySelector('#chatMode')?.value || 'agent';
      let ctx = '';
      if (includeContext && S.editor && S.activeTab) {
        const v = S.editor.getModel()?.getValue() || '';
        if (v.length < 15000) ctx = '\n\n[mode:' + mode + ', file:' + S.activeTab + ']\n```\n' + v.slice(0, 10000) + '\n```';
      }
      const messages = [...S.chat];
      if (ctx) messages[messages.length - 1] = { role: 'user', content: text + ctx };

      const streamHeaders = { 'Content-Type': 'application/json' };
      if (window.MeshCsrf) {
        try { streamHeaders['X-CSRF-Token'] = await window.MeshCsrf.getToken(); } catch {}
      }
      const resp = await fetch(STREAM_URL, {
        method: 'POST',
        headers: streamHeaders,
        body: JSON.stringify({ model, messages, activeFilePath: S.activeTab || '' }),
        credentials: 'same-origin',
        signal: ctrl.signal,
      });

      if (!resp.ok || !resp.body) {
        /* Fallback to non-streaming */
        el.remove();
        S.chat.pop(); // remove the user message we pushed (sendChat will re-add)
        await A.sendChat(text);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        /* Parse SSE: track event type from "event:" lines, payload from "data:" lines */
        let currentEvent = '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('event:')) {
            currentEvent = trimmed.slice(6).trim();
            continue;
          }
          if (!trimmed.startsWith('data:')) { currentEvent = ''; continue; }
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const data = JSON.parse(payload);
            if (currentEvent === 'error' || data.error) {
              accumulated += '\n\n\u26a0 ' + (data.error || 'Unknown error');
              renderLive();
            } else if (currentEvent === 'token') {
              accumulated += data.text || '';
              if (Date.now() - lastRender > RENDER_INTERVAL) renderLive();
            } else if (currentEvent === 'done') {
              if (data.content) accumulated = data.content;
              if (window.MeshBus) {
                if (data.transport) window.MeshBus.emit('chat:transport', { contextInfo: data.transport });
                window.MeshBus.emit('chat:response', { reply: data.content, content: data.content, hasEdits: /```[\s\S]*```/.test(data.content || ''), usage: data.usage });
              }
            } else if (currentEvent === 'context') {
              if (window.MeshBus) window.MeshBus.emit('chat:transport', { contextInfo: data });
            } else if (currentEvent === 'usage') {
              if (window.MeshBus) window.MeshBus.emit('chat:response', { usage: { input_tokens: data.inputTokens, output_tokens: data.outputTokens } });
            }
            currentEvent = '';
          } catch (e) { /* skip unparseable lines */ }
        }
      }

      /* Final render */
      if (txEl) {
        let tokenBadge = '';
        if (showTokens) {
          /* Estimate token count: ~4 chars per token */
          const approxTokens = Math.round(accumulated.length / 4);
          tokenBadge = `<div><span class="msg-tokens">${approxTokens} tokens</span></div>`;
        }
        txEl.innerHTML = renderMd(accumulated) + makeFeedbackHtml() + tokenBadge;
        bindApplyButtons(el, accumulated);
      }
      S.chat.push({ role: 'assistant', content: accumulated });
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      if (window.MeshBus) window.MeshBus.emit('chat:response', { content: accumulated });

    } catch (e) {
      if (e.name === 'AbortError') {
        if (accumulated) {
          let tokenBadge = '';
          if (showTokens) {
            const approxTokens = Math.round(accumulated.length / 4);
            const badgeEl = document.createElement('div');
            const spanEl = document.createElement('span');
            spanEl.className = 'msg-tokens';
            spanEl.textContent = approxTokens + ' tokens';
            badgeEl.appendChild(spanEl);
            tokenBadge = badgeEl.outerHTML;
          }
          if (txEl) {
            /* renderMd output is sanitized via A.esc(); makeFeedbackHtml is static trusted HTML */
            txEl.innerHTML = renderMd(accumulated) + makeFeedbackHtml() + tokenBadge;
            bindApplyButtons(el, accumulated);
          }
          S.chat.push({ role: 'assistant', content: accumulated });
        } else {
          el.remove();
          S.chat.pop();
        }
      } else {
        /* Network error — fallback */
        el.remove();
        S.chat.pop();
        try { await A.sendChat(text); } catch (e2) {
          accumulated = 'Error: ' + (e2.message || e.message || 'Chat failed');
          if (txEl) txEl.innerHTML = renderMd(accumulated);
          S.chat.push({ role: 'assistant', content: accumulated });
        }
      }
    } finally {
      activeStreamAbort = null;
      if (btn) {
        btn.disabled = false;
        setSendIcon(btn);
      }
    }
  }

  /* ── Override chat send ── */
  const chatIn = document.querySelector('#chatIn');
  const sendBtn = document.querySelector('#btnSend');

  if (sendBtn) {
    const newBtn = sendBtn.cloneNode(true);
    sendBtn.parentNode.replaceChild(newBtn, sendBtn);
    newBtn.addEventListener('click', () => {
      const ta = document.querySelector('#chatIn');
      const t = ta?.value || '';
      if (ta) { ta.value = ''; ta.style.height = 'auto'; }
      streamChat(t);
    });
  }

  if (chatIn) {
    chatIn.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        const t = this.value;
        this.value = '';
        this.style.height = 'auto';
        streamChat(t);
      }
    }, true); // capture phase to override existing handler
  }

  /* ── Inject streaming cursor CSS ── */
  const style = document.createElement('style');
  style.textContent = `
    .streaming-cursor {
      display: inline;
      animation: mesh-blink 0.6s infinite;
      color: var(--ac, #0098ff);
      font-weight: 300;
    }
    @keyframes mesh-blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .msg-copy-code {
      cursor: pointer;
      margin-right: 8px;
      opacity: 0.5;
      font-size: 11px;
    }
    .msg-copy-code:hover { opacity: 1; }
  `;
  document.head.appendChild(style);
});
})();
