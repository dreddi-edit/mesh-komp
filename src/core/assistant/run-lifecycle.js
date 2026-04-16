'use strict';

/**
 * Assistant run lifecycle — execute, summarize, continue, create, and decide.
 * Uses globals injected by core/index.js at boot.
 */

const {
  touchRunEntity,
  createAssistantRunRecord,
  cloneJsonValue,
} = require('./run-model');
const {
  generateAssistantWriteBatch,
  resolveRunBatch,
  resolveRunProposal,
  syncBatchStatusFromProposals,
  ensureApplyBatchActionForRun,
  ensureApplyProposalActionsForBatch,
  buildProposalDiff,
  computeProposalLineDelta,
} = require('./run-proposals');
const { planAssistantRun } = require('./run-planner');

/**
 * @param {object} action
 * @returns {string}
 */
function buildActionResultSummary(action) {
  if (action.status === 'failed') return `${action.title}: failed (${action.error || 'unknown error'})`;
  if (action.status === 'rejected') return `${action.title}: rejected`;
  if (action.status === 'requires_approval') return `${action.title}: awaiting approval`;
  if (action.type === 'search_workspace') {
    return `${action.title}: ${Number(action.result?.total || action.result?.matches?.length || 0)} matches`;
  }
  if (action.type === 'read_file' || action.type === 'read_capsule' || action.type === 'open_file') {
    return `${action.title}: ${String(action.result?.path || action.payload?.path || '')}`;
  }
  if (action.type === 'recover_spans') return `${action.title}: ${Number(action.result?.spans?.length || 0)} spans`;
  if (action.type === 'propose_write') {
    return action.result?.noChanges
      ? `${action.title}: no changes required`
      : `${action.title}: prepared batch ${String(action.result?.batchId || '')}`;
  }
  if (action.type === 'apply_write_batch') {
    if (action.result?.path) return `${action.title}: applied ${String(action.result.path)}`;
    return `${action.title}: ${Number(action.result?.appliedCount || 0)} operation(s) applied`;
  }
  if (action.type === 'run_terminal_command') {
    return `${action.title}: ${String(action.result?.command || action.payload?.command || '')}`;
  }
  if (action.type === 'summarize_ops_context') {
    return `${action.title}: ${Number(action.result?.pendingDeployments || 0)} pending deployments`;
  }
  return `${action.title}: ${action.status}`;
}

/**
 * @param {object} run
 * @returns {string}
 */
