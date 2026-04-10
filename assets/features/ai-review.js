/* Mesh Feature: AI Code Review in Diff View */
(function(){
const style = document.createElement('style');
style.textContent = `
.ar-btn { font-size: 11px; padding: 3px 10px; border-radius: 4px; border: 1px solid #8b5cf6; color: #8b5cf6; background: none; cursor: pointer; margin-left: 4px; }
.ar-btn:hover { background: #8b5cf6; color: #fff; }
.ar-comments { padding: 8px 12px; max-height: 300px; overflow-y: auto; background: #0d0d14; border-bottom: 1px solid #2a2a2a; }
.ar-comment { display: flex; gap: 8px; padding: 8px; margin-bottom: 6px; background: #1a1a2a; border-radius: 6px; border-left: 3px solid #8b5cf6; font-size: 12px; }
.ar-comment.severity-high { border-left-color: #f85149; }
.ar-comment.severity-medium { border-left-color: #d29922; }
.ar-comment.severity-low { border-left-color: #2ea043; }
.ar-comment-icon { font-size: 14px; flex-shrink: 0; }
.ar-comment-body { flex: 1; }
.ar-comment-loc { font-size: 10px; color: #666; margin-bottom: 4px; font-family: 'JetBrains Mono', monospace; }
.ar-comment-msg { color: #ccc; line-height: 1.5; }
.ar-comment-suggestion { margin-top: 6px; padding: 6px 8px; background: #111; border-radius: 4px; font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #aaa; white-space: pre-wrap; }
.ar-comment-actions { display: flex; gap: 4px; margin-top: 6px; }
.ar-comment-actions button { font-size: 10px; padding: 2px 8px; border-radius: 3px; border: 1px solid #444; background: #2a2a2a; color: #aaa; cursor: pointer; }
.ar-comment-actions button:hover { background: #333; color: #eee; }
.ar-summary { padding: 8px 12px; font-size: 12px; color: #aaa; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; gap: 8px; }
.ar-score { font-size: 18px; font-weight: 700; }
.ar-score.good { color: #2ea043; }
.ar-score.ok { color: #d29922; }
.ar-score.bad { color: #f85149; }
.ar-loading { padding: 16px; text-align: center; color: #666; font-size: 12px; }
.ar-loading-spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #444; border-top-color: #8b5cf6; border-radius: 50%; animation: ar-spin 0.8s linear infinite; margin-right: 6px; vertical-align: middle; }
@keyframes ar-spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

function init() {
  if (!window.MeshState) { setTimeout(init, 300); return; }

  /* Watch for diff editor being opened */
  const observer = new MutationObserver(() => {
    const diffWrap = document.querySelector('#meshDiffWrap');
    if (diffWrap && !diffWrap.querySelector('.ar-btn')) {
      injectReviewButton(diffWrap);
    }
  });
  const edPane = document.querySelector('#edPane');
  if (edPane) observer.observe(edPane, { childList: true, subtree: true });

  /* Also inject into SCM panel */
  injectSCMReview();
}

function injectReviewButton(diffWrap) {
  const header = diffWrap.querySelector('.diff-header');
  if (!header) return;

  const closeBtn = header.querySelector('#diffCloseBtn');
  const btn = document.createElement('button');
  btn.className = 'ar-btn';
  btn.textContent = '\u2315 Review';
  btn.addEventListener('click', () => reviewCurrentDiff(diffWrap));
  if (closeBtn) header.insertBefore(btn, closeBtn);
  else header.appendChild(btn);
}

function injectSCMReview() {
  const observer = new MutationObserver(() => {
    const scmPanel = document.querySelector('.sb-p[data-panel="scm"]');
    if (scmPanel && !scmPanel.querySelector('.ar-btn')) {
      const header = scmPanel.querySelector('.sb-section-header') || scmPanel.querySelector('h4');
      if (header) {
        const btn = document.createElement('button');
        btn.className = 'ar-btn';
        btn.style.marginLeft = '8px';
        btn.textContent = '\u2315 Review All';
        btn.addEventListener('click', reviewAllChanges);
        header.appendChild(btn);
      }
    }
  });

  const sidebar = document.querySelector('#sidebar');
  if (sidebar) observer.observe(sidebar, { childList: true, subtree: true });
}

async function reviewCurrentDiff(diffWrap) {
  const fileHeader = diffWrap.querySelector('.dh-file');
  if (!fileHeader) return;
  const fileName = fileHeader.textContent.replace('↔', '').trim();

  showLoading(diffWrap);

  try {
    const api = window.MeshAPI;
    if (!api) return;

    const res = await api('/api/assistant/git/diff?path=' + encodeURIComponent(fileName));
    const before = res?.beforeContent || '';
    const after = res?.afterContent || '';

    const review = await getAIReview(fileName, before, after);
    showReview(diffWrap, review);
  } catch (e) {
    window.MeshActions?.toast?.('Review', 'Review failed: ' + e.message);
    removeLoading(diffWrap);
  }
}

async function reviewAllChanges() {
  const api = window.MeshAPI;
  const A = window.MeshActions;
  if (!api || !A) return;

  A.toast('Review', 'Reviewing all changed files...');

  try {
    const res = await api('/api/assistant/git/status');
    const files = res?.files || res?.changed || [];
    if (!files.length) {
      A.toast('Review', 'No changes to review');
      return;
    }

    let allDiffs = '';
    for (const f of files.slice(0, 10)) {
      const path = f.path || f.name || f;
      try {
        const diff = await api('/api/assistant/git/diff?path=' + encodeURIComponent(path));
        allDiffs += `\n--- ${path} ---\nBefore:\n${(diff?.beforeContent || '').slice(0, 2000)}\nAfter:\n${(diff?.afterContent || '').slice(0, 2000)}\n`;
      } catch { /* skip */ }
    }

    const review = await getAIReview('all changes', '', '', allDiffs);

    /* Show in chat */
    let msg = '## AI Code Review\n\n';
    if (review.score !== undefined) {
      msg += `**Score: ${review.score}/10**\n\n`;
    }
    if (review.summary) msg += review.summary + '\n\n';
    for (const c of review.comments || []) {
      const icon = c.severity === 'high' ? '\u25cf' : c.severity === 'medium' ? '\u25cb' : '\u2022';
      msg += `${icon} **${c.location || ''}**: ${c.message}\n`;
      if (c.suggestion) msg += `  > Suggestion: \`${c.suggestion}\`\n`;
      msg += '\n';
    }
    A.appendMsg('assistant', msg);
  } catch (e) {
    A.toast('Review', 'Review failed: ' + e.message);
  }
}

