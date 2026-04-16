'use strict';

/**
 * Assistant run proposal generation and batch editing.
 * Uses globals injected by core/index.js at boot.
 */

const { touchRunEntity, normalizeRunActionState, ensureRunWorkspacePath, buildOpsContextSnippet } = require('./run-model');

function normalizeDiffText(rawText) {
  return String(rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * @param {string} beforeContent
 * @param {string} afterContent
 * @returns {{ removed: number, added: number }}
 */
function computeProposalLineDelta(beforeContent, afterContent) {
  const before = normalizeDiffText(beforeContent);
  const after = normalizeDiffText(afterContent);
  if (before === after) return { removed: 0, added: 0 };

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let prefixLen = 0;
  while (prefixLen < beforeLines.length && prefixLen < afterLines.length && beforeLines[prefixLen] === afterLines[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < (beforeLines.length - prefixLen) &&
    suffixLen < (afterLines.length - prefixLen) &&
    beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  return {
    removed: beforeLines.slice(prefixLen, beforeLines.length - suffixLen).length,
    added: afterLines.slice(prefixLen, afterLines.length - suffixLen).length,
  };
}

/**
 * @param {string} pathValue
 * @param {string} beforeContent
 * @param {string} afterContent
 * @returns {string}
 */
function buildProposalDiff(pathValue, beforeContent, afterContent) {
  const before = normalizeDiffText(beforeContent);
  const after = normalizeDiffText(afterContent);
  if (before === after) return `No textual changes for ${pathValue}.`;

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  let prefixLen = 0;
  while (prefixLen < beforeLines.length && prefixLen < afterLines.length && beforeLines[prefixLen] === afterLines[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  while (
    suffixLen < (beforeLines.length - prefixLen) &&
    suffixLen < (afterLines.length - prefixLen) &&
    beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const beforeMiddle = beforeLines.slice(prefixLen, beforeLines.length - suffixLen);
  const afterMiddle = afterLines.slice(prefixLen, afterLines.length - suffixLen);
  const MAX_DIFF_LINES = 180;
  const diffLines = [
    `--- a/${pathValue}`,
    `+++ b/${pathValue}`,
    `@@ -${prefixLen + 1},${beforeMiddle.length} +${prefixLen + 1},${afterMiddle.length} @@`,
    ...beforeMiddle.slice(0, MAX_DIFF_LINES).map((line) => `-${line}`),
    ...(beforeMiddle.length > MAX_DIFF_LINES ? [`-... (${beforeMiddle.length - MAX_DIFF_LINES} more removed lines)`] : []),
    ...afterMiddle.slice(0, MAX_DIFF_LINES).map((line) => `+${line}`),
    ...(afterMiddle.length > MAX_DIFF_LINES ? [`+... (${afterMiddle.length - MAX_DIFF_LINES} more added lines)`] : []),
  ];
  return diffLines.join('\n');
}

/**
 * @param {string} rawText
 * @returns {{ language: string, code: string }|null}
 */
function extractFirstFencedCodeBlock(rawText) {
  const match = /```([^\n`]*)\n?([\s\S]*?)```/m.exec(String(rawText || ''));
  if (!match) return null;
  return {
    language: String(match[1] || '').trim().toLowerCase(),
    code: String(match[2] || '').replace(/^\n+|\n+$/g, ''),
  };
}

/**
 * @param {string} targetPath
 * @param {string} rawText
 * @returns {string}
 */
function extractDirectProposalContent(targetPath, rawText) {
  const text = String(rawText || '').trim();
  if (!text) return '';

  const normalizedPath = String(targetPath || '').toLowerCase();
  const looksLikeAssistantPreface = /^(here('| i)?s|i (updated|rewrote|made)|below is|sure[,!]?|ich habe|hier ist|natuerlich|natürlich)/i.test(text);
  if (looksLikeAssistantPreface) return '';

  if (normalizedPath.endsWith('.html') || normalizedPath.endsWith('.htm') || normalizedPath.endsWith('.xml')) {
    if (/^(<!doctype|<html\b|<body\b|<main\b|<section\b|<div\b|<article\b|<header\b)/i.test(text)) return text;
    return '';
  }

  if (normalizedPath.endsWith('.json')) {
    if (/^[\[{]/.test(text)) return text;
    return '';
  }

  if (normalizedPath.endsWith('.md') || normalizedPath.endsWith('.markdown')) {
    if (/^(#|>|- |\* |\d+\. )/m.test(text) || text.includes('\n')) return text;
    return '';
  }

  if (
    normalizedPath.endsWith('.js') || normalizedPath.endsWith('.mjs') || normalizedPath.endsWith('.cjs')
    || normalizedPath.endsWith('.ts') || normalizedPath.endsWith('.tsx') || normalizedPath.endsWith('.jsx')
    || normalizedPath.endsWith('.css') || normalizedPath.endsWith('.scss') || normalizedPath.endsWith('.less')
  ) {
    if (/[;{}]/.test(text) || /\b(function|const|let|var|export|import|class)\b/.test(text)) return text;
    return '';
  }

  return text.includes('\n') ? text : '';
}

/**
 * @param {string} pathValue
 * @param {string} prompt
 * @param {string} [beforeContent]
 * @returns {string}
 */
function buildFallbackTemplateForTarget(pathValue, prompt, beforeContent = '') {
  return buildStructuralEditFallback(pathValue, prompt, beforeContent);
}

/**
 * @param {object} run
 * @param {object} action
 * @returns {string[]}
 */
function extractProposalTargetPaths(run, action) {
  const payloadPaths = Array.isArray(action?.payload?.paths) ? action.payload.paths : [];
  return dedupePaths([action?.payload?.path, ...payloadPaths, run.activeFilePath, ...(run.selectedPaths || [])]
    .map((entry) => ensureRunWorkspacePath(run, entry))).slice(0, 3);
}

/**
 * @param {object} run
 * @param {string} targetPath
 * @param {object} action
 * @param {object} [credentials]
 * @param {string[]} [contextSeedPaths]
 * @returns {Promise<object|null>}
 */
async function generateAssistantWriteProposal(run, targetPath, action, credentials = {}, contextSeedPaths = []) {
  const safeTargetPath = toSafePath(targetPath);
  if (!safeTargetPath) return null;

  let beforeContent = '';
  try {
    const opened = await openWorkspaceFileWithFallback(safeTargetPath, 'original');
    beforeContent = String(opened?.content || '');
  } catch (error) {
    const message = String(error?.message || '');
    if (!/not found/i.test(message)) throw error;
  }

  let nextContent = '';
  const contextPaths = dedupePaths([safeTargetPath, ...contextSeedPaths, run.activeFilePath, ...(run.selectedPaths || [])]).slice(0, 3);
  const contextEntries = await loadPlainContextEntries(contextPaths, { maxFiles: Math.min(3, contextPaths.length || 1), maxChars: 18000 });
  const contextBlock = buildPlainContextBlock(contextEntries);
  const opsContext = buildOpsContextSnippet(run.opsSelection || {});
  const instruction = String(action?.payload?.instruction || run.prompt || '').trim();

  try {
    const routed = await runModelChat({
      model: run.model,
      credentials,
      messages: [
        {
          role: 'user',
          content: [
            'You are Mesh AI edit mode.',
            `Return exactly one full-file code block for ${safeTargetPath}.`,
            'Do not return unified diff format.',
            'Preserve valid syntax and produce the final file contents only inside the code block.',
            `Instruction: ${instruction}`,
            contextBlock,
            opsContext,
          ].filter(Boolean).join('\n\n'),
        },
      ],
    });
    const block = extractFirstFencedCodeBlock(routed.content || '');
    if (block?.code) nextContent = block.code;
    if (!nextContent) nextContent = extractDirectProposalContent(safeTargetPath, routed.content || '');
  } catch {
    // Fall back to a safe template.
  }

  if (!nextContent) nextContent = buildFallbackTemplateForTarget(safeTargetPath, instruction, beforeContent);

  if (normalizeDiffText(nextContent) === normalizeDiffText(beforeContent)) {
    return { noChanges: true, targetPath: safeTargetPath };
  }

  return {
    path: safeTargetPath,
    beforeContent,
    nextContent,
    diff: buildProposalDiff(safeTargetPath, beforeContent, nextContent),
    lineDelta: computeProposalLineDelta(beforeContent, nextContent),
  };
}

/**
 * @param {object} run
 * @param {object} action
 * @param {object} [credentials]
 * @returns {Promise<object>}
 */
async function generateAssistantWriteBatch(run, action, credentials = {}) {
  const targetPaths = extractProposalTargetPaths(run, action);
  if (!targetPaths.length) throw new Error('No target file available for write proposal.');

  const proposals = [];
  for (const targetPath of targetPaths) {
    const proposal = await generateAssistantWriteProposal(run, targetPath, action, credentials, targetPaths);
    if (!proposal || proposal.noChanges) continue;
    proposals.push(proposal);
  }

  if (!proposals.length) return { noChanges: true, targetPaths };

  const batchId = `batch-${run.id}-${run.artifacts.proposalBatches.length + 1}`;
  const batch = {
    id: batchId,
    status: 'pending',
    createdAt: toIsoNow(),
    proposals: proposals.map((proposal, index) => ({
      id: `proposal-${run.id}-${run.artifacts.proposalBatches.length + 1}-${index + 1}`,
      path: proposal.path,
      beforeContent: proposal.beforeContent,
      nextContent: proposal.nextContent,
      diff: proposal.diff,
      lineDelta: proposal.lineDelta,
      status: 'pending',
    })),
  };

  run.artifacts.proposalBatches.push(batch);
  run.artifacts.latestBatchId = batchId;
  touchRunEntity(run);
  return batch;
}

/**
 * @param {object} run
 * @param {string} batchIdInput
 * @returns {object|null}
 */
function resolveRunBatch(run, batchIdInput) {
  const batchId = String(batchIdInput || '').trim();
  if (!batchId || batchId === 'latest-proposal') {
    return run.artifacts.proposalBatches.find((batch) => batch.id === run.artifacts.latestBatchId) || null;
  }
  return run.artifacts.proposalBatches.find((batch) => batch.id === batchId) || null;
}

/**
 * @param {object} batch
 * @param {string} proposalIdInput
 * @returns {object|null}
 */
function resolveRunProposal(batch, proposalIdInput) {
  const proposalId = String(proposalIdInput || '').trim();
  if (!proposalId) return null;
  return (batch?.proposals || []).find((proposal) => proposal.id === proposalId) || null;
}

/**
 * @param {object} batch
 * @returns {string}
 */
function syncBatchStatusFromProposals(batch) {
  const proposals = Array.isArray(batch?.proposals) ? batch.proposals : [];
  if (!proposals.length) { batch.status = 'pending'; return batch.status; }

  const statuses = proposals.map((proposal) => String(proposal?.status || 'pending'));
  if (statuses.every((s) => s === 'applied')) { batch.status = 'applied'; return batch.status; }
  if (statuses.every((s) => s === 'rejected')) { batch.status = 'rejected'; return batch.status; }
  if (statuses.some((s) => s === 'failed')) { batch.status = 'partial'; return batch.status; }
  if (statuses.some((s) => s === 'applied' || s === 'rejected')) { batch.status = 'partial'; return batch.status; }
  batch.status = 'pending';
  return batch.status;
}

/**
 * @param {object} run
 * @param {object} batch
 * @returns {object|null}
 */
function ensureApplyBatchActionForRun(run, batch) {
  if (!batch?.id) return null;
  const existing = run.actions.find((action) => action.type === 'apply_write_batch'
    && String(action?.payload?.batchId || '') === batch.id
    && !String(action?.payload?.proposalId || '').trim());
  if (existing) return existing;

  const action = normalizeRunActionState({
    id: `action-${run.actions.length + 1}`,
    type: 'apply_write_batch',
    title: `Apply changes for ${batch.proposals.length} file${batch.proposals.length === 1 ? '' : 's'}`,
    payload: { batchId: batch.id },
  }, run.actions.length);
  run.actions.push(action);
  touchRunEntity(run);
  return action;
}

/**
 * @param {object} run
 * @param {object} batch
 * @returns {object[]}
 */
function ensureApplyProposalActionsForBatch(run, batch) {
  if (!batch?.id || !Array.isArray(batch?.proposals)) return [];
  const created = [];
  for (const proposal of batch.proposals) {
    const existing = run.actions.find((action) => action.type === 'apply_write_batch'
      && String(action?.payload?.batchId || '') === batch.id
      && String(action?.payload?.proposalId || '') === proposal.id);
    if (existing) { created.push(existing); continue; }

    const action = normalizeRunActionState({
      id: `action-${run.actions.length + 1}`,
      type: 'apply_write_batch',
      title: `Apply changes for ${basename(proposal.path)}`,
      payload: { batchId: batch.id, proposalId: proposal.id },
    }, run.actions.length);
    run.actions.push(action);
    created.push(action);
  }
  touchRunEntity(run);
  return created;
}

module.exports = {
  normalizeDiffText,
  computeProposalLineDelta,
  buildProposalDiff,
  extractFirstFencedCodeBlock,
  extractDirectProposalContent,
  buildFallbackTemplateForTarget,
  extractProposalTargetPaths,
  generateAssistantWriteProposal,
  generateAssistantWriteBatch,
  resolveRunBatch,
  resolveRunProposal,
  syncBatchStatusFromProposals,
  ensureApplyBatchActionForRun,
  ensureApplyProposalActionsForBatch,
};
