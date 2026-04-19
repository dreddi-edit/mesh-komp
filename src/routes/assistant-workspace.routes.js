'use strict';

/**
 * MESH — Workspace REST routes
 *
 * Covers: status, offload ingest, workspace select/open/files/graph/sync/
 * file CRUD/recovery/search/grep/rename/batch/reindex/span/context-budget.
 *
 * @param {object} core  All exports from src/core/index.js
 * @returns {import('express').Router}
 */

const express = require('express');
const logger = require('../logger');
const { safeRouteError, cacheControl } = require('./route-utils');

// Only the offload/ingest endpoint accepts large bodies (workspace file chunks).
const largeJsonBody = express.json({ limit: '200mb' });

function createWorkspaceRouter(core) {
  const {
    requireAuth,
    meshTunnelRequest,
    localAssistantWorkspace,
    normalizeWorkspaceSourceKind,
    workspaceOffloadClientConfig,
    ingestWorkspaceChunkFromOffload,
    shouldQueueWorkspaceSelectPayload,
    enqueueWorkspaceSelectJob,
    buildWorkspaceSelectAcceptedResponse,
    executeWorkspaceSelectWithFallback,
    getWorkspaceSelectJobForUser,
    snapshotWorkspaceSelectJob,
    pruneWorkspaceSelectJobs,
    openLocalWorkspaceWithFallback,
    localWorkspaceFiles,
    localWorkspaceGraph,
    localWorkspaceSave,
    localWorkspaceCreate,
    syncWorkspaceFiles,
    deleteWorkspaceFileWithFallback,
    renameWorkspaceFileWithFallback,
    applyWorkspaceBatchWithFallback,
    grepWorkspaceWithFallback,
    searchWorkspaceWithFallback,
    recoverWorkspaceWithFallback,
    openWorkspaceFileWithFallback,
    isMeshWorkerUnavailableError,
    isLocalPathWorkspaceState,
    escapeRegexLiteral,
    resolveAdaptiveCompressedContextBudget,
  } = core;

  const router = express.Router();

  router.get('/api/assistant/status', requireAuth, async (req, res) => {
    const { workspaceService } = req.app.locals.services;
    try {
      const result = await workspaceService.getStatus(req.requestId);
      res.json(result);
    } catch (error) {
      safeRouteError(res, 503, 'Workspace status unavailable', error);
    }
  });

  router.get('/api/assistant/workspace/offload-config', requireAuth, (_req, res) => {
    res.json(workspaceOffloadClientConfig());
  });

  router.post('/api/assistant/workspace/offload/ingest', requireAuth, largeJsonBody, async (req, res) => {
    try {
      const result = await ingestWorkspaceChunkFromOffload(req.body || {}, {
        userId: req.authUser?.id,
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Offload ingest failed', error);
    }
  });

  router.post('/api/assistant/workspace/select', requireAuth, async (req, res) => {
    const { workspaceService } = req.app.locals.services;
    try {
      const result = await workspaceService.selectWorkspace(req.body || {}, req.authUser?.id, req.requestId);
      const status = result?.accepted ? 202 : 200;
      res.status(status).json(result);
    } catch (error) {
      const isQueueFull = String(error?.message || '').toLowerCase().includes('queue is full');
      logger.error('Workspace select failed', {
        scope: 'assistant-routes',
        error: String(error?.message || error || 'unknown'),
      });
      res.status(isQueueFull ? 429 : 400).json({
        ok: false,
        error: isQueueFull ? 'Workspace select queue is full. Try again later.' : 'Workspace select failed',
      });
    }
  });

  router.post('/api/assistant/workspace/open-local', requireAuth, async (req, res) => {
    try {
      const result = await openLocalWorkspaceWithFallback(String(req.body?.rootPath || ''), {
        folderName: String(req.body?.folderName || ''),
        requestId: req.requestId,
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Open local workspace failed', error);
    }
  });

  router.get('/api/assistant/workspace/jobs/:jobId', requireAuth, (req, res) => {
    pruneWorkspaceSelectJobs();
    const job = getWorkspaceSelectJobForUser(req.params.jobId, req.authUser?.id);
    if (!job) {
      res.status(404).json({ ok: false, error: 'Workspace indexing job not found.' });
      return;
    }
    res.json({ ok: true, job: snapshotWorkspaceSelectJob(job) });
  });

  router.get('/api/assistant/workspace/files', requireAuth, cacheControl(30), async (req, res) => {
    const payload = {
      workspaceId: String(req.query.workspaceId || '').trim(),
      sessionId: String(req.query.sessionId || '').trim(),
      folderName: String(req.query.folderName || '').trim(),
    };
    try {
      const result = await meshTunnelRequest('workspace.files', payload, req.requestId);
      res.json(result);
    } catch (error) {
      const local = await localWorkspaceFiles(payload);
      res.json({ ...local, warning: `Mesh worker unavailable: ${error.message || 'offline'}` });
    }
  });

  router.get('/api/assistant/workspace/graph', requireAuth, cacheControl(30), async (req, res) => {
    const payload = {
      workspaceId: String(req.query.workspaceId || '').trim(),
      sessionId: String(req.query.sessionId || '').trim(),
      folderName: String(req.query.folderName || '').trim(),
    };
    const hasLocalWorkspace = Boolean(
      localAssistantWorkspace.folderName ||
      localAssistantWorkspace.workspaceId ||
      localAssistantWorkspace.rootPath ||
      localAssistantWorkspace.files?.size,
    );
    const localWorkspaceMatchesRequest = Boolean(localAssistantWorkspace.files?.size) && (
      !payload.workspaceId ||
      payload.workspaceId === String(localAssistantWorkspace.workspaceId || '').trim()
    );

    // Browser-opened folders are indexed into the gateway-local workspace state first.
    // The worker often has no matching active workspace for that browser folder, so its
    // graph can be stale, sparse, or from a different workspace entirely. In that case,
    // prefer the active gateway graph immediately instead of trying the worker first.
    if (localWorkspaceMatchesRequest) {
      const local = await localWorkspaceGraph(payload);
      if (local?.ok && (local.hasWorkspace || (Array.isArray(local.nodes) && local.nodes.length > 0))) {
        res.json({ ...local, folderName: localAssistantWorkspace.folderName || null, warning: 'Using active gateway workspace graph.' });
        return;
      }
    }

    try {
      const result = await meshTunnelRequest('workspace.graph', payload, req.requestId);
      if (hasLocalWorkspace) {
        const local = await localWorkspaceGraph(payload);
        const remoteNodeCount = Array.isArray(result?.nodes) ? result.nodes.length : 0;
        const remoteEdgeCount = Array.isArray(result?.edges) ? result.edges.length : 0;
        const localNodeCount = Array.isArray(local?.nodes) ? local.nodes.length : 0;
        const localEdgeCount = Array.isArray(local?.edges) ? local.edges.length : 0;
        const shouldPreferLocalFallback =
          !result?.ok || remoteNodeCount === 0 ||
          localNodeCount > remoteNodeCount || localEdgeCount > remoteEdgeCount;
        if (shouldPreferLocalFallback && local?.ok && (local.hasWorkspace || localNodeCount > 0)) {
          res.json({ ...local, folderName: localAssistantWorkspace.folderName || null, warning: 'Using richer active local workspace graph.' });
          return;
        }
      }
      res.json(result);
    } catch (error) {
      try {
        const local = await localWorkspaceGraph(payload);
        res.json({ ...local, folderName: localAssistantWorkspace.folderName || null, warning: `Mesh worker unavailable: ${error.message || 'offline'}` });
      } catch {
        res.status(500).json({ ok: false, error: 'Mesh worker unavailable.' });
      }
    }
  });

  router.get('/api/assistant/workspace/file', requireAuth, cacheControl(30), async (req, res) => {
    const view = String(req.query.view || 'original');
    try {
      const result = await openWorkspaceFileWithFallback(String(req.query.path || ''), view, {
        workspaceId: String(req.query.workspaceId || '').trim(),
        sessionId: String(req.query.sessionId || '').trim(),
        tier: String(req.query.tier || req.query.capsuleTier || req.query.variant || '').trim(),
        query: String(req.query.q || req.query.query || req.query.focus || ''),
        focus: String(req.query.focus || req.query.q || req.query.query || ''),
        symbolName: String(req.query.symbolName || '').trim(),
        contextLines: Number.isFinite(Number(req.query.contextLines)) ? Number(req.query.contextLines) : 5,
        requestId: req.requestId,
      });
      res.json(result);
    } catch (error) {
      const message = String(error?.message || 'File open failed');
      const statusCode = message.toLowerCase().includes('indexing') ? 409 : 404;
      res.status(statusCode).json({ ok: false, error: message, indexing: statusCode === 409 });
    }
  });

  router.post('/api/assistant/workspace/sync', requireAuth, async (req, res) => {
    try {
      const { workspaceId, folderName, files, deletedPaths, append, mode, scanEpoch, complete } = req.body || {};
      const result = await syncWorkspaceFiles({
        workspaceId, folderName, files, deletedPaths, append, mode, scanEpoch, complete,
        userId: req.authUser?.id || '',
        requestId: req.requestId,
      });
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace sync failed', error);
    }
  });

  // DELETE with body — clears a file from the local in-memory workspace map.
  // Note: this is distinct from the file-system delete handled by deleteWorkspaceFileWithFallback below.
  router.delete('/api/assistant/workspace/file', requireAuth, (req, res) => {
    try {
      const { path } = req.body || {};
      if (path) {
        localAssistantWorkspace.files.delete(path);
        localAssistantWorkspace.fileCountCompleted = localAssistantWorkspace.files.size;
      }
      res.json({ ok: true, count: localAssistantWorkspace.files.size });
    } catch (error) {
      safeRouteError(res, 400, 'Workspace file delete failed', error);
    }
  });

  router.post('/api/assistant/workspace/recovery', requireAuth, async (req, res) => {
    try {
      const result = await meshTunnelRequest('workspace.recovery', {
        spanIds: Array.isArray(req.body?.spanIds) ? req.body.spanIds : [],
        ranges: Array.isArray(req.body?.ranges) ? req.body.ranges : [],
      }, req.requestId);
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace recovery failed', error);
    }
  });

  router.post('/api/assistant/workspace/file', requireAuth, async (req, res) => {
    const filePath = String(req.body?.path || '');
    const content = typeof req.body?.content === 'string' ? req.body.content : String(req.body?.content || '');
    const overwrite = Boolean(req.body?.overwrite);
    const workspaceId = String(req.body?.workspaceId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();

    try {
      const result = await meshTunnelRequest('workspace.file.create', { path: filePath, content, overwrite, workspaceId, sessionId }, req.requestId);
      res.json(result);
    } catch (error) {
      const shouldUseLocalFallback = isMeshWorkerUnavailableError(error) || isLocalPathWorkspaceState();
      if (!shouldUseLocalFallback) {
        safeRouteError(res, 400, 'Create file failed', error);
        return;
      }
      const local = await localWorkspaceCreate(filePath, content, { overwrite, workspaceId, sessionId });
      if (!local.ok) {
        res.status(400).json(local);
        return;
      }
      res.json({ ...local, warning: 'Mesh worker unavailable, used local fallback.' });
    }
  });

  router.put('/api/assistant/workspace/file', requireAuth, async (req, res) => {
    const filePath = String(req.body?.path || '');
    const content = typeof req.body?.content === 'string' ? req.body.content : String(req.body?.content || '');
    const workspaceId = String(req.body?.workspaceId || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();

    try {
      const result = await meshTunnelRequest('workspace.file.save', { path: filePath, content, workspaceId, sessionId }, req.requestId);
      res.json(result);
    } catch (error) {
      const shouldUseLocalFallback = isMeshWorkerUnavailableError(error) || isLocalPathWorkspaceState();
      if (!shouldUseLocalFallback) {
        safeRouteError(res, 400, 'Save file failed', error);
        return;
      }
      const local = await localWorkspaceSave(filePath, content, { workspaceId, sessionId });
      if (!local.ok) {
        res.status(400).json(local);
        return;
      }
      res.json({ ...local, warning: 'Mesh worker unavailable, used local fallback.' });
    }
  });

  router.post('/api/assistant/workspace/purge', requireAuth, async (req, res) => {
    try {
      const result = await meshTunnelRequest('workspace.purge', {
        workspaceId: String(req.body.workspaceId || '').trim(),
        sessionId: String(req.body.sessionId || '').trim(),
      }, req.requestId);
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Purge failed', error);
    }
  });

  router.delete('/api/assistant/workspace/file', requireAuth, async (req, res) => {
    try {
      const result = await meshTunnelRequest('workspace.file.delete', {
        workspaceId: String(req.query.workspaceId || '').trim(),
        sessionId: String(req.query.sessionId || '').trim(),
      }, req.requestId);
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Delete file failed', error);
    }
  });

  router.get('/api/assistant/workspace/search', requireAuth, async (req, res) => {
    try {
      const result = await meshTunnelRequest('workspace.search', {
        scope: String(req.query.scope || 'all'),
        limit: Math.min(Number(req.query.limit) || 12, 200),
      }, req.requestId);
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace search failed', error);
    }
  });

  router.post('/api/assistant/workspace/grep', requireAuth, async (req, res) => {
    try {
      const result = await meshTunnelRequest('workspace.grep', {
        limit: Math.min(Number(req.body?.limit) || 40, 500),
        caseSensitive: req.body?.caseSensitive === true,
      }, req.requestId);
      if (result.ok === false) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace grep failed', error);
    }
  });

  router.post('/api/assistant/workspace/rename', requireAuth, async (req, res) => {
    try {
      const result = await renameWorkspaceFileWithFallback(
        String(req.body?.fromPath || ''),
        String(req.body?.toPath || ''),
        {
          overwrite: Boolean(req.body?.overwrite),
          workspaceId: String(req.body?.workspaceId || '').trim(),
          sessionId: String(req.body?.sessionId || '').trim(),
          requestId: req.requestId,
        },
      );
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace rename failed', error);
    }
  });

  router.post('/api/assistant/workspace/batch', requireAuth, async (req, res) => {
    try {
      const result = await applyWorkspaceBatchWithFallback(req.body?.operations || [], {
        stopOnError: req.body?.stopOnError !== false,
        requestId: req.requestId,
      });
      if (result.ok === false) {
        res.status(400).json(result);
        return;
      }
      res.json(result);
    } catch (error) {
      safeRouteError(res, 400, 'Workspace batch failed', error);
    }
  });

  router.post('/api/assistant/workspace/reindex', requireAuth, async (req, res) => {
    try {
      const { files } = req.body || {};
      const result = await meshTunnelRequest('reindex', { files }, req.requestId);
      res.json({ ok: true, ...result });
    } catch (error) {
      if (localAssistantWorkspace.rootPath) {
        res.json({ ok: true, message: 'Reindex queued (local mode)' });
      } else {
        safeRouteError(res, 400, 'Reindex failed', error);
      }
    }
  });

  router.get('/api/assistant/workspace/span', requireAuth, async (req, res) => {
    try {
      const spanId = String(req.query.id || '');
      if (!spanId) {
        res.status(400).json({ ok: false, error: 'Missing span ID' });
        return;
      }
      const files = localAssistantWorkspace.files;
      if (files && files.size > 0) {
        for (const [filePath, fileData] of files) {
          const capsule = fileData?.capsuleBase || fileData?.compressedContent || '';
          if (capsule.includes(spanId)) {
            const spanMatch = capsule.match(new RegExp(escapeRegexLiteral(spanId) + '[^\\n]*?(?:L|line|:)(\\d+)'));
            const line = spanMatch ? parseInt(spanMatch[1]) : 1;
            res.json({
              ok: true,
              file: filePath,
              line,
              symbol: spanId,
              kind: 'symbol',
              preview: capsule.slice(Math.max(0, capsule.indexOf(spanId) - 100), capsule.indexOf(spanId) + 200),
            });
            return;
          }
        }
      }
      res.json({ ok: false, error: 'Span not found' });
    } catch (error) {
      safeRouteError(res, 400, 'Span lookup failed', error);
    }
  });

  router.get('/api/assistant/workspace/context-budget', requireAuth, async (_req, res) => {
    try {
      const files = [];
      if (localAssistantWorkspace.files && localAssistantWorkspace.files.size > 0) {
        for (const [filePath, fileData] of localAssistantWorkspace.files) {
          const capsuleSize = fileData?.capsuleBase ? Buffer.byteLength(fileData.capsuleBase, 'utf8') : 0;
          files.push({ path: filePath, tokens: Math.ceil(capsuleSize / 4), capsuleSize });
        }
        files.sort((a, b) => b.tokens - a.tokens);
      }
      const totalCapsuleTokens = files.reduce((sum, f) => sum + f.tokens, 0);
      res.json({
        ok: true,
        maxTokens: 200000,
        capsuleTokens: totalCapsuleTokens,
        systemTokens: 2000,
        chatTokens: 0,
        files: files.slice(0, 20),
      });
    } catch (error) {
      safeRouteError(res, 400, 'Context budget failed', error);
    }
  });

  return router;
}

module.exports = { createWorkspaceRouter };
