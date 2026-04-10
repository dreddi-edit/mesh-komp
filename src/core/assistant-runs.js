'use strict';

/**
 * MESH — Assistant Run Orchestration
 * Extracted from src/core/index.js for maintainability.
 * Handles: run lifecycle, proposal generation, batch editing, and run execution.
 *
 * All helper functions (toIsoNow, appendOperationLog, loadCapsuleContextEntries, etc.)
 * are available as globals set up by server.js before any of these functions are called.
 */

function cloneJsonValue(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeRunActionState(rawAction = {}, index = 0) {
  const now = toIsoNow();
  return {
    id: String(rawAction.id || `action-${index + 1}`),
    type: String(rawAction.type || "").trim().toLowerCase(),
    title: String(rawAction.title || rawAction.type || "Action").trim() || "Action",
    status: "pending",
    approvalRequired: false,
    payload: cloneJsonValue(rawAction.payload || {}),
    result: null,
    error: "",
    createdAt: now,
    updatedAt: now,
  };
}

function touchRunEntity(entity) {
  entity.updatedAt = toIsoNow();
}

function createAssistantRunRecord(input = {}, planMeta = {}) {
  const now = toIsoNow();
  const prompt = String(input.prompt || "").trim();
  return {
    id: `run-${Date.now()}-${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    status: "queued",
    title: prompt.slice(0, 90) || "Assistant run",
    prompt,
    model: String(input.model || "claude-sonnet-4-6"),
    mode: normalizeRunMode(planMeta?.plan?.mode || input.mode || "ask", "ask"),
    autonomyMode: normalizeAutonomyMode(input.autonomyMode, "review"),
    workspaceFolderName: toSafePath(input.workspaceFolderName || ""),
    activeFilePath: toSafePath(input.activeFilePath || ""),
    selectedPaths: dedupePaths(Array.isArray(input.selectedPaths) ? input.selectedPaths : []),
    terminalSessionId: String(input.terminalSessionId || "").trim(),
    opsSelection: input.opsSelection && typeof input.opsSelection === "object" ? cloneJsonValue(input.opsSelection) : {},
    chatSessionId: normalizeChatSessionId(input.chatSessionId),
    reply: "",
    planSource: String(planMeta?.source || "heuristic"),
    plannerUsage: cloneJsonValue(planMeta?.usage || null),
    summary: String(planMeta?.plan?.summary || "").trim(),
    actions: (planMeta?.plan?.actions || []).map((action, index) => normalizeRunActionState(action, index)),
    artifacts: {
      proposalBatches: [],
      latestBatchId: "",
      terminalSessionId: String(input.terminalSessionId || "").trim(),
      lastSearch: null,
      opsSummary: null,
      referencedFiles: [],
      capsuleReads: [],
      recoveredSpans: [],
      chatFallback: null,
    },
  };
}

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

function extractExplicitPathReferences(rawText) {
  const text = String(rawText || "");
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

function ensureRunWorkspacePath(run, pathInput) {
  const requested = toSafePath(pathInput);
  if (!requested) return "";
  const root = toSafePath(run?.workspaceFolderName || "");
  if (!root || requested === root || requested.startsWith(`${root}/`)) return requested;
  return `${root}/${requested}`;
}

function extractExplicitCommandFromPrompt(rawText) {
  const text = String(rawText || "");
  const fenced = /```(?:bash|sh|zsh|shell)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced && String(fenced[1] || "").trim()) {
    return String(fenced[1] || "").trim().split(/\n+/)[0];
  }

  const inline = /`([^`\n]+)`/.exec(text);
  if (inline && /[a-z]/i.test(inline[1])) {
    return String(inline[1] || "").trim();
  }

  const explicit = /\b(?:run|execute|terminal)\s+(?:command\s*)?:?\s*([^\n]+)/i.exec(text);
  if (explicit) {
    const candidate = String(explicit[1] || "").trim();
    if (candidate && !candidate.includes("assistant")) return candidate;
  }

  return "";
}

function hasEditIntent(rawText, mode = "ask") {
  if (normalizeRunMode(mode, "ask") !== "ask") return true;
  return /\b(edit|update|change|modify|refactor|rewrite|improve|fix|implement|build|add|create|replace|patch|bearbeite|ändere|aendere|aktualisiere|verbessere|baue|erstelle)\b/i.test(String(rawText || ""));
}

function hasSearchIntent(rawText) {
  return /\b(search|find|locate|grep|where|which file|suche|finde|such)\b/i.test(String(rawText || ""));
}

function hasReadIntent(rawText) {
  return /\b(open|read|show|inspect|explain|summarize|inhalt|contents?|zeige|lies|erklär|erklaer)\b/i.test(String(rawText || ""));
}

function hasOpsIntent(rawText) {
  return /\b(route|routes|policy|policies|deployment|deployments|incident|incidents|ops|operation|logs?)\b/i.test(String(rawText || ""));
}

function buildOpsContextSnippet(selection = {}) {
  const snapshot = snapshotOperationsPayload();
  const selectedRoutes = Array.isArray(selection.routes) ? selection.routes.slice(0, 4) : [];
  const selectedPolicies = Array.isArray(selection.policies) ? selection.policies.slice(0, 4) : [];
  const selectedDeployments = Array.isArray(selection.deployments) ? selection.deployments.slice(0, 4) : [];

  const pending = snapshot.deployments?.pending || [];
  const policies = snapshot.policies || [];
  const history = snapshot.deployments?.history || [];

  const lines = [
    "<mesh_ops_context>",
    `Pending deployments: ${pending.length}`,
    `Policies: ${policies.length}`,
    `Recent deployment history: ${history.slice(0, 3).map((item) => `${item.route}:${item.outcome || item.status || "pending"}`).join(", ") || "none"}`,
  ];

  if (selectedRoutes.length) lines.push(`Selected routes: ${selectedRoutes.join(", ")}`);
  if (selectedPolicies.length) lines.push(`Selected policies: ${selectedPolicies.join(", ")}`);
  if (selectedDeployments.length) lines.push(`Selected deployments: ${selectedDeployments.join(", ")}`);
  lines.push("</mesh_ops_context>");
  return lines.join("\n");
}

async function resolveAssistantCandidatePaths(prompt, activeFilePath = "", selectedPaths = []) {
  const explicit = extractExplicitPathReferences(prompt);
  const inferred = await inferReferencedFilesFromWorkspace(prompt);
  return dedupePaths([...explicit, activeFilePath, ...(Array.isArray(selectedPaths) ? selectedPaths : []), ...inferred]);
}

async function buildHeuristicAssistantRunPlan(input = {}) {
  const prompt = String(input.prompt || "").trim();
  const mode = normalizeRunMode(input.mode, "ask");
  const candidatePaths = await resolveAssistantCandidatePaths(prompt, input.activeFilePath, input.selectedPaths);
  const primaryPath = candidatePaths[0] || "";
  const editPaths = candidatePaths.slice(0, mode === "agent" ? 3 : 2);
  const actions = [];

  if (hasSearchIntent(prompt) && !primaryPath) {
    actions.push({
      type: "search_workspace",
      title: "Search workspace",
      payload: { q: prompt, scope: "all", limit: 12 },
    });
  }

  if (primaryPath && (hasReadIntent(prompt) || hasEditIntent(prompt, mode))) {
    actions.push({
      type: "read_capsule",
      title: `Read capsule for ${basename(primaryPath)}`,
      payload: { path: primaryPath, query: prompt },
    });
  }

  if (hasOpsIntent(prompt)) {
    actions.push({
      type: "summarize_ops_context",
      title: "Summarize ops context",
      payload: { scope: "selected" },
    });
  }

  if (primaryPath && hasEditIntent(prompt, mode)) {
    actions.push({
      type: "propose_write",
      title: `Draft changes for ${basename(primaryPath)}`,
      payload: {
        path: primaryPath,
        paths: editPaths.length ? editPaths : [primaryPath],
        instruction: prompt,
      },
    });
  }

  if (primaryPath && shouldPrefetchRecoveryForPrompt(prompt)) {
    actions.push({
      type: "recover_spans",
      title: `Recover exact spans for ${basename(primaryPath)}`,
      payload: {
        path: primaryPath,
        query: prompt,
      },
    });
  }

  const command = extractExplicitCommandFromPrompt(prompt);
  if (command) {
    actions.push({
      type: "run_terminal_command",
      title: "Run terminal command",
      payload: { command, terminalSessionId: String(input.terminalSessionId || "").trim() },
    });
  }

  if (!actions.length && primaryPath) {
    actions.push({
      type: "open_file",
      title: `Open ${basename(primaryPath)}`,
      payload: { path: primaryPath },
    });
  }

  return {
    mode,
    summary: mode === "agent" ? "Agent run planned heuristically." : "Assistant run planned heuristically.",
    actions,
  };
}

async function planAssistantRunWithModel(input = {}) {
  const prompt = String(input.prompt || "").trim();
  if (!prompt) return null;

  const system = [
    "You are Mesh AI planner.",
    "Return only strict JSON.",
    "Schema: {\"summary\":string,\"actions\":Action[]}",
    "Action types: read_file, read_capsule, recover_spans, search_workspace, open_file, propose_write, apply_write_batch, run_terminal_command, summarize_ops_context.",
    "Use read_capsule before read_file whenever the goal is understanding or answering from workspace content.",
    "Use recover_spans if the request needs exact literals, lines, or implementation details.",
    "For propose_write include payload.path or payload.paths plus payload.instruction.",
    "For apply_write_batch set payload.batchId to \"latest-proposal\" and optionally payload.proposalId.",
    "For recover_spans include payload.path and payload.spanIds or payload.query.",
    "Never invent unsupported action types.",
    "Plan at most 5 actions.",
  ].join("\n");

  const planningPrompt = [
    `Mode: ${normalizeRunMode(input.mode, "ask")}`,
    `Autonomy: ${normalizeAutonomyMode(input.autonomyMode, "review")}`,
    input.workspaceFolderName ? `Workspace root: ${toSafePath(input.workspaceFolderName)}` : "Workspace root: unknown",
    input.activeFilePath ? `Active file: ${toSafePath(input.activeFilePath)}` : "Active file: none",
    Array.isArray(input.selectedPaths) && input.selectedPaths.length
      ? `Selected paths: ${dedupePaths(input.selectedPaths).slice(0, 6).join(", ")}`
      : "Selected paths: none",
    input.opsSelection ? buildOpsContextSnippet(input.opsSelection) : "",
    `User request: ${prompt}`,
  ].filter(Boolean).join("\n\n");

  try {
    const routed = await runModelChat({
      model: String(input.model || "claude-sonnet-4-6"),
      messages: [
        { role: "user", content: `${system}\n\n${planningPrompt}` },
      ],
      credentials: input.credentials || {},
    });
    const jsonText = extractFirstJsonObject(routed.content || "");
    if (!jsonText) return null;
    const parsed = JSON.parse(jsonText);
    const plan = sanitizeAssistantRunPlan(parsed);
    if (!plan.actions.length) return null;
    plan.mode = normalizeRunMode(input.mode, plan.mode || "ask");
    return {
      source: "model",
      usage: cloneJsonValue(routed.usage || null),
      plan,
    };
  } catch {
    return null;
  }
}

async function planAssistantRun(input = {}) {
  const modelPlan = await planAssistantRunWithModel(input);
  if (modelPlan) return modelPlan;
  return {
    source: "heuristic",
    usage: null,
    plan: await buildHeuristicAssistantRunPlan(input),
  };
}

function normalizeDiffText(rawText) {
  return String(rawText || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function computeProposalLineDelta(beforeContent, afterContent) {
  const before = normalizeDiffText(beforeContent);
  const after = normalizeDiffText(afterContent);
  if (before === after) return { removed: 0, added: 0 };

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");

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

function buildProposalDiff(pathValue, beforeContent, afterContent) {
  const before = normalizeDiffText(beforeContent);
  const after = normalizeDiffText(afterContent);
  if (before === after) return `No textual changes for ${pathValue}.`;

  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
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
  const maxLines = 180;
  const diffLines = [
    `--- a/${pathValue}`,
    `+++ b/${pathValue}`,
    `@@ -${prefixLen + 1},${beforeMiddle.length} +${prefixLen + 1},${afterMiddle.length} @@`,
    ...beforeMiddle.slice(0, maxLines).map((line) => `-${line}`),
    ...(beforeMiddle.length > maxLines ? [`-... (${beforeMiddle.length - maxLines} more removed lines)`] : []),
    ...afterMiddle.slice(0, maxLines).map((line) => `+${line}`),
    ...(afterMiddle.length > maxLines ? [`+... (${afterMiddle.length - maxLines} more added lines)`] : []),
  ];
  return diffLines.join("\n");
}

function extractFirstFencedCodeBlock(rawText) {
  const match = /```([^\n`]*)\n?([\s\S]*?)```/m.exec(String(rawText || ""));
  if (!match) return null;
  return {
    language: String(match[1] || "").trim().toLowerCase(),
    code: String(match[2] || "").replace(/^\n+|\n+$/g, ""),
  };
}

function extractDirectProposalContent(targetPath, rawText) {
  const text = String(rawText || "").trim();
  if (!text) return "";

  const normalizedPath = String(targetPath || "").toLowerCase();
  const looksLikeAssistantPreface = /^(here('| i)?s|i (updated|rewrote|made)|below is|sure[,!]?|ich habe|hier ist|natuerlich|natürlich)/i.test(text);
  if (looksLikeAssistantPreface) return "";

  if (normalizedPath.endsWith(".html") || normalizedPath.endsWith(".htm") || normalizedPath.endsWith(".xml")) {
    if (/^(<!doctype|<html\b|<body\b|<main\b|<section\b|<div\b|<article\b|<header\b)/i.test(text)) return text;
    return "";
  }

  if (normalizedPath.endsWith(".json")) {
    if (/^[\[{]/.test(text)) return text;
    return "";
  }

  if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown")) {
    if (/^(#|>|- |\* |\d+\. )/m.test(text) || text.includes("\n")) return text;
    return "";
  }

  if (
    normalizedPath.endsWith(".js") || normalizedPath.endsWith(".mjs") || normalizedPath.endsWith(".cjs")
    || normalizedPath.endsWith(".ts") || normalizedPath.endsWith(".tsx") || normalizedPath.endsWith(".jsx")
    || normalizedPath.endsWith(".css") || normalizedPath.endsWith(".scss") || normalizedPath.endsWith(".less")
  ) {
    if (/[;{}]/.test(text) || /\b(function|const|let|var|export|import|class)\b/.test(text)) return text;
    return "";
  }

  return text.includes("\n") ? text : "";
}

function buildFallbackTemplateForTarget(pathValue, prompt, beforeContent = "") {
  return buildStructuralEditFallback(pathValue, prompt, beforeContent);
}

function extractProposalTargetPaths(run, action) {
  const payloadPaths = Array.isArray(action?.payload?.paths) ? action.payload.paths : [];
  return dedupePaths([action?.payload?.path, ...payloadPaths, run.activeFilePath, ...(run.selectedPaths || [])]
    .map((entry) => ensureRunWorkspacePath(run, entry))).slice(0, 3);
}

async function generateAssistantWriteProposal(run, targetPath, action, credentials = {}, contextSeedPaths = []) {
  const safeTargetPath = toSafePath(targetPath);
  if (!safeTargetPath) return null;

  let beforeContent = "";
  try {
    const opened = await openWorkspaceFileWithFallback(safeTargetPath, "original");
    beforeContent = String(opened?.content || "");
  } catch (error) {
    const message = String(error?.message || "");
    if (!/not found/i.test(message)) throw error;
  }

  let nextContent = "";
  const contextPaths = dedupePaths([safeTargetPath, ...contextSeedPaths, run.activeFilePath, ...(run.selectedPaths || [])]).slice(0, 3);
  const contextEntries = await loadPlainContextEntries(contextPaths, { maxFiles: Math.min(3, contextPaths.length || 1), maxChars: 18000 });
  const contextBlock = buildPlainContextBlock(contextEntries);
  const opsContext = buildOpsContextSnippet(run.opsSelection || {});
  const instruction = String(action?.payload?.instruction || run.prompt || "").trim();

  try {
    const routed = await runModelChat({
      model: run.model,
      credentials,
      messages: [
        {
          role: "user",
          content: [
            "You are Mesh AI edit mode.",
            `Return exactly one full-file code block for ${safeTargetPath}.`,
            "Do not return unified diff format.",
            "Preserve valid syntax and produce the final file contents only inside the code block.",
            `Instruction: ${instruction}`,
            contextBlock,
            opsContext,
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });
    const block = extractFirstFencedCodeBlock(routed.content || "");
    if (block?.code) nextContent = block.code;
    if (!nextContent) {
      nextContent = extractDirectProposalContent(safeTargetPath, routed.content || "");
    }
  } catch {
    // Fall back to a safe template.
  }

  if (!nextContent) {
    nextContent = buildFallbackTemplateForTarget(safeTargetPath, instruction, beforeContent);
  }

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

async function generateAssistantWriteBatch(run, action, credentials = {}) {
  const targetPaths = extractProposalTargetPaths(run, action);
  if (!targetPaths.length) {
    throw new Error("No target file available for write proposal.");
  }

  const proposals = [];
  for (const targetPath of targetPaths) {
    const proposal = await generateAssistantWriteProposal(run, targetPath, action, credentials, targetPaths);
    if (!proposal || proposal.noChanges) continue;
    proposals.push(proposal);
  }

  if (!proposals.length) {
    return { noChanges: true, targetPaths };
  }

  const batchId = `batch-${run.id}-${run.artifacts.proposalBatches.length + 1}`;
  const batch = {
    id: batchId,
    status: "pending",
    createdAt: toIsoNow(),
    proposals: proposals.map((proposal, index) => ({
      id: `proposal-${run.id}-${run.artifacts.proposalBatches.length + 1}-${index + 1}`,
      path: proposal.path,
      beforeContent: proposal.beforeContent,
      nextContent: proposal.nextContent,
      diff: proposal.diff,
      lineDelta: proposal.lineDelta,
      status: "pending",
    })),
  };

  run.artifacts.proposalBatches.push(batch);
  run.artifacts.latestBatchId = batchId;
  touchRunEntity(run);
  return batch;
}

function resolveRunBatch(run, batchIdInput) {
  const batchId = String(batchIdInput || "").trim();
  if (!batchId || batchId === "latest-proposal") {
    return run.artifacts.proposalBatches.find((batch) => batch.id === run.artifacts.latestBatchId) || null;
  }
  return run.artifacts.proposalBatches.find((batch) => batch.id === batchId) || null;
}

function resolveRunProposal(batch, proposalIdInput) {
  const proposalId = String(proposalIdInput || "").trim();
  if (!proposalId) return null;
  return (batch?.proposals || []).find((proposal) => proposal.id === proposalId) || null;
}

function syncBatchStatusFromProposals(batch) {
  const proposals = Array.isArray(batch?.proposals) ? batch.proposals : [];
  if (!proposals.length) {
    batch.status = "pending";
    return batch.status;
  }

  const statuses = proposals.map((proposal) => String(proposal?.status || "pending"));
  if (statuses.every((status) => status === "applied")) {
    batch.status = "applied";
    return batch.status;
  }
  if (statuses.every((status) => status === "rejected")) {
    batch.status = "rejected";
    return batch.status;
  }
  if (statuses.some((status) => status === "failed")) {
    batch.status = "partial";
    return batch.status;
  }
  if (statuses.some((status) => status === "applied" || status === "rejected")) {
    batch.status = "partial";
    return batch.status;
  }
  batch.status = "pending";
  return batch.status;
}

function ensureApplyBatchActionForRun(run, batch) {
  if (!batch?.id) return null;
  const existing = run.actions.find((action) => action.type === "apply_write_batch"
    && String(action?.payload?.batchId || "") === batch.id
    && !String(action?.payload?.proposalId || "").trim());
  if (existing) return existing;

  const action = normalizeRunActionState({
    id: `action-${run.actions.length + 1}`,
    type: "apply_write_batch",
    title: `Apply changes for ${batch.proposals.length} file${batch.proposals.length === 1 ? "" : "s"}`,
    payload: { batchId: batch.id },
  }, run.actions.length);
  run.actions.push(action);
  touchRunEntity(run);
  return action;
}

function ensureApplyProposalActionsForBatch(run, batch) {
  if (!batch?.id || !Array.isArray(batch?.proposals)) return [];
  const created = [];
  for (const proposal of batch.proposals) {
    const existing = run.actions.find((action) => action.type === "apply_write_batch"
      && String(action?.payload?.batchId || "") === batch.id
      && String(action?.payload?.proposalId || "") === proposal.id);
    if (existing) {
      created.push(existing);
      continue;
    }

    const action = normalizeRunActionState({
      id: `action-${run.actions.length + 1}`,
      type: "apply_write_batch",
      title: `Apply changes for ${basename(proposal.path)}`,
      payload: { batchId: batch.id, proposalId: proposal.id },
    }, run.actions.length);
    run.actions.push(action);
    created.push(action);
  }
  touchRunEntity(run);
  return created;
}

function buildActionResultSummary(action) {
  if (action.status === "failed") return `${action.title}: failed (${action.error || "unknown error"})`;
  if (action.status === "rejected") return `${action.title}: rejected`;
  if (action.status === "requires_approval") return `${action.title}: awaiting approval`;
  if (action.type === "search_workspace") {
    return `${action.title}: ${Number(action.result?.total || action.result?.matches?.length || 0)} matches`;
  }
  if (action.type === "read_file" || action.type === "read_capsule" || action.type === "open_file") {
    return `${action.title}: ${String(action.result?.path || action.payload?.path || "")}`;
  }
  if (action.type === "recover_spans") {
    return `${action.title}: ${Number(action.result?.spans?.length || 0)} spans`;
  }
  if (action.type === "propose_write") {
    return action.result?.noChanges
      ? `${action.title}: no changes required`
      : `${action.title}: prepared batch ${String(action.result?.batchId || "")}`;
  }
  if (action.type === "apply_write_batch") {
    if (action.result?.path) {
      return `${action.title}: applied ${String(action.result.path)}`;
    }
    return `${action.title}: ${Number(action.result?.appliedCount || 0)} operation(s) applied`;
  }
  if (action.type === "run_terminal_command") {
    return `${action.title}: ${String(action.result?.command || action.payload?.command || "")}`;
  }
  if (action.type === "summarize_ops_context") {
    return `${action.title}: ${Number(action.result?.pendingDeployments || 0)} pending deployments`;
  }
  return `${action.title}: ${action.status}`;
}

function buildFallbackAssistantRunReply(run) {
  const parts = [];
  const referencedPaths = dedupePaths([
    run.activeFilePath,
    ...(run.artifacts?.referencedFiles || []),
    ...(run.selectedPaths || []),
  ]).filter(Boolean);
  const proposalBatches = Array.isArray(run.artifacts?.proposalBatches) ? run.artifacts.proposalBatches : [];
  const proposalCount = proposalBatches.reduce((sum, batch) => sum + Number(batch?.proposals?.length || 0), 0);
  const approvalCount = run.actions.filter((action) => action.status === "requires_approval").length;
  const failedCount = run.actions.filter((action) => action.status === "failed").length;

  if (referencedPaths.length) {
    const label = referencedPaths.length === 1 ? "file" : "files";
    parts.push(`Reviewed ${label} ${referencedPaths.slice(0, 3).map((entry) => `\`${entry}\``).join(", ")}.`);
  } else if (run.summary) {
    parts.push(run.summary);
  } else {
    parts.push("Run completed.");
  }

  if (proposalCount > 0) {
    const noun = proposalCount === 1 ? "change" : "changes";
    if (approvalCount > 0) {
      parts.push(`Prepared ${proposalCount} ${noun} and left them in the Changes tab for review.`);
    } else {
      parts.push(`Prepared ${proposalCount} ${noun}.`);
    }
  } else if (run.actions.some((action) => action.type === "propose_write" && action.result?.noChanges)) {
    parts.push("No safe structural edit was available from the fallback path.");
  }

  if (run.artifacts?.lastSearch) {
    parts.push(`Search found ${Number(run.artifacts.lastSearch.total || run.artifacts.lastSearch.matches?.length || 0)} result(s).`);
  }

  if (Array.isArray(run.artifacts?.capsuleReads) && run.artifacts.capsuleReads.length > 0) {
    parts.push(`Loaded ${run.artifacts.capsuleReads.length} capsule view${run.artifacts.capsuleReads.length === 1 ? "" : "s"}.`);
  }

  if (Array.isArray(run.artifacts?.recoveredSpans) && run.artifacts.recoveredSpans.length > 0) {
    parts.push(`Recovered ${run.artifacts.recoveredSpans.length} raw span${run.artifacts.recoveredSpans.length === 1 ? "" : "s"} for exact detail.`);
  }

  if (run.artifacts?.terminalSessionId) {
    parts.push("Terminal output is available in the Terminal tab.");
  }

  if (run.artifacts?.opsSummary) {
    parts.push(`Ops snapshot: ${Number(run.artifacts.opsSummary.pendingDeployments || 0)} pending deployments and ${Number(run.artifacts.opsSummary.policies || 0)} policies.`);
  }

  if (failedCount > 0) {
    parts.push(`${failedCount} action${failedCount === 1 ? "" : "s"} need attention.`);
  }

  return parts.join(" ").trim() || "Run completed without additional actions.";
}

async function summarizeAssistantRun(run, credentials = {}) {
  const actionDigest = run.actions.map((action) => buildActionResultSummary(action)).join("\n");
  const proposalDigest = run.artifacts.proposalBatches
    .map((batch) => `${batch.id}: ${batch.proposals.map((proposal) => proposal.path).join(", ")} (${batch.status})`)
    .join("\n");
  const capsuleDigest = (run.artifacts.capsuleReads || [])
    .map((entry) => `<capsule path="${escapeTagAttribute(entry.path)}">\n${String(entry.excerpt || "").slice(0, 8000)}\n</capsule>`)
    .join("\n\n");
  const recoveredDigest = (run.artifacts.recoveredSpans || [])
    .map((entry) => `<span path="${escapeTagAttribute(entry.path)}" id="${escapeTagAttribute(entry.spanId)}" line_start="${Number(entry.lineStart || 0)}" line_end="${Number(entry.lineEnd || 0)}">\n${String(entry.text || "").slice(0, 4000)}\n</span>`)
    .join("\n\n");

  try {
    if (!proposalDigest && (capsuleDigest || recoveredDigest || run.artifacts.opsSummary)) {
      const answer = await runModelChat({
        model: run.model,
        credentials,
        messages: [
          {
            role: "user",
            content: [
              "Answer the original Mesh AI request directly.",
              "Use capsule context first and recovered spans for exact details.",
              "When making exact claims, include the relevant span ids.",
              `Original request: ${run.prompt}`,
              capsuleDigest ? `Capsules:\n${capsuleDigest}` : "",
              recoveredDigest ? `Recovered spans:\n${recoveredDigest}` : "",
              run.artifacts.opsSummary ? `Ops summary:\n${JSON.stringify(run.artifacts.opsSummary, null, 2)}` : "",
            ].filter(Boolean).join("\n\n"),
          },
        ],
      });
      const directContent = String(answer.content || "").trim();
      if (directContent) return directContent;
    }

    const routed = await runModelChat({
      model: run.model,
      credentials,
      messages: [
        {
          role: "user",
          content: [
            "Summarize this Mesh AI run for the operator in 4 lines max.",
            `Original request: ${run.prompt}`,
            `Run mode: ${run.mode}`,
            `Autonomy mode: ${run.autonomyMode}`,
            `Action results:\n${actionDigest || "none"}`,
            proposalDigest ? `Proposal batches:\n${proposalDigest}` : "",
          ].filter(Boolean).join("\n\n"),
        },
      ],
    });
    const content = String(routed.content || "").trim();
    if (content) return content;
  } catch {
    // fall through
  }

  return buildFallbackAssistantRunReply(run);
}

async function executeAssistantRunAction(run, action, credentials = {}) {
  action.error = "";
  action.result = null;
  action.approvalRequired = false;
  action.status = "running";
  touchRunEntity(action);
  touchRunEntity(run);

  try {
    if (action.type === "search_workspace") {
      const result = await searchWorkspaceWithFallback(action.payload.q, action.payload);
      action.result = result;
      run.artifacts.lastSearch = cloneJsonValue(result);
      run.artifacts.referencedFiles = Array.isArray(result?.matches) ? result.matches.map((entry) => entry.path) : [];
      action.status = "completed";
      return;
    }

    if (action.type === "read_file" || action.type === "open_file") {
      const opened = await openWorkspaceFileWithFallback(action.payload.path, "original");
      action.result = {
        path: opened.path,
        excerpt: String(opened.content || "").slice(0, 12000),
        originalSize: Number(opened.originalSize || 0),
      };
      run.artifacts.referencedFiles = dedupePaths([...(run.artifacts.referencedFiles || []), opened.path]);
      action.status = "completed";
      return;
    }

    if (action.type === "read_capsule") {
      const opened = await openWorkspaceFileWithFallback(action.payload.path, action.payload.query ? "focused" : "capsule", {
        query: action.payload.query || run.prompt,
      });
      action.result = {
        path: opened.path,
        capsuleMode: String(opened?.capsule?.capsuleMode || opened?.capsuleMode || ""),
        fileType: String(opened?.fileType || ""),
        parserFamily: String(opened?.parserFamily || ""),
        excerpt: String(opened.content || "").slice(0, 16000),
        recoveryEligible: Boolean(opened?.capsule?.recoveryEligible),
      };
      run.artifacts.referencedFiles = dedupePaths([...(run.artifacts.referencedFiles || []), opened.path]);
      run.artifacts.capsuleReads = [
        ...(Array.isArray(run.artifacts.capsuleReads) ? run.artifacts.capsuleReads : []),
        cloneJsonValue(action.result),
      ].slice(-8);
      action.status = "completed";
      return;
    }

    if (action.type === "recover_spans") {
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
      action.status = "completed";
      return;
    }

    if (action.type === "summarize_ops_context") {
      const snapshot = snapshotOperationsPayload();
      action.result = {
        pendingDeployments: snapshot.deployments?.pending?.length || 0,
        policies: Array.isArray(snapshot.policies) ? snapshot.policies.length : 0,
        recentLogs: Array.isArray(snapshot.logs) ? snapshot.logs.slice(-8) : [],
      };
      run.artifacts.opsSummary = cloneJsonValue(action.result);
      action.status = "completed";
      return;
    }

    if (action.type === "propose_write") {
      const batch = await generateAssistantWriteBatch(run, action, credentials);
      if (batch?.noChanges) {
        action.result = { noChanges: true, paths: batch.targetPaths || [] };
        action.status = "completed";
        return;
      }
      for (const entry of run.actions) {
        if (entry.type !== "apply_write_batch") continue;
        if (String(entry?.payload?.batchId || "") !== "latest-proposal") continue;
        entry.payload.batchId = batch.id;
        touchRunEntity(entry);
      }
      const hasExplicitBatchApply = run.actions.some((entry) => entry.type === "apply_write_batch"
        && entry.id !== action.id
        && ["latest-proposal", batch.id].includes(String(entry?.payload?.batchId || ""))
        && !String(entry?.payload?.proposalId || "").trim());
      if ((batch.proposals || []).length > 1 && !hasExplicitBatchApply) ensureApplyProposalActionsForBatch(run, batch);
      else ensureApplyBatchActionForRun(run, batch);
      action.result = {
        batchId: batch.id,
        proposalCount: batch.proposals.length,
        paths: batch.proposals.map((proposal) => proposal.path),
      };
      action.status = "completed";
      return;
    }

    if (action.type === "apply_write_batch") {
      const batch = resolveRunBatch(run, action.payload.batchId);
      if (!batch) throw new Error("Proposal batch not found.");
      const targetedProposal = resolveRunProposal(batch, action.payload.proposalId);
      const targetProposals = targetedProposal
        ? [targetedProposal]
        : (batch.proposals || []).filter((proposal) => String(proposal?.status || "pending") === "pending");
      if (!targetProposals.length) {
        action.result = {
          ok: true,
          appliedCount: 0,
          path: targetedProposal?.path || "",
          skipped: true,
        };
        action.status = "completed";
        syncBatchStatusFromProposals(batch);
        return;
      }

      const operations = targetProposals.map((proposal) => ({
        type: "write",
        path: proposal.path,
        content: proposal.nextContent,
      }));
      const applied = await applyWorkspaceBatchWithFallback(operations, { stopOnError: true });
      for (const proposal of targetProposals) {
        proposal.status = applied.ok ? "applied" : "failed";
      }
      syncBatchStatusFromProposals(batch);
      action.result = applied;
      action.result.appliedCount = Number(applied?.appliedCount || targetProposals.length);
      if (targetedProposal) {
        action.result.path = targetedProposal.path;
        action.result.proposalId = targetedProposal.id;
      }
      action.status = applied.ok ? "completed" : "failed";
      if (!applied.ok) action.error = "Batch apply failed.";
      return;
    }

    if (action.type === "run_terminal_command") {
      let sessionId = String(action.payload.terminalSessionId || run.artifacts.terminalSessionId || run.terminalSessionId || "").trim();
      if (!sessionId) {
        const created = createAssistantTerminalSession({});
        sessionId = String(created?.session?.id || "");
      }
      const session = getAssistantTerminalSession(sessionId);
      const since = session ? session.cursor : 0;
      writeAssistantTerminalInput(sessionId, `${String(action.payload.command || "").trim()}\n`);
      const output = listAssistantTerminalOutput(sessionId, since);
      run.artifacts.terminalSessionId = sessionId;
      action.result = {
        sessionId,
        command: String(action.payload.command || "").trim(),
        cursor: output.cursor,
        entries: output.entries,
      };
      action.status = "completed";
      return;
    }

    action.status = "failed";
    action.error = `Unsupported action type "${action.type}".`;
  } catch (error) {
    action.status = "failed";
    action.error = String(error?.message || "Action failed");
  } finally {
    touchRunEntity(action);
    touchRunEntity(run);
  }
}

async function continueAssistantRun(run, credentials = {}) {
  run.status = "running";
  touchRunEntity(run);

  for (const action of run.actions) {
    if (action.status !== "pending") continue;

    if (action.type === "apply_write_batch" || action.type === "run_terminal_command") {
      const payload = action.type === "run_terminal_command"
        ? { command: action.payload.command }
        : action.payload;
      if (!shouldAutoApplyAction(action.type, run.autonomyMode, payload)) {
        action.status = "requires_approval";
        action.approvalRequired = true;
        touchRunEntity(action);
        continue;
      }
    }

    await executeAssistantRunAction(run, action, credentials);
  }

  run.reply = await summarizeAssistantRun(run, credentials);
  run.status = run.actions.some((action) => action.status === "requires_approval")
    ? "awaiting_approval"
    : (run.actions.some((action) => action.status === "failed") ? "completed_with_errors" : "completed");
  touchRunEntity(run);
  return run;
}

async function createAssistantRun(input = {}, credentials = {}) {
  const planMeta = await planAssistantRun({ ...input, credentials });
  const run = createAssistantRunRecord(input, planMeta);
  assistantRuns.set(run.id, run);

  if (!run.actions.length) {
    const normalizedMessages = normalizeMessages([{ role: "user", content: run.prompt }]);
    try {
      const fallback = await runModelChat({
        model: run.model,
        messages: normalizedMessages,
        credentials,
      });
      run.reply = String(fallback.content || "").trim() || "No response.";
      run.planSource = "legacy-chat";
      run.artifacts.chatFallback = {
        model: fallback.model,
        provider: fallback.provider,
      };
    } catch {
      const legacy = await localAssistantReply(run.model, normalizedMessages);
      run.reply = String(legacy?.content || "").trim() || "No response.";
      run.planSource = "legacy-chat";
      run.artifacts.chatFallback = cloneJsonValue(legacy);
    }
    run.status = "completed";
    touchRunEntity(run);
    return run;
  }

  await continueAssistantRun(run, credentials);
  return run;
}

async function applyAssistantRunDecision(run, action, decision, credentials = {}) {
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  if (!["approve", "reject", "retry"].includes(normalizedDecision)) {
    throw new Error("Decision must be approve, reject, or retry.");
  }

  if (normalizedDecision === "reject") {
    if (action.type === "apply_write_batch") {
      const batch = resolveRunBatch(run, action.payload.batchId);
      if (batch) {
        const targetedProposal = resolveRunProposal(batch, action.payload.proposalId);
        if (targetedProposal) targetedProposal.status = "rejected";
        else {
          for (const proposal of batch.proposals || []) {
            if (String(proposal?.status || "pending") === "pending") proposal.status = "rejected";
          }
        }
        syncBatchStatusFromProposals(batch);
      }
    }
    action.status = "rejected";
    action.approvalRequired = false;
    touchRunEntity(action);
    run.reply = await summarizeAssistantRun(run, credentials);
    run.status = run.actions.some((entry) => entry.status === "requires_approval") ? "awaiting_approval" : "completed";
    touchRunEntity(run);
    return run;
  }

  action.status = "pending";
  action.approvalRequired = false;
  touchRunEntity(action);
  await executeAssistantRunAction(run, action, credentials);
  await continueAssistantRun(run, credentials);
  return run;
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
  resolveAssistantCandidatePaths,
  buildHeuristicAssistantRunPlan,
  planAssistantRunWithModel,
  planAssistantRun,
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
  buildActionResultSummary,
  buildFallbackAssistantRunReply,
  summarizeAssistantRun,
  executeAssistantRunAction,
  continueAssistantRun,
  createAssistantRun,
  applyAssistantRunDecision,
};
