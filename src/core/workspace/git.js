'use strict';

/**
 * Workspace git operations.
 * Uses runLocalGit and workspacePathFromGitPath injected as globals by core/index.js.
 */

/**
 * @returns {Promise<{ ok: boolean, branch: string, staged: object[], unstaged: object[], untracked: string[], ahead: number, behind: number }>}
 */
async function localGitStatus() {
  const branch = (await runLocalGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
  const statusRaw = (await runLocalGit(['status', '--porcelain=v1'])).stdout;
  const lines = statusRaw ? statusRaw.split('\n') : [];
  const staged = [];
  const unstaged = [];
  const untracked = [];

  for (const line of lines) {
    const x = line[0];
    const y = line[1];
    const file = workspacePathFromGitPath(line.slice(3).split(' -> ').pop());
    if (!file) continue;

    if (x === '?' && y === '?') {
      untracked.push(file);
      continue;
    }
    if (x !== ' ' && x !== '?') staged.push({ file, status: x });
    if (y !== ' ' && y !== '?') unstaged.push({ file, status: y });
  }

  let ahead = 0;
  let behind = 0;
  try {
    const counts = (await runLocalGit(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'])).stdout;
    const parts = counts.split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  } catch {
    // Upstream not configured.
  }

  return { ok: true, branch, staged, unstaged, untracked, ahead, behind };
}

module.exports = { localGitStatus };
