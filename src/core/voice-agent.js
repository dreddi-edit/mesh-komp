'use strict';

const crypto = require('crypto');
const {
  normalizeAutonomyMode,
} = require('../../assistant-core');

const DEFAULT_VOICE_AUTONOMY_MODE = 'auto_edit_confirm_run';

function safeClone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function trimText(value) {
  return String(value || '').trim();
}

function truncateText(value, limit = 4000) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n\n[truncated for voice context]`;
}

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickPrompt(args = {}) {
  return trimText(args.prompt || args.task || args.request || args.query || args.message || '');
}

function summarizeSearchMatches(result) {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return matches.slice(0, 8).map((entry) => ({
    path: String(entry?.path || ''),
    lineNumber: Number(entry?.lineNumber || 0),
    preview: truncateText(entry?.preview || entry?.line || '', 180),
  }));
}

function summarizeGitStatus(result) {
  const files = []
    .concat(Array.isArray(result?.staged) ? result.staged.map((path) => ({ path, bucket: 'staged' })) : [])
    .concat(Array.isArray(result?.unstaged) ? result.unstaged.map((path) => ({ path, bucket: 'unstaged' })) : [])
    .concat(Array.isArray(result?.untracked) ? result.untracked.map((path) => ({ path, bucket: 'untracked' })) : []);
  return {
    branch: String(result?.branch || ''),
    ahead: Number(result?.ahead || 0),
    behind: Number(result?.behind || 0),
    files: files.slice(0, 20),
  };
}

function voiceToolDefinitions() {
  return [
    {
      type: 'function',
      name: 'delegate_task',
      description: 'Delegate a multi-step coding task to the full Mesh coding agent. Use this for fixes, refactors, debugging, or any task that may need multiple tools.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The concrete coding task to execute.' },
        },
        required: ['prompt'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'get_run_status',
      description: 'Fetch the status of the current or a specific delegated agent run.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'string', description: 'Optional Mesh run id. Defaults to the current voice run.' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'approve_action',
      description: 'Approve the pending run action after the operator has explicitly approved it.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          action_id: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'reject_action',
      description: 'Reject the pending run action after the operator has explicitly rejected it.',
      parameters: {
        type: 'object',
        properties: {
          run_id: { type: 'string' },
          action_id: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'read_file',
      description: 'Read the original contents of a file from the workspace. Use only for short, targeted reads.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'read_capsule',
      description: 'Read the compressed or focused capsule view of a file for fast code understanding.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          query: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'recover_spans',
      description: 'Recover exact source spans or focused ranges from a file when precise implementation details are needed.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          query: { type: 'string' },
          span_ids: { type: 'array', items: { type: 'string' } },
          ranges: { type: 'array', items: { type: 'object' } },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'search_workspace',
      description: 'Search the workspace by content or file relevance.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'integer' },
        },
        required: ['query'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'open_file',
      description: 'Open a file in the Mesh editor UI.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'git_status',
      description: 'Inspect current git status for the active workspace.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'git_diff',
      description: 'Inspect git diff for a path or the current workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'run_terminal_command',
      description: 'Run an explicit terminal command through the Mesh agent workflow.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string' },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
    {
      type: 'function',
      name: 'edit_file',
      description: 'Compatibility fallback for a direct full-file overwrite when explicitly necessary.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
  ];
}

function voiceChatToolDefinitions() {
  return voiceToolDefinitions().map((tool) => ({
    type: 'function',
    function: {
      name: String(tool?.name || ''),
      description: String(tool?.description || ''),
      parameters: tool?.parameters || {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  }));
}

function buildVoiceInstructions(state, capsuleContext = '') {
  return [
    'You are Mesh Voice, the spoken interface for the Mesh coding agent.',
    'Use direct read/search/open tools for short factual lookups.',
    'Use delegate_task for any multi-step coding, debugging, refactoring, or terminal-heavy work.',
    'Be concise and natural in speech. Keep spoken updates short and put detail into tool outputs and UI state.',
    'When a tool reports that approval is required, ask the user for approval instead of improvising.',
    state?.selectedCodingModel ? `Delegate coding work using model ${state.selectedCodingModel}.` : '',
    capsuleContext ? `\nWorkspace context:\n${capsuleContext}` : '',
  ].filter(Boolean).join('\n');
}

function createVoiceAgentSession(options = {}) {
  const deps = options.deps || {};
  const sendClientEvent = typeof options.sendClientEvent === 'function' ? options.sendClientEvent : () => {};
  const sendAzureEvent = typeof options.sendAzureEvent === 'function' ? options.sendAzureEvent : () => {};

  const state = {
    voiceSessionId: `voice-${Date.now()}-${crypto.randomUUID()}`,
    authUserId: options.authUserId || '',
    selectedCodingModel: trimText(options.selectedCodingModel || deps.MESH_DEFAULT_MODEL || 'gpt-5.4-mini'),
    autonomyMode: normalizeAutonomyMode(options.autonomyMode, DEFAULT_VOICE_AUTONOMY_MODE),
    workspaceFolderName: trimText(options.workspaceFolderName || ''),
    workspaceId: trimText(options.workspaceId || ''),
    sessionId: trimText(options.sessionId || ''),
    activeFilePath: trimText(options.activeFilePath || ''),
    selectedPaths: Array.isArray(options.selectedPaths) ? options.selectedPaths.map((entry) => deps.toSafePath ? deps.toSafePath(entry) : trimText(entry)).filter(Boolean) : [],
    currentRunId: '',
    pendingActionIds: new Set(),
    recentToolResults: [],
  };

  function rememberToolResult(name, summary) {
    state.recentToolResults.unshift({
      name: String(name || ''),
      summary: compactWhitespace(summary || ''),
      at: new Date().toISOString(),
    });
    if (state.recentToolResults.length > 12) state.recentToolResults.length = 12;
  }

  function snapshotRun(run) {
    if (!run) return null;
    return typeof deps.assistantRunSnapshot === 'function'
      ? deps.assistantRunSnapshot(run)
      : safeClone(run);
  }

  function listPendingApprovalActions(run) {
    return (run?.actions || []).filter((action) => action?.status === 'requires_approval');
  }

  function registerPendingActions(run) {
    state.pendingActionIds.clear();
    for (const action of listPendingApprovalActions(run)) {
      state.pendingActionIds.add(String(action.id || ''));
    }
  }

  function buildRunEventPayload(type, run, extra = {}) {
    return {
      type,
      run: snapshotRun(run),
      currentRunId: state.currentRunId || '',
      selectedCodingModel: state.selectedCodingModel,
      autonomyMode: state.autonomyMode,
      ...extra,
    };
  }

  function emitRunLifecycle(run, forceComplete = false) {
    if (!run) return;
    state.currentRunId = String(run.id || state.currentRunId || '');
    registerPendingActions(run);

    sendClientEvent(buildRunEventPayload('voice.run.updated', run, {
      pendingActionIds: Array.from(state.pendingActionIds),
    }));

    for (const action of listPendingApprovalActions(run)) {
      sendClientEvent({
        type: 'voice.action.requires_approval',
        runId: String(run.id || ''),
        action: safeClone(action),
      });
    }

    const isComplete = forceComplete || ['completed', 'completed_with_errors'].includes(String(run.status || ''));
    if (listPendingApprovalActions(run).length) {
      sendClientEvent({
        type: 'voice.narration',
        text: 'I prepared an action that needs your approval before I continue.',
        appendToChat: false,
      });
    }
    if (isComplete) {
      sendClientEvent(buildRunEventPayload('voice.run.completed', run, {
        pendingActionIds: Array.from(state.pendingActionIds),
      }));
      if (trimText(run.reply)) {
        sendClientEvent({
          type: 'voice.narration',
          text: trimText(run.reply),
          appendToChat: false,
        });
      }
    }
  }

  async function resolveCredentials() {
    const stored = typeof deps.getStoredCredentialsForUser === 'function'
      ? await deps.getStoredCredentialsForUser(state.authUserId)
      : {};
    return typeof deps.mergeChatCredentials === 'function'
      ? deps.mergeChatCredentials(stored)
      : (stored || {});
  }

  function updateConfig(config = {}) {
    if (config.selectedCodingModel) state.selectedCodingModel = trimText(config.selectedCodingModel);
    if (config.autonomyMode) state.autonomyMode = normalizeAutonomyMode(config.autonomyMode, state.autonomyMode || DEFAULT_VOICE_AUTONOMY_MODE);
    if (config.workspaceFolderName !== undefined) state.workspaceFolderName = trimText(config.workspaceFolderName);
    if (config.workspaceId !== undefined) state.workspaceId = trimText(config.workspaceId);
    if (config.sessionId !== undefined) state.sessionId = trimText(config.sessionId);
    if (config.activeFilePath !== undefined) state.activeFilePath = trimText(config.activeFilePath);
    if (Array.isArray(config.selectedPaths)) {
      state.selectedPaths = config.selectedPaths
        .map((entry) => deps.toSafePath ? deps.toSafePath(entry) : trimText(entry))
        .filter(Boolean);
    }

    sendClientEvent({
      type: 'voice.session.configured',
      voiceSessionId: state.voiceSessionId,
      selectedCodingModel: state.selectedCodingModel,
      autonomyMode: state.autonomyMode,
      workspaceFolderName: state.workspaceFolderName,
      workspaceId: state.workspaceId,
      sessionId: state.sessionId,
      activeFilePath: state.activeFilePath,
      selectedPaths: state.selectedPaths,
    });
  }

  function buildSessionUpdate(capsuleContext, realtimeProfile = {}, options = {}) {
    const instructions = buildVoiceInstructions(state, capsuleContext);

    const stripped = !!options?.stripped;
    const omittedFields = new Set(Array.isArray(options?.omitSessionFields) ? options.omitSessionFields.map((entry) => trimText(entry)).filter(Boolean) : []);
    const session = {
      instructions,
      input_audio_format: 'pcm16',
      output_audio_format: 'pcm16',
    };

    if (!omittedFields.has('voice')) {
      session.voice = trimText(realtimeProfile.voice || 'alloy');
    }
    if (!omittedFields.has('input_audio_transcription')) {
      session.input_audio_transcription = { model: 'whisper-1' };
    }
    if (!omittedFields.has('turn_detection')) {
      session.turn_detection = {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
        create_response: true,
      };
    }
    if (!omittedFields.has('tools')) {
      session.tools = voiceToolDefinitions();
    }
    if (!omittedFields.has('tool_choice')) {
      session.tool_choice = 'auto';
    }

    if (realtimeProfile?.requireSessionType && !omittedFields.has('type')) {
      session.type = 'realtime';
    }
    if (realtimeProfile?.includeSessionModel && trimText(realtimeProfile.deployment) && !omittedFields.has('model')) {
      session.model = trimText(realtimeProfile.deployment);
    }

    if (!stripped) {
      if (!omittedFields.has('temperature')) {
        session.temperature = 0.7;
      }
      if (!omittedFields.has('max_response_output_tokens')) {
        session.max_response_output_tokens = 1200;
      }
    }

    return { type: 'session.update', session };
  }

  async function createDelegatedRun(prompt, overrides = {}) {
    const finalPrompt = trimText(prompt);
    if (!finalPrompt) {
      return { ok: false, error: 'A delegated task prompt is required.' };
    }

    const credentials = await resolveCredentials();
    sendClientEvent({
      type: 'voice.run.started',
      voiceSessionId: state.voiceSessionId,
      selectedCodingModel: state.selectedCodingModel,
      prompt: finalPrompt,
    });
    sendClientEvent({
      type: 'voice.narration',
      text: 'I am delegating this to the full Mesh coding agent.',
      appendToChat: false,
    });

    const run = await deps.createAssistantRun({
      model: trimText(overrides.model || state.selectedCodingModel || deps.MESH_DEFAULT_MODEL || 'gpt-5.4-mini'),
      mode: trimText(overrides.mode || 'agent'),
      autonomyMode: normalizeAutonomyMode(overrides.autonomyMode, state.autonomyMode || DEFAULT_VOICE_AUTONOMY_MODE),
      prompt: finalPrompt,
      workspaceFolderName: trimText(overrides.workspaceFolderName || state.workspaceFolderName),
      activeFilePath: trimText(overrides.activeFilePath || state.activeFilePath),
      selectedPaths: Array.isArray(overrides.selectedPaths) ? overrides.selectedPaths : state.selectedPaths,
      terminalSessionId: trimText(overrides.terminalSessionId || ''),
      chatSessionId: `voice-${state.voiceSessionId}`,
    }, credentials);

    state.currentRunId = String(run.id || '');
    emitRunLifecycle(run, ['completed', 'completed_with_errors'].includes(String(run.status || '')));

    const pending = listPendingApprovalActions(run);
    const summary = compactWhitespace(run.reply || run.summary || '');
    rememberToolResult('delegate_task', summary || `Run ${run.id} created`);

    return {
      ok: true,
      runId: String(run.id || ''),
      status: String(run.status || ''),
      reply: summary,
      pendingApprovals: pending.map((action) => ({
        id: String(action.id || ''),
        title: String(action.title || ''),
        type: String(action.type || ''),
      })),
      actions: (run.actions || []).map((action) => ({
        id: String(action.id || ''),
        type: String(action.type || ''),
        title: String(action.title || ''),
        status: String(action.status || ''),
      })),
    };
  }

  async function resolveRunAction(decision, args = {}, origin = 'tool') {
    const runId = trimText(args.run_id || args.runId || state.currentRunId);
    if (!runId) {
      return { ok: false, error: 'No delegated run is active.' };
    }

    const run = deps.assistantRuns?.get(runId);
    if (!run) {
      return { ok: false, error: `Run ${runId} was not found.` };
    }

    const actionId = trimText(args.action_id || args.actionId || listPendingApprovalActions(run)[0]?.id || '');
    if (!actionId) {
      return { ok: false, error: 'No pending action is available.' };
    }

    const action = (run.actions || []).find((entry) => String(entry.id || '') === actionId);
    if (!action) {
      return { ok: false, error: `Action ${actionId} was not found.` };
    }

    const credentials = await resolveCredentials();
    await deps.applyAssistantRunDecision(run, action, decision, credentials);
    emitRunLifecycle(run, ['completed', 'completed_with_errors'].includes(String(run.status || '')));

    sendClientEvent({
      type: 'voice.action.resolved',
      runId,
      actionId,
      decision,
      run: snapshotRun(run),
    });
    sendClientEvent({
      type: 'voice.narration',
      text: decision === 'approve'
        ? 'Approved. I am continuing the run now.'
        : 'Rejected. I will adjust based on that.',
      appendToChat: false,
    });

    const pending = listPendingApprovalActions(run);
    rememberToolResult(decision === 'approve' ? 'approve_action' : 'reject_action', `${decision}d ${action.title || actionId}`);

    return {
      ok: true,
      runId,
      actionId,
      status: String(run.status || ''),
      reply: compactWhitespace(run.reply || ''),
      pendingApprovals: pending.map((entry) => ({
        id: String(entry.id || ''),
        title: String(entry.title || ''),
        type: String(entry.type || ''),
      })),
    };
  }

  async function executeTool(name, args = {}) {
    const toolName = trimText(name);

    if (toolName === 'delegate_task') {
      return createDelegatedRun(pickPrompt(args));
    }

    if (toolName === 'run_terminal_command') {
      const command = trimText(args.command);
      if (!command) return { ok: false, error: 'Command required.' };
      return createDelegatedRun(`Run this exact terminal command and report the result:\n\n\`\`\`sh\n${command}\n\`\`\``);
    }

    if (toolName === 'get_run_status') {
      const runId = trimText(args.run_id || args.runId || state.currentRunId);
      if (!runId) return { ok: false, error: 'No delegated run is active.' };
      const run = deps.assistantRuns?.get(runId);
      if (!run) return { ok: false, error: `Run ${runId} was not found.` };
      const pending = listPendingApprovalActions(run);
      rememberToolResult('get_run_status', `Run ${runId} is ${run.status}`);
      return {
        ok: true,
        runId,
        status: String(run.status || ''),
        reply: compactWhitespace(run.reply || ''),
        pendingApprovals: pending.map((action) => ({
          id: String(action.id || ''),
          title: String(action.title || ''),
          type: String(action.type || ''),
        })),
        actions: (run.actions || []).map((action) => ({
          id: String(action.id || ''),
          type: String(action.type || ''),
          title: String(action.title || ''),
          status: String(action.status || ''),
        })),
      };
    }

    if (toolName === 'approve_action') {
      return resolveRunAction('approve', args);
    }

    if (toolName === 'reject_action') {
      return resolveRunAction('reject', args);
    }

    if (toolName === 'read_file') {
      const filePath = trimText(args.path);
      const opened = await deps.openWorkspaceFileWithFallback(filePath, 'original', {
        workspaceId: state.workspaceId,
        sessionId: state.sessionId,
      });
      rememberToolResult('read_file', `Read ${opened.path}`);
      return {
        ok: true,
        path: String(opened.path || filePath),
        excerpt: truncateText(opened.content || '', 5000),
        originalSize: Number(opened.originalSize || 0),
        fileType: String(opened.fileType || ''),
      };
    }

    if (toolName === 'read_capsule') {
      const filePath = trimText(args.path);
      const opened = await deps.openWorkspaceFileWithFallback(filePath, args.query ? 'focused' : 'capsule', {
        workspaceId: state.workspaceId,
        sessionId: state.sessionId,
        query: trimText(args.query),
      });
      rememberToolResult('read_capsule', `Read capsule for ${opened.path}`);
      return {
        ok: true,
        path: String(opened.path || filePath),
        excerpt: truncateText(opened.content || '', 5000),
        capsuleMode: String(opened?.capsule?.capsuleMode || opened?.capsuleMode || ''),
        recoveryEligible: Boolean(opened?.capsule?.recoveryEligible),
      };
    }

    if (toolName === 'recover_spans') {
      const filePath = trimText(args.path);
      const recovered = await deps.recoverWorkspaceWithFallback(filePath, {
        workspaceId: state.workspaceId,
        sessionId: state.sessionId,
        query: trimText(args.query),
        spanIds: Array.isArray(args.span_ids) ? args.span_ids : (Array.isArray(args.spanIds) ? args.spanIds : []),
        ranges: Array.isArray(args.ranges) ? args.ranges : [],
      });
      rememberToolResult('recover_spans', `Recovered spans for ${recovered.path}`);
      return {
        ok: true,
        path: String(recovered.path || filePath),
        spans: (Array.isArray(recovered.spans) ? recovered.spans : []).slice(0, 6).map((entry) => ({
          spanId: String(entry?.spanId || ''),
          lineStart: Number(entry?.lineStart || 0),
          lineEnd: Number(entry?.lineEnd || 0),
          text: truncateText(entry?.text || '', 800),
        })),
      };
    }

    if (toolName === 'search_workspace') {
      const query = trimText(args.query || args.q);
      const result = await deps.searchWorkspaceWithFallback(query, {
        workspaceId: state.workspaceId,
        sessionId: state.sessionId,
        limit: Math.min(Math.max(Number(args.limit) || 8, 1), 20),
      });
      const summary = summarizeSearchMatches(result);
      rememberToolResult('search_workspace', `${summary.length} match(es) for ${query}`);
      return {
        ok: true,
        total: Number(result?.total || summary.length),
        matches: summary,
      };
    }

    if (toolName === 'open_file') {
      const filePath = trimText(args.path);
      const opened = await deps.openWorkspaceFileWithFallback(filePath, 'original', {
        workspaceId: state.workspaceId,
        sessionId: state.sessionId,
      });
      sendClientEvent({ type: 'voice.file.open', path: String(opened.path || filePath) });
      rememberToolResult('open_file', `Opened ${opened.path}`);
      return {
        ok: true,
        path: String(opened.path || filePath),
        message: `Opened ${opened.path || filePath}`,
      };
    }

    if (toolName === 'git_status') {
      const result = await deps.runGitWithFallback('git.status', {}, () => deps.localGitStatus());
      const summary = summarizeGitStatus(result);
      rememberToolResult('git_status', `Git branch ${summary.branch || 'unknown'}`);
      return { ok: true, ...summary };
    }

    if (toolName === 'git_diff') {
      const filePath = trimText(args.path);
      const result = await deps.runGitWithFallback('git.diff', { path: filePath }, async () => {
        const normalized = deps.gitPathFromWorkspacePath(filePath);
        const diffArgs = ['diff'];
        const stagedArgs = ['diff', '--cached'];
        if (normalized) {
          diffArgs.push('--', normalized);
          stagedArgs.push('--', normalized);
        }
        const diff = await deps.runLocalGit(diffArgs);
        const staged = await deps.runLocalGit(stagedArgs);
        let beforeContent = '';
        let afterContent = '';
        if (normalized) {
          try {
            beforeContent = (await deps.runLocalGit(['show', `HEAD:${normalized}`])).stdout;
          } catch {
            beforeContent = '';
          }
          try {
            const workspacePath = deps.workspacePathFromGitPath(normalized) || filePath;
            if (workspacePath) {
              const target = deps.resolveLocalWorkspaceAbsolutePath(workspacePath);
              afterContent = await deps.readLocalWorkspaceFileText(target.absolutePath);
            }
          } catch {
            afterContent = '';
          }
        }
        return { ok: true, diff: diff.stdout, stagedDiff: staged.stdout, beforeContent, afterContent };
      });
      rememberToolResult('git_diff', filePath ? `Diff for ${filePath}` : 'Workspace diff');
      return {
        ok: true,
        path: filePath,
        diff: truncateText(result?.diff || '', 5000),
        stagedDiff: truncateText(result?.stagedDiff || '', 5000),
        beforeContent: truncateText(result?.beforeContent || '', 2500),
        afterContent: truncateText(result?.afterContent || '', 2500),
      };
    }

    if (toolName === 'edit_file') {
      const filePath = trimText(args.path);
      const content = typeof args.content === 'string' ? args.content : String(args.content || '');
      const before = await deps.openWorkspaceFileWithFallback(filePath, 'original');
      const updated = await deps.localWorkspaceSave(filePath, content, {});
      if (!updated?.ok) {
        return { ok: false, error: updated?.error || 'Save failed.' };
      }
      sendClientEvent({ type: 'voice.file.open', path: filePath });
      rememberToolResult('edit_file', `Saved ${filePath}`);
      return {
        ok: true,
        path: filePath,
        previousExcerpt: truncateText(before?.content || '', 1200),
        nextExcerpt: truncateText(content, 1200),
        message: `Saved ${filePath}`,
      };
    }

    return { ok: false, error: `Unsupported voice tool "${toolName}".` };
  }

  async function handleToolCall(event) {
    const callId = trimText(event?.call_id);
    const toolName = trimText(event?.name);
    let args = {};
    try {
      args = JSON.parse(event?.arguments || '{}');
    } catch {
      args = {};
    }

    let result;
    try {
      result = await executeTool(toolName, args);
    } catch (error) {
      result = { ok: false, error: String(error?.message || 'Voice tool failed') };
    }

    const output = JSON.stringify(result);

    return result;
  }

  async function handleClientMessage(message = {}) {
    const type = trimText(message.type);
    if (type === 'mesh.voice.configure') {
      updateConfig(message.config || message.settings || {});
      return { handled: true };
    }

    if (type === 'mesh.voice.approve_action') {
      const result = await resolveRunAction('approve', message);
      return { handled: true, result };
    }

    if (type === 'mesh.voice.reject_action') {
      const result = await resolveRunAction('reject', message);
      return { handled: true, result };
    }

    return { handled: false };
  }

  return {
    state,
    updateConfig,
    getContextSnapshot: () => ({
      workspaceFolderName: state.workspaceFolderName,
      workspaceId: state.workspaceId,
      sessionId: state.sessionId,
      activeFilePath: state.activeFilePath,
      selectedPaths: state.selectedPaths.slice(),
    }),
    buildInstructions: (capsuleContext = '') => buildVoiceInstructions(state, capsuleContext),
    buildSessionUpdate,
    executeTool,
    handleToolCall,
    handleClientMessage,
  };
}

module.exports = {
  DEFAULT_VOICE_AUTONOMY_MODE,
  voiceToolDefinitions,
  voiceChatToolDefinitions,
  buildVoiceInstructions,
  createVoiceAgentSession,
};
