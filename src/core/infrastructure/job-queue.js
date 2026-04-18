'use strict';

/**
 * Workspace select job queue — async job lifecycle, scheduling, and status tracking.
 * References globals injected by core/index.js at boot.
 */

const crypto = require('crypto');
const { meshTunnelRequest } = require('./path-utils');

/** @returns {number} */
function countPendingWorkspaceSelectJobs() {
  let pending = 0;
  for (const jobId of workspaceSelectJobOrder) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === 'queued' || job.status === 'running') pending += 1;
  }
  return pending;
}

/** @returns {void} */
function pruneWorkspaceSelectJobs() {
  const now = Date.now();

  for (const jobId of [...workspaceSelectJobOrder]) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === 'queued' || job.status === 'running') continue;
    if (now - Number(job.createdAtMs || now) <= WORKSPACE_SELECT_JOB_TTL_MS) continue;
    workspaceSelectJobs.delete(jobId);
  }

  for (let i = workspaceSelectJobOrder.length - 1; i >= 0; i -= 1) {
    if (!workspaceSelectJobs.has(workspaceSelectJobOrder[i])) {
      workspaceSelectJobOrder.splice(i, 1);
    }
  }

  while (workspaceSelectJobOrder.length > WORKSPACE_SELECT_MAX_JOB_HISTORY) {
    const oldestId = workspaceSelectJobOrder[0];
    const oldest = workspaceSelectJobs.get(oldestId);
    if (oldest && (oldest.status === 'queued' || oldest.status === 'running')) break;
    workspaceSelectJobOrder.shift();
    workspaceSelectJobs.delete(oldestId);
  }
}

/**
 * @param {object} [payload]
 * @returns {object}
 */
function estimateWorkspaceSelectPayload(payload = {}) {
  const manifest = Array.isArray(payload?.manifest) ? payload.manifest : [];
  const files = Array.isArray(payload?.files) ? payload.files : [];
  const folderName = String(payload?.folderName || 'workspace').trim() || 'workspace';
  const append = Boolean(payload?.append);
  const clear = Boolean(payload?.clear);

  let originalBytesEstimate = 0;
  for (const file of files) {
    if (typeof file?.content === 'string') {
      originalBytesEstimate += Buffer.byteLength(file.content, 'utf8');
      continue;
    }
    if (Number.isFinite(Number(file?.rawStorage?.rawBytes))) {
      originalBytesEstimate += Number(file.rawStorage.rawBytes || 0);
      continue;
    }
    if (Number.isFinite(Number(file?.originalSize))) {
      originalBytesEstimate += Number(file.originalSize || 0);
    }
  }

  const manifestCount = manifest.length;
  const chunkFileCount = files.length;
  const fileCountEstimate = Math.max(manifestCount, chunkFileCount);

  return { folderName, append, clear, manifestCount, chunkFileCount, fileCountEstimate, originalBytesEstimate };
}

/**
 * @param {string} userId
 * @param {object} [payload]
 * @returns {string}
 */
function workspaceSelectScopeKey(userId, payload = {}) {
  const owner = String(userId || 'anon').trim() || 'anon';
  if (payload?.clear) return `${owner}:clear`;
  const folderName = toSafeSlug(payload?.folderName || 'workspace', 'workspace');
  return `${owner}:${folderName}`;
}

/**
 * @param {string} targetJobId
 * @returns {number|null}
 */
function computeWorkspaceSelectQueuePosition(targetJobId) {
  let queuedAhead = 0;
  for (const jobId of workspaceSelectJobOrder) {
    const job = workspaceSelectJobs.get(jobId);
    if (!job) continue;
    if (job.status === 'running') {
      if (jobId === targetJobId) return 0;
      continue;
    }
    if (job.status !== 'queued') continue;
    queuedAhead += 1;
    if (jobId === targetJobId) return queuedAhead;
  }
  return null;
}

/**
 * @param {object} job
 * @returns {object}
 */
function snapshotWorkspaceSelectJob(job) {
  const safeResult = job?.result && typeof job.result === 'object'
    ? {
      ok: job.result.ok !== false,
      mode: String(job.result.mode || ''),
      warning: String(job.result.warning || ''),
      fileCount: Number(job.result.fileCount || 0),
      indexedCount: Number(job.result.indexedCount || 0),
      pendingCount: Number(job.result.pendingCount || 0),
      manifestCount: Number(job.result.manifestCount || 0),
      chunkFileCount: Number(job.result.chunkFileCount || 0),
      originalBytes: Number(job.result.originalBytes || 0),
      compressedBytes: Number(job.result.compressedBytes || 0),
      capsuleBytes: Number(job.result.capsuleBytes || 0),
      transportBytes: Number(job.result.transportBytes || 0),
      ratio: Number.isFinite(Number(job.result.ratio)) ? Number(job.result.ratio) : null,
    }
    : null;

  return {
    id: String(job?.id || ''),
    status: String(job?.status || 'unknown'),
    queuePosition: computeWorkspaceSelectQueuePosition(job?.id),
    mode: String(job?.mode || ''),
    createdAt: String(job?.createdAt || ''),
    startedAt: String(job?.startedAt || ''),
    finishedAt: String(job?.finishedAt || ''),
    updatedAt: String(job?.updatedAt || ''),
    error: String(job?.error || ''),
    summary: {
      folderName: String(job?.summary?.folderName || 'workspace'),
      append: Boolean(job?.summary?.append),
      clear: Boolean(job?.summary?.clear),
      manifestCount: Number(job?.summary?.manifestCount || 0),
      chunkFileCount: Number(job?.summary?.chunkFileCount || 0),
      fileCountEstimate: Number(job?.summary?.fileCountEstimate || 0),
      originalBytesEstimate: Number(job?.summary?.originalBytesEstimate || 0),
    },
    result: safeResult,
  };
}