function buildFallbackAssistantRunReply(run) {
  const parts = [];
  const referencedPaths = dedupePaths([
    run.activeFilePath,
    ...(run.artifacts?.referencedFiles || []),
    ...(run.selectedPaths || []),
  ]).filter(Boolean);
  const proposalBatches = Array.isArray(run.artifacts?.proposalBatches) ? run.artifacts.proposalBatches : [];
  const proposalCount = proposalBatches.reduce((sum, batch) => sum + Number(batch?.proposals?.length || 0), 0);
  const approvalCount = run.actions.filter((action) => action.status === 'requires_approval').length;
  const failedCount = run.actions.filter((action) => action.status === 'failed').length;

  if (referencedPaths.length) {
    const label = referencedPaths.length === 1 ? 'file' : 'files';
    parts.push(`Reviewed ${label} ${referencedPaths.slice(0, 3).map((entry) => `\`${entry}\``).join(', ')}.`);
  } else if (run.summary) {
    parts.push(run.summary);
  } else {
    parts.push('Run completed.');
  }

  if (proposalCount > 0) {
    const noun = proposalCount === 1 ? 'change' : 'changes';
    if (approvalCount > 0) parts.push(`Prepared ${proposalCount} ${noun} and left them in the Changes tab for review.`);
    else parts.push(`Prepared ${proposalCount} ${noun}.`);
  } else if (run.actions.some((action) => action.type === 'propose_write' && action.result?.noChanges)) {
    parts.push('No safe structural edit was available from the fallback path.');
  }

  if (run.artifacts?.lastSearch) {
    parts.push(`Search found ${Number(run.artifacts.lastSearch.total || run.artifacts.lastSearch.matches?.length || 0)} result(s).`);
  }

  if (Array.isArray(run.artifacts?.capsuleReads) && run.artifacts.capsuleReads.length > 0) {
    parts.push(`Loaded ${run.artifacts.capsuleReads.length} capsule view${run.artifacts.capsuleReads.length === 1 ? '' : 's'}.`);
  }

  if (Array.isArray(run.artifacts?.recoveredSpans) && run.artifacts.recoveredSpans.length > 0) {
    parts.push(`Recovered ${run.artifacts.recoveredSpans.length} raw span${run.artifacts.recoveredSpans.length === 1 ? '' : 's'} for exact detail.`);
  }

  if (run.artifacts?.terminalSessionId) parts.push('Terminal output is available in the Terminal tab.');

  if (run.artifacts?.opsSummary) {
    parts.push(`Ops snapshot: ${Number(run.artifacts.opsSummary.pendingDeployments || 0)} pending deployments and ${Number(run.artifacts.opsSummary.policies || 0)} policies.`);
  }

  if (failedCount > 0) parts.push(`${failedCount} action${failedCount === 1 ? '' : 's'} need attention.`);

  return parts.join(' ').trim() || 'Run completed without additional actions.';
}

/**
 * @param {object} run
 * @param {object} [credentials]
 * @returns {Promise<string>}
 */
async function summarizeAssistantRun(run, credentials = {}) {
  const actionDigest = run.actions.map((action) => buildActionResultSummary(action)).join('\n');
  const proposalDigest = run.artifacts.proposalBatches
    .map((batch) => `${batch.id}: ${batch.proposals.map((proposal) => proposal.path).join(', ')} (${batch.status})`)
    .join('\n');
  const capsuleDigest = (run.artifacts.capsuleReads || [])
    .map((entry) => `<capsule path="${escapeTagAttribute(entry.path)}">\n${String(entry.excerpt || '').slice(0, 8000)}\n</capsule>`)
    .join('\n\n');
  const recoveredDigest = (run.artifacts.recoveredSpans || [])
    .map((entry) => `<span path="${escapeTagAttribute(entry.path)}" id="${escapeTagAttribute(entry.spanId)}" line_start="${Number(entry.lineStart || 0)}" line_end="${Number(entry.lineEnd || 0)}">\n${String(entry.text || '').slice(0, 4000)}\n</span>`)
    .join('\n\n');

  try {
    if (!proposalDigest && (capsuleDigest || recoveredDigest || run.artifacts.opsSummary)) {
      const answer = await runModelChat({
        model: run.model,
        credentials,
        messages: [
          {
            role: 'user',
            content: [
              'Answer the original Mesh AI request directly.',
              'Use capsule context first and recovered spans for exact details.',
              'When making exact claims, include the relevant span ids.',
              `Original request: ${run.prompt}`,
              capsuleDigest ? `Capsules:\n${capsuleDigest}` : '',
              recoveredDigest ? `Recovered spans:\n${recoveredDigest}` : '',
              run.artifacts.opsSummary ? `Ops summary:\n${JSON.stringify(run.artifacts.opsSummary, null, 2)}` : '',
            ].filter(Boolean).join('\n\n'),
          },
        ],
      });
      return String(answer.content || '').trim();
    }

    if (actionDigest || proposalDigest) {
      const summary = await runModelChat({
        model: run.model,
        credentials,
        messages: [
          {
            role: 'user',
            content: [
              `Summarize the Mesh AI run result for the user in 1-2 sentences. Prompt: ${run.prompt}`,
              actionDigest ? `Actions:\n${actionDigest}` : '',
              proposalDigest ? `Proposals:\n${proposalDigest}` : '',
            ].filter(Boolean).join('\n\n'),
          },
        ],
      });
      return String(summary.content || '').trim();
    }
  } catch {
    // Fall back to the local summary builder.
  }

  return buildFallbackAssistantRunReply(run);
}

/**
 * @param {object} run
 * @param {object} action
 * @param {object} [credentials]
 * @returns {Promise<void>}
 */
async function executeAssistantRunAction(run, action, credentials = {}) {
  action.error = '';
  action.result = null;
  action.approvalRequired = false;
  action.status = 'running';
  touchRunEntity(action);
  touchRunEntity(run);

  try {
    if (action.type === 'search_workspace') {
      const result = await searchWorkspaceWithFallback(action.payload.q, { ...action.payload, requestId: run.requestId });
      action.result = result;
      run.artifacts.lastSearch = cloneJsonValue(result);
      run.artifacts.referencedFiles = Array.isArray(result?.matches) ? result.matches.map((entry) => entry.path) : [];
      action.status = 'completed';
      return;
    }

    if (action.type === 'read_file' || action.type === 'open_file') {
      const opened = await openWorkspaceFileWithFallback(action.payload.path, 'original', { requestId: run.requestId });
      action.result = { path: opened.path, excerpt: String(opened.content || '').slice(0, 12000), originalSize: Number(opened.originalSize || 0) };
      run.artifacts.referencedFiles = dedupePaths([...(run.artifacts.referencedFiles || []), opened.path]);
      action.status = 'completed';
      return;
    }

    if (action.type === 'read_capsule') {
      const opened = await openWorkspaceFileWithFallback(action.payload.path, action.payload.query ? 'focused' : 'capsule', {
        query: action.payload.query || run.prompt,
        requestId: run.requestId,
      });
      action.result = {
        path: opened.path,
        capsuleMode: String(opened?.capsule?.capsuleMode || opened?.capsuleMode || ''),
        fileType: String(opened?.fileType || ''),
        parserFamily: String(opened?.parserFamily || ''),
        excerpt: String(opened.content || '').slice(0, 16000),
        recoveryEligible: Boolean(opened?.capsule?.recoveryEligible),
      };
      run.artifacts.referencedFiles = dedupePaths([...(run.artifacts.referencedFiles || []), opened.path]);
      run.artifacts.capsuleReads = [
        ...(Array.isArray(run.artifacts.capsuleReads) ? run.artifacts.capsuleReads : []),
        cloneJsonValue(action.result),
      ].slice(-8);
      action.status = 'completed';
      return;
    }

    if (action.type === 'recover_spans') {
      const recovered = await recoverWorkspaceWithFallback(action.payload.path, {
        query: action.payload.query || run.prompt,
        spanIds: Array.isArray(action.payload.spanIds) ? action.payload.spanIds : [],
        ranges: Array.isArray(action.payload.ranges) ? action.payload.ranges : [],
      });
      action.result = {
        path: recovered.path,
        spans: Array.isArray(recovered.spans) ? recovered.spans.slice(0, 8) : [],
        ranges: Array.isArray(recovered.ranges) ? recovered.ranges.slice(0, 8) : [],
        suggestedSpanIds: Array.isArray(recovered.suggestedSpanIds) ? recovered.suggestedSpanIds : [],
      };
      run.artifacts.recoveredSpans = [
        ...(Array.isArray(run.artifacts.recoveredSpans) ? run.artifacts.recoveredSpans : []),
        ...action.result.spans.map((entry) => ({ ...entry, path: recovered.path })),
      ].slice(-16);
      run.artifacts.referencedFiles = dedupePaths([...(run.artifacts.referencedFiles || []), recovered.path]);
      action.status = 'completed';
      return;
    }

    if (action.type === 'summarize_ops_context') {
      const snapshot = snapshotOperationsPayload();
      action.result = {
        pendingDeployments: snapshot.deployments?.pending?.length || 0,
        policies: Array.isArray(snapshot.policies) ? snapshot.policies.length : 0,
        recentLogs: Array.isArray(snapshot.logs) ? snapshot.logs.slice(-8) : [],
      };
      run.artifacts.opsSummary = cloneJsonValue(action.result);
      action.status = 'completed';
      return;
    }

    if (action.type === 'propose_write') {
      const batch = await generateAssistantWriteBatch(run, action, credentials);
      if (batch?.noChanges) {
        action.result = { noChanges: true, paths: batch.targetPaths || [] };
        action.status = 'completed';
        return;
      }
      for (const entry of run.actions) {
        if (entry.type !== 'apply_write_batch') continue;
        if (String(entry?.payload?.batchId || '') !== 'latest-proposal') continue;
        entry.payload.batchId = batch.id;
        touchRunEntity(entry);
      }
      const hasExplicitBatchApply = run.actions.some((entry) => entry.type === 'apply_write_batch'
        && entry.id !== action.id
        && ['latest-proposal', batch.id].includes(String(entry?.payload?.batchId || ''))
        && !String(entry?.payload?.proposalId || '').trim());
      if ((batch.proposals || []).length > 1 && !hasExplicitBatchApply) ensureApplyProposalActionsForBatch(run, batch);
      else ensureApplyBatchActionForRun(run, batch);
      action.result = { batchId: batch.id, proposalCount: batch.proposals.length, paths: batch.proposals.map((p) => p.path) };
      action.status = 'completed';
      return;
    }

    if (action.type === 'apply_write_batch') {
      const batch = resolveRunBatch(run, action.payload.batchId);
      if (!batch) throw new Error('Proposal batch not found.');
      const targetedProposal = resolveRunProposal(batch, action.payload.proposalId);
      const targetProposals = targetedProposal
        ? [targetedProposal]
        : (batch.proposals || []).filter((proposal) => String(proposal?.status || 'pending') === 'pending');
      if (!targetProposals.length) {
        action.result = { ok: true, appliedCount: 0, path: targetedProposal?.path || '', skipped: true };
        action.status = 'completed';
        syncBatchStatusFromProposals(batch);
        return;
      }

      const operations = targetProposals.map((proposal) => ({ type: 'write', path: proposal.path, content: proposal.nextContent }));
      const applied = await applyWorkspaceBatchWithFallback(operations, { stopOnError: true });
      for (const proposal of targetProposals) {
        proposal.status = applied.ok ? 'applied' : 'failed';
      }
      syncBatchStatusFromProposals(batch);
      action.result = applied;
      action.result.appliedCount = Number(applied?.appliedCount || targetProposals.length);
      if (targetedProposal) { action.result.path = targetedProposal.path; action.result.proposalId = targetedProposal.id; }
      action.status = applied.ok ? 'completed' : 'failed';
      if (!applied.ok) action.error = 'Batch apply failed.';
      return;
    }

    if (action.type === 'run_terminal_command') {
      let sessionId = String(action.payload.terminalSessionId || run.artifacts.terminalSessionId || run.terminalSessionId || '').trim();
      if (!sessionId) {
        const created = createAssistantTerminalSession({});
        sessionId = String(created?.session?.id || '');
      }
      const session = getAssistantTerminalSession(sessionId);
      const since = session ? session.cursor : 0;
      writeAssistantTerminalInput(sessionId, `${String(action.payload.command || '').trim()}\n`);
      const output = listAssistantTerminalOutput(sessionId, since);
      run.artifacts.terminalSessionId = sessionId;
      action.result = { sessionId, command: String(action.payload.command || '').trim(), cursor: output.cursor, entries: output.entries };
      action.status = 'completed';
      return;
    }

    action.status = 'failed';
    action.error = `Unsupported action type "${action.type}".`;
  } catch (error) {
    action.status = 'failed';
    action.error = String(error?.message || 'Action failed');
  } finally {
    touchRunEntity(action);
    touchRunEntity(run);
  }
}

/**
 * @param {object} run
 * @param {object} [credentials]
 * @returns {Promise<object>}
 */
async function continueAssistantRun(run, credentials = {}) {
  run.status = 'running';
  touchRunEntity(run);

  for (const action of run.actions) {
    if (action.status !== 'pending') continue;

    if (action.type === 'apply_write_batch' || action.type === 'run_terminal_command') {
      const payload = action.type === 'run_terminal_command' ? { command: action.payload.command } : action.payload;
      if (!shouldAutoApplyAction(action.type, run.autonomyMode, payload)) {
        action.status = 'requires_approval';
        action.approvalRequired = true;
        touchRunEntity(action);
        continue;
      }
    }

    await executeAssistantRunAction(run, action, credentials);
  }

  run.reply = await summarizeAssistantRun(run, credentials);
  run.status = run.actions.some((action) => action.status === 'requires_approval')
    ? 'awaiting_approval'
    : (run.actions.some((action) => action.status === 'failed') ? 'completed_with_errors' : 'completed');
  touchRunEntity(run);
  return run;
}

/**
 * @param {object} input
 * @param {object} [credentials]
 * @returns {Promise<object>}
 */
async function createAssistantRun(input = {}, credentials = {}) {
  const requestId = String(input.requestId || credentials.requestId || '');
  const planMeta = await planAssistantRun({ ...input, credentials, requestId });
  const run = createAssistantRunRecord({ ...input, requestId }, planMeta);
  assistantRuns.set(run.id, run);

  if (!run.actions.length) {
    const normalizedMessages = normalizeMessages([{ role: 'user', content: run.prompt }]);
    try {
      const fallback = await runModelChat({ model: run.model, messages: normalizedMessages, credentials });
      run.reply = String(fallback.content || '').trim() || 'No response.';
      run.planSource = 'legacy-chat';
      run.artifacts.chatFallback = { model: fallback.model, provider: fallback.provider };
    } catch {
      const legacy = await localAssistantReply(run.model, normalizedMessages);
      run.reply = String(legacy?.content || '').trim() || 'No response.';
      run.planSource = 'legacy-chat';
      run.artifacts.chatFallback = cloneJsonValue(legacy);
    }
    run.status = 'completed';
    touchRunEntity(run);
    return run;
  }

  await continueAssistantRun(run, credentials);
  return run;
}

/**
 * @param {object} run
 * @param {object} action
 * @param {string} decision
 * @param {object} [credentials]
 * @returns {Promise<object>}
 */
async function applyAssistantRunDecision(run, action, decision, credentials = {}) {
  const normalizedDecision = String(decision || '').trim().toLowerCase();
  if (!['approve', 'reject', 'retry'].includes(normalizedDecision)) {
    throw new Error('Decision must be approve, reject, or retry.');
  }

  if (normalizedDecision === 'reject') {
    if (action.type === 'apply_write_batch') {
      const batch = resolveRunBatch(run, action.payload.batchId);
      if (batch) {
        const targetedProposal = resolveRunProposal(batch, action.payload.proposalId);
        if (targetedProposal) {
          targetedProposal.status = 'rejected';
        } else {
          for (const proposal of batch.proposals || []) {
            if (String(proposal?.status || 'pending') === 'pending') proposal.status = 'rejected';
          }
        }
        syncBatchStatusFromProposals(batch);
      }
    }
    action.status = 'rejected';
    action.approvalRequired = false;
    touchRunEntity(action);
    run.reply = await summarizeAssistantRun(run, credentials);
    run.status = run.actions.some((entry) => entry.status === 'requires_approval') ? 'awaiting_approval' : 'completed';
    touchRunEntity(run);
    return run;
  }

  action.status = 'pending';
  action.approvalRequired = false;
  touchRunEntity(action);
  await executeAssistantRunAction(run, action, credentials);
  await continueAssistantRun(run, credentials);
  return run;
}

module.exports = {
  buildActionResultSummary,
  buildFallbackAssistantRunReply,
  summarizeAssistantRun,
  executeAssistantRunAction,
  continueAssistantRun,
  createAssistantRun,
  applyAssistantRunDecision,
};
