'use strict';

/**
 * Assistant run data model — record creation, snapshots, and intent helpers.
 * All functions use globals injected by core/index.js at boot.
 */

/**
 * @param {*} value
 * @returns {*}
 */
function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/**
 * @param {object} rawAction
 * @param {number} index
 * @returns {object}
 */
function normalizeRunActionState(rawAction = {}, index = 0) {
  const now = toIsoNow();
  return {
    id: String(rawAction.id || `action-${index + 1}`),
    type: String(rawAction.type || '').trim().toLowerCase(),
    title: String(rawAction.title || rawAction.type || 'Action').trim() || 'Action',
    status: 'pending',
    approvalRequired: false,
    payload: cloneJsonValue(rawAction.payload || {}),
    result: null,
    error: '',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * @param {{ updatedAt: string }} entity
 */
function touchRunEntity(entity) {
  entity.updatedAt = toIsoNow();
}

/**
 * @param {object} input
 * @param {object} planMeta
 * @returns {object}
 */
function createAssistantRunRecord(input = {}, planMeta = {}) {
  const now = toIsoNow();
  const prompt = String(input.prompt || '').trim();
  return {
    id: `run-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    requestId: String(input.requestId || ''),
    status: 'queued',
    title: prompt.slice(0, 90) || 'Assistant run',
    prompt,
    model: String(input.model || 'claude-sonnet-4-6'),
    mode: normalizeRunMode(planMeta?.plan?.mode || input.mode || 'ask', 'ask'),
    autonomyMode: normalizeAutonomyMode(input.autonomyMode, 'review'),
    workspaceFolderName: toSafePath(input.workspaceFolderName || ''),
    activeFilePath: toSafePath(input.activeFilePath || ''),
    selectedPaths: dedupePaths(Array.isArray(input.selectedPaths) ? input.selectedPaths : []),
    terminalSessionId: String(input.terminalSessionId || '').trim(),
    opsSelection: input.opsSelection && typeof input.opsSelection === 'object' ? cloneJsonValue(input.opsSelection) : {},
    chatSessionId: normalizeChatSessionId(input.chatSessionId),
    reply: '',
    planSource: String(planMeta?.source || 'heuristic'),
    plannerUsage: cloneJsonValue(planMeta?.usage || null),
    summary: String(planMeta?.plan?.summary || '').trim(),
    actions: (planMeta?.plan?.actions || []).map((action, index) => normalizeRunActionState(action, index)),
    artifacts: {
      proposalBatches: [],
      latestBatchId: '',
      terminalSessionId: String(input.terminalSessionId || '').trim(),
      lastSearch: null,
      opsSummary: null,
      referencedFiles: [],
      capsuleReads: [],
      recoveredSpans: [],
      chatFallback: null,
    },
  };
}

/**
 * @param {object} run
 * @returns {object}
 */
function assistantRunSnapshot(run) {
  return cloneJsonValue({
    id: run.id,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    status: run.status,
    title: run.title,
    prompt: run.prompt,
    model: run.model,
    mode: run.mode,
    autonomyMode: run.autonomyMode,
    workspaceFolderName: run.workspaceFolderName,
    activeFilePath: run.activeFilePath,
    selectedPaths: run.selectedPaths,
    terminalSessionId: run.terminalSessionId,
    opsSelection: run.opsSelection,
    reply: run.reply,
    planSource: run.planSource,
    plannerUsage: run.plannerUsage,
    summary: run.summary,
    actions: run.actions,
    artifacts: run.artifacts,
  });
}

/**
 * @param {string} rawText
 * @returns {string[]}
 */
function extractExplicitPathReferences(rawText) {
  const text = String(rawText || '');
  const matches = new Set();

  const quoted = text.match(/["'`]([^"'`\n]+(?:\.[A-Za-z0-9_-]{1,12}|\/[^"'`\n]+))["'`]/g) || [];
  for (const entry of quoted) {
    const normalized = sharedSafePath(entry.slice(1, -1));
    if (normalized) matches.add(normalized);
  }

  const pathLikes = text.match(/\b[A-Za-z0-9._/-]+\.[A-Za-z0-9_-]{1,12}\b/g) || [];
  for (const entry of pathLikes) {
    const normalized = sharedSafePath(entry);
    if (normalized) matches.add(normalized);
  }

  return [...matches];
}

/**
 * @param {object} run
 * @param {string} pathInput
 * @returns {string}
 */
function ensureRunWorkspacePath(run, pathInput) {
  const requested = toSafePath(pathInput);
  if (!requested) return '';
  const root = toSafePath(run?.workspaceFolderName || '');
  if (!root || requested === root || requested.startsWith(`${root}/`)) return requested;
  return `${root}/${requested}`;
}

/**
 * @param {string} rawText
 * @returns {string}
 */
function extractExplicitCommandFromPrompt(rawText) {
  const text = String(rawText || '');
  const fenced = /```(?:bash|sh|zsh|shell)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced && String(fenced[1] || '').trim()) {
    return String(fenced[1] || '').trim().split(/\n+/)[0];
  }

  const inline = /`([^`\n]+)`/.exec(text);
  if (inline && /[a-z]/i.test(inline[1])) {
    return String(inline[1] || '').trim();
  }

  const explicit = /\b(?:run|execute|terminal)\s+(?:command\s*)?:?\s*([^\n]+)/i.exec(text);
  if (explicit) {
    const candidate = String(explicit[1] || '').trim();
    if (candidate && !candidate.includes('assistant')) return candidate;
  }

  return '';
}

/** @param {string} rawText @param {string} [mode] @returns {boolean} */
function hasEditIntent(rawText, mode = 'ask') {
  if (normalizeRunMode(mode, 'ask') !== 'ask') return true;
  return /\b(edit|update|change|modify|refactor|rewrite|improve|fix|implement|build|add|create|replace|patch|bearbeite|ändere|aendere|aktualisiere|verbessere|baue|erstelle)\b/i.test(String(rawText || ''));
}

/** @param {string} rawText @returns {boolean} */
function hasSearchIntent(rawText) {
  return /\b(search|find|locate|grep|where|which file|suche|finde|such)\b/i.test(String(rawText || ''));
}

/** @param {string} rawText @returns {boolean} */
function hasReadIntent(rawText) {
  return /\b(open|read|show|inspect|explain|summarize|inhalt|contents?|zeige|lies|erklär|erklaer)\b/i.test(String(rawText || ''));
}

/** @param {string} rawText @returns {boolean} */
function hasOpsIntent(rawText) {
  return /\b(route|routes|policy|policies|deployment|deployments|incident|incidents|ops|operation|logs?)\b/i.test(String(rawText || ''));
}

/**
 * @param {object} [selection]
 * @returns {string}
 */
function buildOpsContextSnippet(selection = {}) {
  const snapshot = snapshotOperationsPayload();
  const selectedRoutes = Array.isArray(selection.routes) ? selection.routes.slice(0, 4) : [];
  const selectedPolicies = Array.isArray(selection.policies) ? selection.policies.slice(0, 4) : [];
  const selectedDeployments = Array.isArray(selection.deployments) ? selection.deployments.slice(0, 4) : [];

  const pending = snapshot.deployments?.pending || [];
  const policies = snapshot.policies || [];
  const history = snapshot.deployments?.history || [];

  const lines = [
    '<mesh_ops_context>',
    `Pending deployments: ${pending.length}`,
    `Policies: ${policies.length}`,
    `Recent deployment history: ${history.slice(0, 3).map((item) => `${item.route}:${item.outcome || item.status || 'pending'}`).join(', ') || 'none'}`,
  ];

  if (selectedRoutes.length) lines.push(`Selected routes: ${selectedRoutes.join(', ')}`);
  if (selectedPolicies.length) lines.push(`Selected policies: ${selectedPolicies.join(', ')}`);
  if (selectedDeployments.length) lines.push(`Selected deployments: ${selectedDeployments.join(', ')}`);
  lines.push('</mesh_ops_context>');
  return lines.join('\n');
}

module.exports = {
  cloneJsonValue,
  normalizeRunActionState,
  touchRunEntity,
  createAssistantRunRecord,
  assistantRunSnapshot,
  extractExplicitPathReferences,
  ensureRunWorkspacePath,
  extractExplicitCommandFromPrompt,
  hasEditIntent,
  hasSearchIntent,
  hasReadIntent,
  hasOpsIntent,
  buildOpsContextSnippet,
};
