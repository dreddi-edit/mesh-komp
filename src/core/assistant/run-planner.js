'use strict';

/**
 * Assistant run planning — candidate path resolution, heuristic and model-driven planning.
 * Uses globals injected by core/index.js at boot.
 */

const {
  extractExplicitPathReferences,
  hasEditIntent,
  hasSearchIntent,
  hasReadIntent,
  hasOpsIntent,
  buildOpsContextSnippet,
  extractExplicitCommandFromPrompt,
  cloneJsonValue,
} = require('./run-model');

/**
 * @param {string} prompt
 * @param {string} [activeFilePath]
 * @param {string[]} [selectedPaths]
 * @param {string} [requestId]
 * @returns {Promise<string[]>}
 */
async function resolveAssistantCandidatePaths(prompt, activeFilePath = '', selectedPaths = [], requestId = '') {
  const explicit = extractExplicitPathReferences(prompt);
  const inferred = await inferReferencedFilesFromWorkspace(prompt, requestId);
  return dedupePaths([...explicit, activeFilePath, ...(Array.isArray(selectedPaths) ? selectedPaths : []), ...inferred]);
}

/**
 * @param {object} input
 * @returns {Promise<object>}
 */
async function buildHeuristicAssistantRunPlan(input = {}) {
  const prompt = String(input.prompt || '').trim();
  const mode = normalizeRunMode(input.mode, 'ask');
  const requestId = String(input.requestId || '');
  const candidatePaths = await resolveAssistantCandidatePaths(prompt, input.activeFilePath, input.selectedPaths, requestId);
  const primaryPath = candidatePaths[0] || '';
  const editPaths = candidatePaths.slice(0, mode === 'agent' ? 3 : 2);
  const actions = [];

  if (hasSearchIntent(prompt) && !primaryPath) {
    actions.push({ type: 'search_workspace', title: 'Search workspace', payload: { q: prompt, scope: 'all', limit: 12 } });
  }

  if (primaryPath && (hasReadIntent(prompt) || hasEditIntent(prompt, mode))) {
    actions.push({ type: 'read_capsule', title: `Read capsule for ${basename(primaryPath)}`, payload: { path: primaryPath, query: prompt } });
  }

  if (hasOpsIntent(prompt)) {
    actions.push({ type: 'summarize_ops_context', title: 'Summarize ops context', payload: { scope: 'selected' } });
  }

  if (primaryPath && hasEditIntent(prompt, mode)) {
    actions.push({
      type: 'propose_write',
      title: `Draft changes for ${basename(primaryPath)}`,
      payload: { path: primaryPath, paths: editPaths.length ? editPaths : [primaryPath], instruction: prompt },
    });
  }

  if (primaryPath && shouldPrefetchRecoveryForPrompt(prompt)) {
    actions.push({ type: 'recover_spans', title: `Recover exact spans for ${basename(primaryPath)}`, payload: { path: primaryPath, query: prompt } });
  }

  const command = extractExplicitCommandFromPrompt(prompt);
  if (command) {
    actions.push({ type: 'run_terminal_command', title: 'Run terminal command', payload: { command, terminalSessionId: String(input.terminalSessionId || '').trim() } });
  }

  if (!actions.length && primaryPath) {
    actions.push({ type: 'open_file', title: `Open ${basename(primaryPath)}`, payload: { path: primaryPath } });
  }

  return {
    mode,
    summary: mode === 'agent' ? 'Agent run planned heuristically.' : 'Assistant run planned heuristically.',
    actions,
  };
}

/**
 * @param {object} input
 * @returns {Promise<object|null>}
 */
async function planAssistantRunWithModel(input = {}) {
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return null;

  const system = [
    'You are Mesh AI planner.',
    'Return only strict JSON.',
    'Schema: {"summary":string,"actions":Action[]}',
    'Action types: read_file, read_capsule, recover_spans, search_workspace, open_file, propose_write, apply_write_batch, run_terminal_command, summarize_ops_context.',
    'Use read_capsule before read_file whenever the goal is understanding or answering from workspace content.',
    'Use recover_spans if the request needs exact literals, lines, or implementation details.',
    'For propose_write include payload.path or payload.paths plus payload.instruction.',
    'For apply_write_batch set payload.batchId to "latest-proposal" and optionally payload.proposalId.',
    'For recover_spans include payload.path and payload.spanIds or payload.query.',
    'Never invent unsupported action types.',
    'Plan at most 5 actions.',
  ].join('\n');

  const planningPrompt = [
    `Mode: ${normalizeRunMode(input.mode, 'ask')}`,
    `Autonomy: ${normalizeAutonomyMode(input.autonomyMode, 'review')}`,
    input.workspaceFolderName ? `Workspace root: ${toSafePath(input.workspaceFolderName)}` : 'Workspace root: unknown',
    input.activeFilePath ? `Active file: ${toSafePath(input.activeFilePath)}` : 'Active file: none',
    Array.isArray(input.selectedPaths) && input.selectedPaths.length
      ? `Selected paths: ${dedupePaths(input.selectedPaths).slice(0, 6).join(', ')}`
      : 'Selected paths: none',
    input.opsSelection ? buildOpsContextSnippet(input.opsSelection) : '',
    `User request: ${prompt}`,
  ].filter(Boolean).join('\n\n');

  try {
    const routed = await runModelChat({
      model: String(input.model || 'claude-sonnet-4-6'),
      messages: [{ role: 'user', content: `${system}\n\n${planningPrompt}` }],
      credentials: input.credentials || {},
    });
    const jsonText = extractFirstJsonObject(routed.content || '');
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText);
    const plan = sanitizeAssistantRunPlan(parsed);
    if (!plan.actions.length) return null;
    plan.mode = normalizeRunMode(input.mode, plan.mode || 'ask');
    return { source: 'model', usage: cloneJsonValue(routed.usage || null), plan };
  } catch {
    return null;
  }
}

/**
 * @param {object} input
 * @returns {Promise<object>}
 */
async function planAssistantRun(input = {}) {
  const modelPlan = await planAssistantRunWithModel(input);
  if (modelPlan) return modelPlan;
  return { source: 'heuristic', usage: null, plan: await buildHeuristicAssistantRunPlan(input) };
}

module.exports = {
  resolveAssistantCandidatePaths,
  buildHeuristicAssistantRunPlan,
  planAssistantRunWithModel,
  planAssistantRun,
};
