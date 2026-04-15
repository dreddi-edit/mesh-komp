/* Mesh — Git SCM Panel
 * Extracted from app-workspace.js. Reads state from window.MeshState,
 * API calls via window.MeshAPI, UI helpers via window.MeshActions.
 * Loaded after app-workspace.js so MeshState/MeshAPI/MeshActions are available.
 */
(function () {
  'use strict';

  const getS    = () => window.MeshState;
  const getApi  = () => window.MeshAPI;
  const getAct  = () => window.MeshActions;
  const $       = (sel, root) => (root || document).querySelector(sel);

  /* ─── Status fetch ─── */
  async function refreshGitStatus() {
    const S = getS();
    if (!S?.dirHandle) return;
    const emptyGit = { branch: '', staged: [], unstaged: [], untracked: [], ahead: 0, behind: 0, noRepo: true };
    try {
      const res = await getApi()('/api/assistant/git/status');
      S.git = res.ok
        ? { branch: res.branch || 'main', staged: res.staged || [], unstaged: res.unstaged || [], untracked: res.untracked || [], ahead: res.ahead || 0, behind: res.behind || 0 }
        : emptyGit;
    } catch {
      if (S) S.git = emptyGit;
    }
    updateSCM();
  }

  /* ─── SCM UI render ─── */
  function updateSCM() {
    const S = getS();
    if (!S) return;
    const cl = $('#chgList');
    if (!cl) return;
    cl.textContent = '';

    const bName = $('#branchName');
    if (bName) bName.textContent = S.git.branch || 'no branch';

    const initPanel = $('#scmInit');
    const branchRow = document.querySelector('.scm-branch');
    const commitRow = document.querySelector('.scm-row');
    const actRow    = document.querySelector('.scm-acts');
    const secRow    = document.querySelector('.scm-sec');

    if (S.git.noRepo) {
      if (initPanel) initPanel.style.display = 'flex';
      if (branchRow) branchRow.style.display = 'none';
      if (commitRow) commitRow.style.display = 'none';
      if (actRow)    actRow.style.display    = 'none';
      if (secRow)    secRow.style.display    = 'none';
      const cc = $('#chgCnt');
      if (cc) cc.textContent = '0';
      const badge = $('#scmBadge');
      if (badge) badge.style.display = 'none';
      return;
    }

    if (initPanel) initPanel.style.display = 'none';
    if (branchRow) branchRow.style.display = 'flex';
    if (commitRow) commitRow.style.display = 'flex';
    if (actRow)    actRow.style.display    = 'flex';
    if (secRow)    secRow.style.display    = 'block';

    const total = S.git.staged.length + S.git.unstaged.length + S.git.untracked.length;
    const cc = $('#chgCnt');
    if (cc) cc.textContent = String(total);
    const badge = $('#scmBadge');
    if (badge) {
      badge.textContent = String(total);
      badge.style.display = total > 0 ? 'flex' : 'none';
    }

    const fIconFn = getAct()?.fIcon || (() => '');

    const sections = [
      { label: 'Staged Changes', items: S.git.staged,   type: 'staged',   icon: 'S' },
      { label: 'Changes',        items: S.git.unstaged,  type: 'unstaged', icon: 'M' },
      { label: 'Untracked',      items: S.git.untracked.map((f) => ({ file: f })), type: 'untracked', icon: 'U' },
    ];

    sections.forEach((sec) => {
      if (sec.items.length === 0) return;
      const hdr = document.createElement('div');
      hdr.className = 'scm-sec-h';
      hdr.textContent = sec.label + ' (' + sec.items.length + ')';
      cl.appendChild(hdr);

      sec.items.forEach((item) => {
        const filePath = String(item.file || item);
        const fileName = filePath.split('/').pop();

        const el = document.createElement('div');
        el.className = 'scm-fi';

        // Icon span — fIcon returns SVG markup from the internal icon registry, not user content
        const iconSpan = document.createElement('span');
        iconSpan.className = 'fi-i';
        iconSpan.innerHTML = fIconFn(fileName, false); // safe: icon registry output only

        const nameSpan = document.createElement('span');
        nameSpan.className = 'scm-fn';
        nameSpan.textContent = fileName; // textContent: no XSS possible

        const statusCode = String(item.status || sec.icon);
        const statusSpan = document.createElement('span');
        statusSpan.className = 'scm-s ' + statusCode;
        statusSpan.textContent = statusCode; // textContent: safe

        el.appendChild(iconSpan);
        el.appendChild(nameSpan);
        el.appendChild(statusSpan);

        const actions = document.createElement('div');
        actions.className = 'scm-fi-acts';
        const btn = document.createElement('button');
        btn.className = 'sca-i';
        if (sec.type === 'staged') {
          btn.title = 'Unstage';
          btn.textContent = '-(V)';
          btn.onclick = () => gitUnstage(filePath);
        } else {
          btn.title = 'Stage';
          btn.textContent = '+(V)';
          btn.onclick = () => gitStage(filePath);
        }
        actions.appendChild(btn);
        el.appendChild(actions);
        cl.appendChild(el);
      });
    });
  }

  /* ─── Git operations ─── */
  async function gitStage(path) {
    const t = getAct()?.toast;
    try {
      await getApi()('/api/assistant/git/stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [path] }) });
      t && t('Staged', path);
      await refreshGitStatus();
    } catch (e) { t && t('Error', e.message); }
  }

  async function gitUnstage(path) {
    const t = getAct()?.toast;
    try {
      await getApi()('/api/assistant/git/unstage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files: [path] }) });
      t && t('Unstaged', path);
      await refreshGitStatus();
    } catch (e) { t && t('Error', e.message); }
  }

  async function gitCommit() {
    const t = getAct()?.toast;
    const m = $('#commitMsg')?.value || '';
    if (!m) { t && t('Error', 'Message required'); return; }
    try {
      const res = await getApi()('/api/assistant/git/commit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: m }) });
      if (res.ok) {
        t && t('Committed', m);
        const msgEl = $('#commitMsg');
        if (msgEl) msgEl.value = '';
        await refreshGitStatus();
        const S = getS();
        if (S?.term) S.term.writeln('\x1b[32m✔ Git Commit successful: ' + m + '\x1b[0m');
      }
    } catch (e) { t && t('Error', e.message); }
  }

  async function gitPull() {
    const t = getAct()?.toast;
    try {
      t && t('Git Pull', 'Updating...');
      const res = await getApi()('/api/assistant/git/pull', { method: 'POST' });
      if (res.ok) {
        t && t('Updated', 'Git pull completed.');
        await refreshGitStatus();
        const S = getS();
        if (S?.term) S.term.writeln('\x1b[34m● git pull\x1b[0m\r\n' + (res.output || 'Already up to date.'));
      }
    } catch (e) { t && t('Error', e.message); }
  }

  async function gitPush() {
    const t = getAct()?.toast;
    try {
      t && t('Git Push', 'Syncing...');
      const res = await getApi()('/api/assistant/git/push', { method: 'POST' });
      if (res.ok) {
        t && t('Pushed', 'Git push completed.');
        await refreshGitStatus();
        const S = getS();
        if (S?.term) S.term.writeln('\x1b[34m● git push\x1b[0m\r\n' + (res.output || 'Sync successful.'));
      }
    } catch (e) { t && t('Error', e.message); }
  }

  async function gitInit() {
    const t = getAct()?.toast;
    try {
      t && t('Git Init', 'Initializing...');
      const res = await getApi()('/api/assistant/git/init', { method: 'POST' });
      if (res.ok) {
        t && t('Initialized', 'Repository created successfully.');
        await refreshGitStatus();
        const S = getS();
        if (S?.term) S.term.writeln('\x1b[32m✔ Git repository initialized.\x1b[0m');
      }
    } catch (e) { t && t('Error', e.message); }
  }

  /* ─── Wire button listeners ─── */
  function bindGitButtons() {
    $('#btnCommit')?.addEventListener('click', gitCommit);
    $('#btnPull')?.addEventListener('click', gitPull);
    $('#btnPush')?.addEventListener('click', gitPush);
    $('#btnGitInit')?.addEventListener('click', gitInit);
  }

  /* ─── Expose via window.MeshGit + patch MeshActions ─── */
  function attach() {
    window.MeshGit = { refreshGitStatus, updateSCM, gitCommit, gitPull, gitPush, gitInit, gitStage, gitUnstage };
    if (window.MeshActions) {
      Object.assign(window.MeshActions, window.MeshGit);
    }
    bindGitButtons();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    // DOMContentLoaded already fired — defer one tick so app-workspace.js MeshActions is populated
    setTimeout(attach, 0);
  }
})();
