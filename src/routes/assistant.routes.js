'use strict';

/**
 * MESH — Assistant Router (composer)
 *
 * Mounts all assistant sub-routers and owns the terminal session REST API
 * and assistant run API (these are small and not worth splitting further).
 *
 * Sub-routers:
 *   - assistant-workspace.routes.js  — workspace CRUD, select, graph, etc.
 *   - assistant-git.routes.js        — git operations
 *   - assistant-chat.routes.js       — chat, streaming, codec, inline-complete
 *
 * @param {object} core  All exports from src/core/index.js
 * @returns {import('express').Router}
 */

const path = require('path');
const fs = require('fs');
const express = require('express');
const logger = require('../logger');
const { safeRouteError } = require('./route-utils');
const { createWorkspaceRouter } = require('./assistant-workspace.routes');
const { createGitRouter } = require('./assistant-git.routes');
const { createChatRouter } = require('./assistant-chat.routes');

/** Allowlist pattern for Open VSX publisher/extension identifiers and semver-like versions. */
const EXT_IDENTIFIER_RE = /^[a-zA-Z0-9_.-]+$/;

/**
 * @param {object} core  All exports from src/core/index.js
 * @returns {import('express').Router}
 */
function createAssistantRouter(core) {
  const {
    requireAuth,
    createAssistantTerminalSession,
    destroyAssistantTerminalSession,
    listAssistantTerminalOutput,
    writeAssistantTerminalInput,
    createAssistantRun,
    assistantRunSnapshot,
    applyAssistantRunDecision,
    assistantRuns,
    mergeChatCredentials,
    getStoredCredentialsForUser,
  } = core;

  const router = express.Router();

  // Mount sub-routers — each owns a specific domain of routes.
  router.use(createWorkspaceRouter(core));
  router.use(createGitRouter(core));
  router.use(createChatRouter(core));

  // ── Terminal session REST API ──────────────────────────────────────────────

  router.post('/api/assistant/terminal/session', requireAuth, (req, res) => {
    try {
      const created = createAssistantTerminalSession({ shell: req.body?.shell });
      res.status(201).json(created);
    } catch (error) {
      safeRouteError(res, 400, 'Terminal session failed', error);
    }
  });

  router.get('/api/assistant/terminal/session/:id/output', requireAuth, (req, res) => {
    try {
      const payload = listAssistantTerminalOutput(req.params.id, req.query.since);
      res.json(payload);
    } catch (error) {
      safeRouteError(res, 404, 'Terminal session not found', error);
    }
  });

  router.post('/api/assistant/terminal/session/:id/input', requireAuth, (req, res) => {
    try {
      const payload = writeAssistantTerminalInput(req.params.id, req.body?.input);
      res.json(payload);
    } catch (error) {
      safeRouteError(res, 400, 'Terminal input failed', error);
    }
  });

  router.delete('/api/assistant/terminal/session/:id', requireAuth, (req, res) => {
    try {
      const payload = destroyAssistantTerminalSession(req.params.id);
      res.json(payload);
    } catch (error) {
      safeRouteError(res, 400, 'Terminal close failed', error);
    }
  });

  // ── Assistant runs ─────────────────────────────────────────────────────────

  router.post('/api/assistant/runs', requireAuth, async (req, res) => {
    const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
    const resolvedCredentials = mergeChatCredentials(storedCredentials);

    try {
      const run = await createAssistantRun({
        model: String(req.body?.model || 'claude-sonnet-4-6'),
        mode: req.body?.mode,
        autonomyMode: req.body?.autonomyMode,
        prompt: req.body?.prompt,
        workspaceFolderName: req.body?.workspaceFolderName,
        activeFilePath: req.body?.activeFilePath,
        selectedPaths: Array.isArray(req.body?.selectedPaths) ? req.body.selectedPaths : [],
        terminalSessionId: req.body?.terminalSessionId,
        opsSelection: req.body?.opsSelection || {},
        chatSessionId: req.body?.chatSessionId,
      }, resolvedCredentials);

      res.status(201).json({
        ok: true,
        run: assistantRunSnapshot(run),
        reply: run.reply,
        actions: run.actions,
        artifacts: run.artifacts,
        usage: run.plannerUsage,
      });
    } catch (error) {
      safeRouteError(res, 400, 'Assistant run failed', error);
    }
  });

  router.get('/api/assistant/runs/:runId', requireAuth, (req, res) => {
    const run = assistantRuns.get(String(req.params.runId || ''));
    if (!run) {
      res.status(404).json({ ok: false, error: 'Run not found.' });
      return;
    }
    res.json({ ok: true, run: assistantRunSnapshot(run) });
  });

  router.post('/api/assistant/runs/:runId/actions/:actionId', requireAuth, async (req, res) => {
    const run = assistantRuns.get(String(req.params.runId || ''));
    if (!run) {
      res.status(404).json({ ok: false, error: 'Run not found.' });
      return;
    }

    const action = run.actions.find((entry) => entry.id === String(req.params.actionId || ''));
    if (!action) {
      res.status(404).json({ ok: false, error: 'Action not found.' });
      return;
    }

    const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
    const resolvedCredentials = mergeChatCredentials(storedCredentials);

    try {
      await applyAssistantRunDecision(run, action, req.body?.decision || req.body?.action, resolvedCredentials);
      res.json({
        ok: true,
        run: assistantRunSnapshot(run),
        reply: run.reply,
        actions: run.actions,
        artifacts: run.artifacts,
      });
    } catch (error) {
      safeRouteError(res, 400, 'Run action failed', error);
    }
  });

  // ── Extensions ─────────────────────────────────────────────────────────────

  router.post('/api/assistant/extensions/install', requireAuth, async (req, res) => {
    const { publisher, name, version = 'latest' } = req.body;
    if (!publisher || !name) {
      res.status(400).json({ error: 'Missing publisher/name' });
      return;
    }
    if (!EXT_IDENTIFIER_RE.test(publisher) || !EXT_IDENTIFIER_RE.test(name) || !EXT_IDENTIFIER_RE.test(version)) {
      res.status(400).json({ error: 'Invalid publisher, name, or version format' });
      return;
    }

    const extensionsDir = path.resolve(__dirname, '../../extensions');
    if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

    const extId = `${publisher}.${name}`;
    const extPath = path.join(extensionsDir, extId);
    const zipPath = path.join(extensionsDir, `${extId}.vsix`);

    // Open VSX Direct Download URL
    const downloadUrl = `https://open-vsx.org/api/${publisher}/${name}/${version}/file/${extId}-${version}.vsix`;

    try {
      const { execFile } = require('child_process');
      const { promisify } = require('util');
      const execFileAsync = promisify(execFile);

      // Download via built-in fetch — no shell involved
      const response = await fetch(downloadUrl, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`);
      fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));

      // Extract via execFile — args passed as array, never interpolated into a shell string
      if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });
      await execFileAsync('unzip', ['-o', zipPath, '-d', extPath]);

      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

      res.json({ ok: true, message: `Extension ${extId} installed successfully.` });
    } catch (e) {
      if (fs.existsSync(zipPath)) {
        try { fs.unlinkSync(zipPath); } catch { /* best-effort cleanup */ }
      }
      logger.error('Install extension failed', { scope: 'assistant-routes', error: String(e?.message || e) });
      res.status(500).json({ error: 'Installation failed. Ensure the extension exists on Open VSX.' });
    }
  });

  return router;
}

module.exports = { createAssistantRouter };
