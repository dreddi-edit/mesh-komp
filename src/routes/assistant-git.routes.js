'use strict';

/**
 * MESH — Git REST routes
 *
 * Covers: status, branches, checkout, stage/unstage, commit, push, pull,
 * diff, log, stash, clone, init, create-branch, delete-branch.
 *
 * @param {object} core  All exports from src/core/index.js
 * @returns {import('express').Router}
 */

const path = require('path');
const express = require('express');
const { safeRouteError, cacheControl } = require('./route-utils');
const { validate } = require('../middleware/validate');
const {
  gitCheckoutSchema,
  gitStageSchema,
  gitCommitSchema,
  gitStashSchema,
  gitCloneSchema,
  gitCreateBranchSchema,
  gitDeleteBranchSchema,
} = require('../schemas');

/** Validates git remote URL protocols. Allows https, git, and ssh — rejects local paths. */
const SAFE_GIT_URL_PATTERN = /^(https?:\/\/|git:\/\/|ssh:\/\/|git@[\w.\-]+:)/;

function createGitRouter(core) {
  const {
    requireAuth,
    runGitWithFallback,
    runLocalGit,
    localGitStatus,
    gitPathFromWorkspacePath,
    workspacePathFromGitPath,
    resolveLocalWorkspaceAbsolutePath,
    readLocalWorkspaceFileText,
    getLocalGitCwd,
    isLocalPathWorkspaceState,
  } = core;

  const router = express.Router();

  router.get('/api/assistant/git/status', requireAuth, cacheControl(10), async (_req, res) => {
    try {
      const result = await runGitWithFallback('git.status', { requestId: req.requestId }, () => localGitStatus());
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git status failed', error);
    }
  });

  router.get('/api/assistant/git/branches', requireAuth, cacheControl(10), async (_req, res) => {
    try {
      const result = await runGitWithFallback('git.branches', { requestId: req.requestId }, async () => {
        const raw = (await runLocalGit(['branch', '-a', '--format=%(refname:short)\t%(HEAD)'])).stdout;
        const branches = [];
        let current = '';
        for (const line of (raw ? raw.split('\n') : [])) {
          const [name, head] = line.split('\t');
          if (!name) continue;
          branches.push(name);
          if (head === '*') current = name;
        }
        if (!current) {
          try {
            current = (await runLocalGit(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout;
          } catch {
            current = '';
          }
        }
        return { ok: true, branches, current };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git branches failed', error);
    }
  });

  router.post('/api/assistant/git/checkout', requireAuth, validate(gitCheckoutSchema), async (req, res) => {
    try {
      const branch = req.body.branch;
      const result = await runGitWithFallback('git.checkout', { branch, requestId: req.requestId }, async () => {
        await runLocalGit(['checkout', branch]);
        return { ok: true, branch };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git checkout failed', error);
    }
  });

  router.post('/api/assistant/git/stage', requireAuth, validate(gitStageSchema), async (req, res) => {
    try {
      const files = req.body.files;
      const result = await runGitWithFallback('git.stage', { files, requestId: req.requestId }, async () => {
        const normalized = files.length ? files.map((f) => gitPathFromWorkspacePath(f)).filter(Boolean) : ['.'];
        await runLocalGit(['add', ...normalized]);
        return { ok: true };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git stage failed', error);
    }
  });

  router.post('/api/assistant/git/unstage', requireAuth, validate(gitStageSchema), async (req, res) => {
    try {
      const files = req.body.files;
      const result = await runGitWithFallback('git.unstage', { files, requestId: req.requestId }, async () => {
        const normalized = files.length ? files.map((f) => gitPathFromWorkspacePath(f)).filter(Boolean) : ['.'];
        await runLocalGit(['reset', 'HEAD', '--', ...normalized]);
        return { ok: true };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git unstage failed', error);
    }
  });

  router.post('/api/assistant/git/commit', requireAuth, validate(gitCommitSchema), async (req, res) => {
    try {
      const { message, files } = req.body;
      const result = await runGitWithFallback('git.commit', { message, files, requestId: req.requestId }, async () => {
        if (files.length) {
          const normalized = files.map((f) => gitPathFromWorkspacePath(f)).filter(Boolean);
          if (normalized.length) await runLocalGit(['add', ...normalized]);
        }
        const committed = await runLocalGit(['commit', '-m', message]);
        return { ok: true, output: committed.stdout || committed.stderr };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git commit failed', error);
    }
  });

  router.post('/api/assistant/git/push', requireAuth, async (_req, res) => {
    try {
      const result = await runGitWithFallback('git.push', { requestId: req.requestId }, async () => {
        const pushed = await runLocalGit(['push']);
        return { ok: true, output: pushed.stdout || pushed.stderr };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git push failed', error);
    }
  });

  router.post('/api/assistant/git/pull', requireAuth, async (_req, res) => {
    try {
      const result = await runGitWithFallback('git.pull', { requestId: req.requestId }, async () => {
        const pulled = await runLocalGit(['pull']);
        return { ok: true, output: pulled.stdout || pulled.stderr };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git pull failed', error);
    }
  });

  router.get('/api/assistant/git/diff', requireAuth, cacheControl(10), async (req, res) => {
    try {
      const filePath = String(req.query.path || '');
      const result = await runGitWithFallback('git.diff', { path: filePath, requestId: req.requestId }, async () => {
        const normalized = gitPathFromWorkspacePath(filePath);
        const diffArgs = ['diff'];
        const stagedArgs = ['diff', '--cached'];
        if (normalized) {
          diffArgs.push('--', normalized);
          stagedArgs.push('--', normalized);
        }
        const diff = await runLocalGit(diffArgs);
        const staged = await runLocalGit(stagedArgs);
        let beforeContent = '';
        let afterContent = '';
        if (normalized) {
          try {
            beforeContent = (await runLocalGit(['show', `HEAD:${normalized}`])).stdout;
          } catch {
            beforeContent = '';
          }
          try {
            const workspacePath = workspacePathFromGitPath(normalized) || String(filePath || '').trim();
            if (workspacePath) {
              const target = resolveLocalWorkspaceAbsolutePath(workspacePath);
              afterContent = await readLocalWorkspaceFileText(target.absolutePath);
            }
          } catch {
            afterContent = '';
          }
        }
        return { ok: true, diff: diff.stdout, stagedDiff: staged.stdout, beforeContent, afterContent };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git diff failed', error);
    }
  });

  router.get('/api/assistant/git/log', requireAuth, cacheControl(10), async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const result = await runGitWithFallback('git.log', { limit, requestId: req.requestId }, async () => {
        const raw = await runLocalGit(['log', `--max-count=${limit}`, '--format=%H\t%an\t%ae\t%aI\t%s']);
        const commits = (raw.stdout ? raw.stdout.split('\n') : []).filter(Boolean).map((line) => {
          const [hash, author, email, date, ...messageParts] = line.split('\t');
          return { hash, author, email, date, message: messageParts.join('\t') };
        });
        return { ok: true, commits };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git log failed', error);
    }
  });

  router.post('/api/assistant/git/stash', requireAuth, validate(gitStashSchema), async (req, res) => {
    try {
      const { action, message } = req.body;
      const result = await runGitWithFallback('git.stash', { action, message, requestId: req.requestId }, async () => {
        if (action === 'list') {
          const listed = await runLocalGit(['stash', 'list']);
          return { ok: true, stashes: listed.stdout ? listed.stdout.split('\n') : [] };
        }
        if (action === 'pop') {
          const popped = await runLocalGit(['stash', 'pop']);
          return { ok: true, output: popped.stdout || popped.stderr };
        }
        const pushed = await runLocalGit(['stash', 'push', '-m', message]);
        return { ok: true, output: pushed.stdout || pushed.stderr };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git stash failed', error);
    }
  });

  router.post('/api/assistant/git/clone', requireAuth, validate(gitCloneSchema), async (req, res) => {
    try {
      const url = req.body.url;
      const targetPath = req.body.path;
      if (!SAFE_GIT_URL_PATTERN.test(url)) {
        res.status(400).json({ ok: false, error: 'Invalid repository URL. Must use https, git, or ssh protocol.' });
        return;
      }
      const result = await runGitWithFallback('git.clone', { url, path: targetPath, requestId: req.requestId }, async () => {
        if (!targetPath && !isLocalPathWorkspaceState()) {
          return { ok: false, error: 'Target path required when no local workspace root is configured.' };
        }
        const workspaceParent = path.dirname(getLocalGitCwd());
        const fallbackName = url.split('/').pop()?.replace(/\.git$/i, '') || 'repo';
        const resolvedTarget = targetPath
          ? path.resolve(workspaceParent, targetPath)
          : path.resolve(workspaceParent, fallbackName);
        if (resolvedTarget !== workspaceParent && !resolvedTarget.startsWith(workspaceParent + path.sep)) {
          return { ok: false, error: 'Target path must be within the workspace directory.' };
        }
        await require('fs').promises.mkdir(path.dirname(resolvedTarget), { recursive: true });
        const cloned = await runLocalGit(['clone', url, resolvedTarget], path.dirname(resolvedTarget));
        return {
          ok: true,
          path: resolvedTarget,
          folderName: path.basename(resolvedTarget),
          output: cloned.stderr || cloned.stdout,
        };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git clone failed', error);
    }
  });

  router.post('/api/assistant/git/init', requireAuth, async (_req, res) => {
    try {
      const result = await runGitWithFallback('git.init', { requestId: req.requestId }, async () => {
        const initialized = await runLocalGit(['init']);
        return { ok: true, output: initialized.stdout || initialized.stderr };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git init failed', error);
    }
  });

  router.post('/api/assistant/git/create-branch', requireAuth, validate(gitCreateBranchSchema), async (req, res) => {
    try {
      const { name, startPoint } = req.body;
      const result = await runGitWithFallback('git.create-branch', { name, startPoint, requestId: req.requestId }, async () => {
        const args = ['checkout', '-b', name];
        if (startPoint) args.push(startPoint);
        await runLocalGit(args);
        return { ok: true, branch: name };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git create branch failed', error);
    }
  });

  router.post('/api/assistant/git/delete-branch', requireAuth, validate(gitDeleteBranchSchema), async (req, res) => {
    try {
      const name = req.body.name;
      const result = await runGitWithFallback('git.delete-branch', { name, requestId: req.requestId }, async () => {
        await runLocalGit(['branch', '-d', name]);
        return { ok: true };
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Git delete branch failed', error);
    }
  });

  return router;
}

module.exports = { createGitRouter };