async function getAIReview(fileName, before, after, combinedDiff) {
  const api = window.MeshAPI;
  if (!api) return { comments: [], score: 0, summary: 'No API available' };

  const prompt = combinedDiff
    ? `Review these code changes and provide feedback:\n\n${combinedDiff}`
    : `Review the changes to ${fileName}.\n\nBefore:\n\`\`\`\n${before.slice(0, 3000)}\n\`\`\`\n\nAfter:\n\`\`\`\n${after.slice(0, 3000)}\n\`\`\``;

  const res = await api('/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are a senior code reviewer. Review the code diff and respond with a JSON object:\n```json\n{"score": 8, "summary": "Brief summary", "comments": [{"severity": "high|medium|low", "location": "file:line", "message": "Issue description", "suggestion": "optional fix suggestion"}]}\n```\nBe concise. Focus on bugs, security issues, performance, and best practices. Score from 1-10.' },
        { role: 'user', content: prompt },
      ],
      reviewMode: true,
    }),
  });

  const reply = res?.reply || res?.content || res?.message || '';
  const jsonMatch = reply.match(/```json\s*\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[1]); } catch {}
  }

  return { score: 0, summary: reply.slice(0, 500), comments: [] };
}

function showLoading(container) {
  removeLoading(container);
  const el = document.createElement('div');
  el.className = 'ar-loading';
  el.id = 'arLoading';
  el.innerHTML = '<span class="ar-loading-spinner"></span>AI is reviewing your code...';
  const header = container.querySelector('.diff-header');
  if (header) header.after(el);
}

function removeLoading(container) {
  container.querySelector('#arLoading')?.remove();
}

function showReview(container, review) {
  removeLoading(container);
  container.querySelector('#arComments')?.remove();
  container.querySelector('#arSummary')?.remove();

  const header = container.querySelector('.diff-header');
  if (!header) return;

  /* Summary bar */
  if (review.score !== undefined || review.summary) {
    const summary = document.createElement('div');
    summary.className = 'ar-summary';
    summary.id = 'arSummary';
    const scoreClass = review.score >= 7 ? 'good' : review.score >= 4 ? 'ok' : 'bad';
    summary.innerHTML = `
      ${review.score !== undefined ? '<span class="ar-score ' + scoreClass + '">' + review.score + '/10</span>' : ''}
      <span>${esc(review.summary || '')}</span>
    `;
    header.after(summary);
  }

  /* Comments */
  if (review.comments?.length) {
    const commentsEl = document.createElement('div');
    commentsEl.className = 'ar-comments';
    commentsEl.id = 'arComments';

    for (const c of review.comments) {
      const severity = c.severity || 'low';
      const icon = severity === 'high' ? '\u25cf' : severity === 'medium' ? '\u25cb' : '\u2022';
      const div = document.createElement('div');
      div.className = 'ar-comment severity-' + severity;
      div.innerHTML = `
        <span class="ar-comment-icon">${icon}</span>
        <div class="ar-comment-body">
          ${c.location ? '<div class="ar-comment-loc">' + esc(c.location) + '</div>' : ''}
          <div class="ar-comment-msg">${esc(c.message)}</div>
          ${c.suggestion ? '<div class="ar-comment-suggestion">' + esc(c.suggestion) + '</div>' : ''}
          <div class="ar-comment-actions">
            <button class="ar-fix-btn">Apply Fix</button>
            <button class="ar-dismiss-btn">Dismiss</button>
          </div>
        </div>
      `;

      div.querySelector('.ar-dismiss-btn')?.addEventListener('click', () => div.remove());
      div.querySelector('.ar-fix-btn')?.addEventListener('click', () => {
        if (c.suggestion) {
          const chatIn = document.querySelector('#chatIn');
          if (chatIn) {
            chatIn.value = 'Apply this fix: ' + c.suggestion + (c.location ? ' at ' + c.location : '');
            chatIn.focus();
          }
        }
      });

      commentsEl.appendChild(div);
    }

    const summaryEl = container.querySelector('#arSummary');
    if (summaryEl) summaryEl.after(commentsEl);
    else header.after(commentsEl);
  }
}

function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
})();