/**
 * @param {object} job
 * @returns {object}
 */
function buildWorkspaceSelectAcceptedResponse(job) {
  const summary = job?.summary || {};
  const pendingEstimate = Math.max(
    Number(summary.fileCountEstimate || 0),
    Number(summary.chunkFileCount || 0),
    Number(summary.manifestCount || 0),
  );

  return {
    ok: true,
    queued: true,
    asyncMode: WORKSPACE_SELECT_ASYNC_MODE || 'queue',
    jobId: String(job?.id || ''),
    status: String(job?.status || 'queued'),
    mode: 'async-queue',
    folderName: String(summary.folderName || 'workspace'),
    append: Boolean(summary.append),
    cleared: Boolean(summary.clear),
    manifestCount: Number(summary.manifestCount || 0),
    chunkFileCount: Number(summary.chunkFileCount || 0),
    fileCount: Number(summary.fileCountEstimate || 0),
    indexedCount: 0,
    pendingCount: pendingEstimate,
    originalBytes: Number(summary.originalBytesEstimate || 0),
    compressedBytes: 0,
    capsuleBytes: 0,
    transportBytes: 0,
    ratio: null,
    acceptedAt: String(job?.createdAt || toIsoNow()),
  };
}

/**
 * @param {object} [selectPayload]
 * @param {string|null} [requestId]
 * @returns {Promise<object>}
 */
async function executeWorkspaceSelectWithFallback(selectPayload = {}, requestId = null) {
  try {
    return await meshTunnelRequest('workspace.select', selectPayload, requestId);
  } catch (error) {
    const local = await localWorkspaceSelect(selectPayload);
    return {
      ...local,
      warning: `Mesh worker unavailable: ${error.message || 'offline'}`,
    };
  }
}

/**
 * @param {object} [selectPayload]
 * @param {object} [context]
 * @returns {object}
 */
function enqueueWorkspaceSelectJob(selectPayload = {}, context = {}) {
  pruneWorkspaceSelectJobs();

  if (countPendingWorkspaceSelectJobs() >= WORKSPACE_SELECT_MAX_PENDING) {
    throw new Error('Workspace indexing queue is full. Please retry in a moment.');
  }

  const createdAtMs = Date.now();
  const createdAt = new Date(createdAtMs).toISOString();
  const ownerUserId = String(context?.userId || '');
  const summary = estimateWorkspaceSelectPayload(selectPayload);
  const job = {
    id: `wsq_${createdAtMs.toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    status: 'queued',
    mode: '',
    ownerUserId,
    scopeKey: workspaceSelectScopeKey(ownerUserId, selectPayload),
    summary,
    payload: selectPayload,
    createdAtMs,
    createdAt,
    startedAt: '',
    finishedAt: '',
    updatedAt: createdAt,
    error: '',
    result: null,
  };

  workspaceSelectJobs.set(job.id, job);
  workspaceSelectJobOrder.push(job.id);

  const previous = workspaceSelectChains.get(job.scopeKey) || Promise.resolve();
  const current = previous
    .then(async () => {
      job.status = 'running';
      job.startedAt = toIsoNow();
      job.updatedAt = job.startedAt;
      const result = await executeWorkspaceSelectWithFallback(job.payload || {});
      job.result = result;
      job.mode = String(result?.mode || 'mesh-worker');
      job.status = 'completed';
      job.updatedAt = toIsoNow();

    })
    .catch((error) => {
      job.status = 'failed';
      job.error = String(error?.message || 'Workspace queue job failed');
      job.updatedAt = toIsoNow();
    })
    .finally(() => {
      job.finishedAt = toIsoNow();
      job.updatedAt = job.finishedAt;
      job.payload = null;
      pruneWorkspaceSelectJobs();
      if (workspaceSelectChains.get(job.scopeKey) === current) {
        workspaceSelectChains.delete(job.scopeKey);
      }
    });

  workspaceSelectChains.set(job.scopeKey, current);
  return job;
}

/**
 * @param {object} [selectPayload]
 * @returns {boolean}
 */
function shouldQueueWorkspaceSelectPayload(selectPayload = {}) {
  if (!WORKSPACE_SELECT_ASYNC_ENABLED) return false;
  if (Boolean(selectPayload?.clear)) return false;
  if (selectPayload?.sync === true || selectPayload?.async === false) return false;
  const files = Array.isArray(selectPayload?.files) ? selectPayload.files : [];
  const forceAsync = selectPayload?.async === true || String(selectPayload?.mode || '').trim().toLowerCase() === 'async';
  return forceAsync || files.length > 0;
}

/**
 * @param {string} jobId
 * @param {string} userId
 * @returns {object|null}
 */
function getWorkspaceSelectJobForUser(jobId, userId) {
  const job = workspaceSelectJobs.get(String(jobId || ''));
  if (!job) return null;
  const ownerUserId = String(job.ownerUserId || '');
  const requesterUserId = String(userId || '');
  if (ownerUserId && requesterUserId && ownerUserId !== requesterUserId) return null;
  return job;
}

module.exports = {
  countPendingWorkspaceSelectJobs,
  pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload,
  workspaceSelectScopeKey,
  computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob,
  buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback,
  enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload,
  getWorkspaceSelectJobForUser,
};
