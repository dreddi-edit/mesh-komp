const express = require('express');
const router = express.Router();

router.get("/api/assistant/status", requireAuth, async (_req, res) => {
  try {
    const result = await meshTunnelRequest("status", {});
    res.json(result);
  } catch (error) {
    res.json({
      ok: true,
      mode: "local-fallback",
      workspaceSelected: Boolean(localAssistantWorkspace.folderName || localAssistantWorkspace.workspaceId),
      workspaceFileCount: Number(localAssistantWorkspace.fileCountTotal || localAssistantWorkspace.files.size || 0),
      rootPath: localAssistantWorkspace.rootPath || "",
      workspaceId: localAssistantWorkspace.workspaceId || "",
      sessionId: localAssistantWorkspace.sessionId || "",
      sourceKind: normalizeWorkspaceSourceKind(localAssistantWorkspace.sourceKind),
      workspaceStatus: String(localAssistantWorkspace.status || ""),
      fileCountCompleted: Number(localAssistantWorkspace.fileCountCompleted || 0),
      fileCountPending: Number(localAssistantWorkspace.fileCountPending || 0),
      fileCountFailed: Number(localAssistantWorkspace.fileCountFailed || 0),
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    });
  }
});


router.get("/api/assistant/workspace/offload-config", requireAuth, (_req, res) => {
  res.json(workspaceOffloadClientConfig());
});


router.post("/api/assistant/workspace/offload/ingest", requireAuth, async (req, res) => {
  try {
    const result = await ingestWorkspaceChunkFromOffload(req.body || {}, {
      userId: req.authUser?.id,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "Offload ingest failed",
    });
  }
});


router.post("/api/assistant/workspace/select", requireAuth, async (req, res) => {
  try {
    const selectPayload = req.body || {};
    if (shouldQueueWorkspaceSelectPayload(selectPayload)) {
      const queuedJob = enqueueWorkspaceSelectJob(selectPayload, {
        userId: req.authUser?.id,
      });
      res.status(202).json(buildWorkspaceSelectAcceptedResponse(queuedJob));
      return;
    }

    const result = await executeWorkspaceSelectWithFallback(selectPayload);
    res.json(result);
  } catch (error) {
    const isQueueFull = String(error?.message || "").toLowerCase().includes("queue is full");
    res.status(isQueueFull ? 429 : 400).json({
      ok: false,
      error: error.message || "Workspace select failed",
    });
  }
});


router.post("/api/assistant/workspace/open-local", requireAuth, async (req, res) => {
  try {
    const result = await openLocalWorkspaceWithFallback(String(req.body?.rootPath || ""), {
      folderName: String(req.body?.folderName || ""),
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message || "Open local workspace failed",
    });
  }
});


router.get("/api/assistant/workspace/jobs/:jobId", requireAuth, (req, res) => {
  pruneWorkspaceSelectJobs();
  const job = getWorkspaceSelectJobForUser(req.params.jobId, req.authUser?.id);
  if (!job) {
    res.status(404).json({ ok: false, error: "Workspace indexing job not found." });
    return;
  }

  res.json({
    ok: true,
    job: snapshotWorkspaceSelectJob(job),
  });
});


router.get("/api/assistant/workspace/files", requireAuth, async (req, res) => {
  const payload = {
    workspaceId: String(req.query.workspaceId || "").trim(),
    sessionId: String(req.query.sessionId || "").trim(),
    folderName: String(req.query.folderName || "").trim(),
  };
  try {
    const result = await meshTunnelRequest("workspace.files", payload);
    res.json(result);
  } catch (error) {
    const local = await localWorkspaceFiles(payload);
    res.json({
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    });
  }
});


router.get("/api/assistant/workspace/graph", requireAuth, async (req, res) => {
  const payload = {
    workspaceId: String(req.query.workspaceId || "").trim(),
    sessionId: String(req.query.sessionId || "").trim(),
    folderName: String(req.query.folderName || "").trim(),
  };
  const hasLocalWorkspace = Boolean(
    localAssistantWorkspace.folderName ||
    localAssistantWorkspace.workspaceId ||
    localAssistantWorkspace.rootPath ||
    localAssistantWorkspace.files?.size
  );
  const localWorkspaceMatchesRequest = Boolean(localAssistantWorkspace.files?.size) && (
    !payload.workspaceId ||
    payload.workspaceId === String(localAssistantWorkspace.workspaceId || "").trim()
  );

  // Browser-opened folders are indexed into the gateway-local workspace state first.
  // The worker often has no matching active workspace for that browser folder, so its
  // graph can be stale, sparse, or from a different workspace entirely. In that case,
  // prefer the active gateway graph immediately instead of trying the worker first.
  if (localWorkspaceMatchesRequest) {
    const local = await localWorkspaceGraph(payload);
    if (local?.ok && (local.hasWorkspace || (Array.isArray(local.nodes) && local.nodes.length > 0))) {
      res.json({
        ...local,
        warning: "Using active gateway workspace graph.",
      });
      return;
    }
  }

  try {
    const result = await meshTunnelRequest("workspace.graph", payload);
    if (hasLocalWorkspace) {
      const local = await localWorkspaceGraph(payload);
      const remoteNodeCount = Array.isArray(result?.nodes) ? result.nodes.length : 0;
      const remoteEdgeCount = Array.isArray(result?.edges) ? result.edges.length : 0;
      const localNodeCount = Array.isArray(local?.nodes) ? local.nodes.length : 0;
      const localEdgeCount = Array.isArray(local?.edges) ? local.edges.length : 0;
      const shouldPreferLocalFallback =
        !result?.ok ||
        remoteNodeCount === 0 ||
        localNodeCount > remoteNodeCount ||
        localEdgeCount > remoteEdgeCount;
      if (shouldPreferLocalFallback && local?.ok && (local.hasWorkspace || localNodeCount > 0)) {
        res.json({
          ...local,
          warning: "Using richer active local workspace graph.",
        });
        return;
      }
    }
    res.json(result);
  } catch (error) {
    try {
      const local = await localWorkspaceGraph(payload);
      res.json({
        ...local,
        warning: `Mesh worker unavailable: ${error.message || "offline"}`,
      });
    } catch {
      res.status(500).json({
        ok: false,
        error: `Mesh worker unavailable: ${error.message || "offline"}`,
      });
    }
  }
});


router.get("/api/assistant/workspace/file", requireAuth, async (req, res) => {
  const view = String(req.query.view || "original");
  try {
    const result = await openWorkspaceFileWithFallback(String(req.query.path || ""), view, {
      workspaceId: String(req.query.workspaceId || "").trim(),
      sessionId: String(req.query.sessionId || "").trim(),
      tier: String(req.query.tier || req.query.capsuleTier || req.query.variant || "").trim(),
      query: String(req.query.q || req.query.query || req.query.focus || ""),
      focus: String(req.query.focus || req.query.q || req.query.query || ""),
    });
    if (String(view || "original").trim().toLowerCase() === "original" && result?.storage?.provider === "azure-blob" && !result?.storage?.readUrl) {
      result.storage = {
        ...result.storage,
        readUrl: buildWorkspaceBlobReadUrl(result.storage),
      };
    }
    res.json(result);
  } catch (error) {
    const message = String(error?.message || "File open failed");
    const statusCode = message.toLowerCase().includes("indexing") ? 409 : 404;
    res.status(statusCode).json({ ok: false, error: message, indexing: statusCode === 409 });
  }
});


router.post("/api/assistant/workspace/sync", requireAuth, async (req, res) => {
  try {
    const {
      workspaceId,
      folderName,
      files,
      deletedPaths,
      append,
      mode,
      scanEpoch,
      complete,
    } = req.body || {};
    const result = await syncWorkspaceFiles({
      workspaceId,
      folderName,
      files,
      deletedPaths,
      append,
      mode,
      scanEpoch,
      complete,
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});


router.delete("/api/assistant/workspace/file", requireAuth, (req, res) => {
  try {
    const { path } = req.body || {};
    if (path) {
      localAssistantWorkspace.files.delete(path);
      localAssistantWorkspace.fileCountCompleted = localAssistantWorkspace.files.size;
    }
    res.json({ ok: true, count: localAssistantWorkspace.files.size });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});


router.post("/api/assistant/workspace/recovery", requireAuth, async (req, res) => {
  try {
    const result = await recoverWorkspaceWithFallback(String(req.body?.path || ""), {
      query: req.body?.query || req.body?.q,
      spanIds: Array.isArray(req.body?.spanIds) ? req.body.spanIds : [],
      ranges: Array.isArray(req.body?.ranges) ? req.body.ranges : [],
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Workspace recovery failed" });
  }
});


router.post("/api/assistant/workspace/file", requireAuth, async (req, res) => {
  const filePath = String(req.body?.path || "");
  const content = typeof req.body?.content === "string" ? req.body.content : String(req.body?.content || "");
  const overwrite = Boolean(req.body?.overwrite);
  const workspaceId = String(req.body?.workspaceId || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();

  try {
    const result = await meshTunnelRequest("workspace.file.create", { path: filePath, content, overwrite, workspaceId, sessionId });
    res.json(result);
  } catch (error) {
    const shouldUseLocalFallback = isMeshWorkerUnavailableError(error) || isLocalPathWorkspaceState();
    if (!shouldUseLocalFallback) {
      res.status(400).json({
        ok: false,
        error: error.message || "Create file failed",
      });
      return;
    }

    const local = await localWorkspaceCreate(filePath, content, { overwrite, workspaceId, sessionId });
    if (!local.ok) {
      res.status(400).json(local);
      return;
    }
    res.json({
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    });
  }
});


router.put("/api/assistant/workspace/file", requireAuth, async (req, res) => {
  const filePath = String(req.body?.path || "");
  const content = typeof req.body?.content === "string" ? req.body.content : String(req.body?.content || "");
  const workspaceId = String(req.body?.workspaceId || "").trim();
  const sessionId = String(req.body?.sessionId || "").trim();

  try {
    const result = await meshTunnelRequest("workspace.file.save", { path: filePath, content, workspaceId, sessionId });
    res.json(result);
  } catch (error) {
    const shouldUseLocalFallback = isMeshWorkerUnavailableError(error) || isLocalPathWorkspaceState();
    if (!shouldUseLocalFallback) {
      res.status(400).json({
        ok: false,
        error: error.message || "Save file failed",
      });
      return;
    }
    const local = await localWorkspaceSave(filePath, content, { workspaceId, sessionId });
    if (!local.ok) {
      res.status(400).json(local);
      return;
    }
    res.json({
      ...local,
      warning: `Mesh worker unavailable: ${error.message || "offline"}`,
    });
  }
});


router.post("/api/assistant/workspace/purge", requireAuth, async (req, res) => {
  try {
    const result = await meshTunnelRequest("workspace.purge", {
      workspaceId: String(req.body.workspaceId || "").trim(),
      sessionId: String(req.body.sessionId || "").trim(),
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Purge failed" });
  }
});

router.delete("/api/assistant/workspace/file", requireAuth, async (req, res) => {
  try {
    const result = await deleteWorkspaceFileWithFallback(String(req.query.path || ""), {
      workspaceId: String(req.query.workspaceId || "").trim(),
      sessionId: String(req.query.sessionId || "").trim(),
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Delete file failed" });
  }
});


router.get("/api/assistant/workspace/search", requireAuth, async (req, res) => {
  try {
    const result = await searchWorkspaceWithFallback(String(req.query.q || ""), {
      scope: String(req.query.scope || "all"),
      limit: Math.min(Number(req.query.limit) || 12, 200),
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Workspace search failed" });
  }
});


router.post("/api/assistant/workspace/grep", requireAuth, async (req, res) => {
  try {
    const result = await grepWorkspaceWithFallback(String(req.body?.q || req.body?.query || ""), {
      scope: String(req.body?.scope || "all"),
      limit: Math.min(Number(req.body?.limit) || 40, 500),
      caseSensitive: req.body?.caseSensitive === true,
    });
    if (result.ok === false) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Workspace grep failed" });
  }
});


router.post("/api/assistant/workspace/rename", requireAuth, async (req, res) => {
  try {
    const result = await renameWorkspaceFileWithFallback(
      String(req.body?.fromPath || ""),
      String(req.body?.toPath || ""),
      {
        overwrite: Boolean(req.body?.overwrite),
        workspaceId: String(req.body?.workspaceId || "").trim(),
        sessionId: String(req.body?.sessionId || "").trim(),
      },
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Workspace rename failed" });
  }
});


router.post("/api/assistant/workspace/batch", requireAuth, async (req, res) => {
  try {
    const result = await applyWorkspaceBatchWithFallback(req.body?.operations || [], {
      stopOnError: req.body?.stopOnError !== false,
    });
    if (result.ok === false) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Workspace batch failed" });
  }
});


router.post("/api/assistant/terminal/session", requireAuth, (req, res) => {
  try {
    const created = createAssistantTerminalSession({ shell: req.body?.shell });
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Terminal session failed" });
  }
});


router.get("/api/assistant/terminal/session/:id/output", requireAuth, (req, res) => {
  try {
    const payload = listAssistantTerminalOutput(req.params.id, req.query.since);
    res.json(payload);
  } catch (error) {
    res.status(404).json({ ok: false, error: error.message || "Terminal session not found" });
  }
});


router.post("/api/assistant/terminal/session/:id/input", requireAuth, (req, res) => {
  try {
    const payload = writeAssistantTerminalInput(req.params.id, req.body?.input);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Terminal input failed" });
  }
});


router.delete("/api/assistant/terminal/session/:id", requireAuth, (req, res) => {
  try {
    const payload = destroyAssistantTerminalSession(req.params.id);
    res.json(payload);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Terminal close failed" });
  }
});


router.post("/api/assistant/runs", requireAuth, async (req, res) => {
  const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
  const resolvedCredentials = mergeChatCredentials(storedCredentials);

  try {
    const run = await createAssistantRun({
      model: String(req.body?.model || "claude-sonnet-4-6"),
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
    res.status(400).json({ ok: false, error: error.message || "Assistant run failed" });
  }
});


router.get("/api/assistant/runs/:runId", requireAuth, (req, res) => {
  const run = assistantRuns.get(String(req.params.runId || ""));
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found." });
    return;
  }
  res.json({ ok: true, run: assistantRunSnapshot(run) });
});


router.post("/api/assistant/runs/:runId/actions/:actionId", requireAuth, async (req, res) => {
  const run = assistantRuns.get(String(req.params.runId || ""));
  if (!run) {
    res.status(404).json({ ok: false, error: "Run not found." });
    return;
  }

  const action = run.actions.find((entry) => entry.id === String(req.params.actionId || ""));
  if (!action) {
    res.status(404).json({ ok: false, error: "Action not found." });
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
    res.status(400).json({ ok: false, error: error.message || "Run action failed" });
  }
});


router.get("/api/assistant/git/status", requireAuth, async (_req, res) => {
  try {
    const result = await runGitWithFallback("git.status", {}, () => localGitStatus());
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git status failed" });
  }
});


router.get("/api/assistant/git/branches", requireAuth, async (_req, res) => {
  try {
    const result = await runGitWithFallback("git.branches", {}, async () => {
      const raw = (await runLocalGit(["branch", "-a", "--format=%(refname:short)\t%(HEAD)"])).stdout;
      const branches = [];
      let current = "";
      for (const line of (raw ? raw.split("\n") : [])) {
        const [name, head] = line.split("\t");
        if (!name) continue;
        branches.push(name);
        if (head === "*") current = name;
      }
      if (!current) {
        try {
          current = (await runLocalGit(["rev-parse", "--abbrev-ref", "HEAD"])).stdout;
        } catch {
          current = "";
        }
      }
      return { ok: true, branches, current };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git branches failed" });
  }
});


router.post("/api/assistant/git/checkout", requireAuth, async (req, res) => {
  try {
    const branch = String(req.body?.branch || "").trim();
    if (!branch) {
      res.status(400).json({ ok: false, error: "Branch name required" });
      return;
    }
    const result = await runGitWithFallback("git.checkout", { branch }, async () => {
      await runLocalGit(["checkout", branch]);
      return { ok: true, branch };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git checkout failed" });
  }
});


router.post("/api/assistant/git/stage", requireAuth, async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const result = await runGitWithFallback("git.stage", { files }, async () => {
      const normalized = files.length ? files.map((file) => gitPathFromWorkspacePath(file)).filter(Boolean) : ["."];
      await runLocalGit(["add", ...normalized]);
      return { ok: true };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git stage failed" });
  }
});


router.post("/api/assistant/git/unstage", requireAuth, async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    const result = await runGitWithFallback("git.unstage", { files }, async () => {
      const normalized = files.length ? files.map((file) => gitPathFromWorkspacePath(file)).filter(Boolean) : ["."];
      await runLocalGit(["reset", "HEAD", "--", ...normalized]);
      return { ok: true };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git unstage failed" });
  }
});


router.post("/api/assistant/git/commit", requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (!message) {
      res.status(400).json({ ok: false, error: "Commit message required" });
      return;
    }
    const result = await runGitWithFallback("git.commit", { message, files }, async () => {
      if (files.length) {
        const normalized = files.map((file) => gitPathFromWorkspacePath(file)).filter(Boolean);
        if (normalized.length) await runLocalGit(["add", ...normalized]);
      }
      const committed = await runLocalGit(["commit", "-m", message]);
      return { ok: true, output: committed.stdout || committed.stderr };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git commit failed" });
  }
});


router.post("/api/assistant/git/push", requireAuth, async (_req, res) => {
  try {
    const result = await runGitWithFallback("git.push", {}, async () => {
      const pushed = await runLocalGit(["push"]);
      return { ok: true, output: pushed.stdout || pushed.stderr };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git push failed" });
  }
});


router.post("/api/assistant/git/pull", requireAuth, async (_req, res) => {
  try {
    const result = await runGitWithFallback("git.pull", {}, async () => {
      const pulled = await runLocalGit(["pull"]);
      return { ok: true, output: pulled.stdout || pulled.stderr };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git pull failed" });
  }
});


router.get("/api/assistant/git/diff", requireAuth, async (req, res) => {
  try {
    const filePath = String(req.query.path || "");
    const result = await runGitWithFallback("git.diff", { path: filePath }, async () => {
      const normalized = gitPathFromWorkspacePath(filePath);
      const diffArgs = ["diff"];
      const stagedArgs = ["diff", "--cached"];
      if (normalized) {
        diffArgs.push("--", normalized);
        stagedArgs.push("--", normalized);
      }
      const diff = await runLocalGit(diffArgs);
      const staged = await runLocalGit(stagedArgs);
      let beforeContent = "";
      let afterContent = "";
      if (normalized) {
        try {
          beforeContent = (await runLocalGit(["show", `HEAD:${normalized}`])).stdout;
        } catch {
          beforeContent = "";
        }
        try {
          const workspacePath = workspacePathFromGitPath(normalized) || String(filePath || "").trim();
          if (workspacePath) {
            const target = resolveLocalWorkspaceAbsolutePath(workspacePath);
            afterContent = await readLocalWorkspaceFileText(target.absolutePath);
          }
        } catch {
          afterContent = "";
        }
      }
      return { ok: true, diff: diff.stdout, stagedDiff: staged.stdout, beforeContent, afterContent };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git diff failed" });
  }
});


router.get("/api/assistant/git/log", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    const result = await runGitWithFallback("git.log", { limit }, async () => {
      const raw = await runLocalGit(["log", `--max-count=${limit}`, "--format=%H\t%an\t%ae\t%aI\t%s"]);
      const commits = (raw.stdout ? raw.stdout.split("\n") : []).filter(Boolean).map((line) => {
        const [hash, author, email, date, ...messageParts] = line.split("\t");
        return { hash, author, email, date, message: messageParts.join("\t") };
      });
      return { ok: true, commits };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git log failed" });
  }
});


router.post("/api/assistant/git/stash", requireAuth, async (req, res) => {
  try {
    const action = String(req.body?.action || "push").trim().toLowerCase();
    const message = String(req.body?.message || "Mesh stash");
    const result = await runGitWithFallback("git.stash", { action, message }, async () => {
      if (action === "list") {
        const listed = await runLocalGit(["stash", "list"]);
        return { ok: true, stashes: listed.stdout ? listed.stdout.split("\n") : [] };
      }
      if (action === "pop") {
        const popped = await runLocalGit(["stash", "pop"]);
        return { ok: true, output: popped.stdout || popped.stderr };
      }
      const pushed = await runLocalGit(["stash", "push", "-m", message]);
      return { ok: true, output: pushed.stdout || pushed.stderr };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git stash failed" });
  }
});


router.post("/api/assistant/git/clone", requireAuth, async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const targetPath = String(req.body?.path || "").trim();
    if (!url) {
      res.status(400).json({ ok: false, error: "Repository URL required" });
      return;
    }
    const SAFE_GIT_URL_PATTERN = /^(https?:\/\/|git:\/\/|ssh:\/\/|git@[\w.\-]+:)/;
    if (!SAFE_GIT_URL_PATTERN.test(url)) {
      res.status(400).json({ ok: false, error: "Invalid repository URL. Must use https, git, or ssh protocol." });
      return;
    }
    const result = await runGitWithFallback("git.clone", { url, path: targetPath }, async () => {
      if (!targetPath && !isLocalPathWorkspaceState()) {
        return { ok: false, error: "Target path required when no local workspace root is configured." };
      }
      const workspaceParent = path.dirname(getLocalGitCwd());
      const fallbackName = url.split("/").pop()?.replace(/\.git$/i, "") || "repo";
      const resolvedTarget = targetPath
        ? path.resolve(workspaceParent, targetPath)
        : path.resolve(workspaceParent, fallbackName);
      if (resolvedTarget !== workspaceParent && !resolvedTarget.startsWith(workspaceParent + path.sep)) {
        return { ok: false, error: "Target path must be within the workspace directory." };
      }
      await fs.promises.mkdir(path.dirname(resolvedTarget), { recursive: true });
      const cloned = await runLocalGit(["clone", url, resolvedTarget], path.dirname(resolvedTarget));
      return {
        ok: true,
        path: resolvedTarget,
        folderName: path.basename(resolvedTarget),
        output: cloned.stderr || cloned.stdout,
      };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git clone failed" });
  }
});


router.post("/api/assistant/git/init", requireAuth, async (_req, res) => {
  try {
    const result = await runGitWithFallback("git.init", {}, async () => {
      const initialized = await runLocalGit(["init"]);
      return { ok: true, output: initialized.stdout || initialized.stderr };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git init failed" });
  }
});


router.post("/api/assistant/git/create-branch", requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const startPoint = String(req.body?.startPoint || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "Branch name required" });
      return;
    }
    const result = await runGitWithFallback("git.create-branch", { name, startPoint }, async () => {
      const args = ["checkout", "-b", name];
      if (startPoint) args.push(startPoint);
      await runLocalGit(args);
      return { ok: true, branch: name };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git create branch failed" });
  }
});


router.post("/api/assistant/git/delete-branch", requireAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, error: "Branch name required" });
      return;
    }
    const result = await runGitWithFallback("git.delete-branch", { name }, async () => {
      await runLocalGit(["branch", "-d", name]);
      return { ok: true };
    });
    res.json(result);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Git delete branch failed" });
  }
});


router.post("/api/assistant/chat", requireAuth, async (req, res) => {
  const {
    model = MESH_DEFAULT_MODEL || "gpt-5.4-mini",
    messages = [],
    activeFilePath = "",
    chatSessionId = "",
  } = req.body || {};
  const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
  const resolvedCredentials = mergeChatCredentials(storedCredentials);

  const normalizedMessages = normalizeMessages(messages);
  const normalizedSessionId = normalizeChatSessionId(chatSessionId);

  let referencedFiles = [];
  const lastUserMessage = normalizedMessages.filter((m) => m?.role === "user").at(-1)?.content || "";
  try {
    const context = await meshTunnelRequest("chat", { model, messages: normalizedMessages });
    referencedFiles = Array.isArray(context?.referencedFiles) ? context.referencedFiles : [];
  } catch {
    referencedFiles = await localResolveReferencedFiles(lastUserMessage);
  }

  if (referencedFiles.length === 0) {
    const inferred = await inferReferencedFilesFromWorkspace(lastUserMessage);
    if (inferred.length > 0) {
      referencedFiles = inferred;
    }
  }

  const requestedActiveFile = toSafePath(activeFilePath);
  const taggedActiveFile = extractActiveFilePathFromMessages(normalizedMessages);
  const contextPaths = dedupePaths([requestedActiveFile, taggedActiveFile, ...referencedFiles]);
  const hasActiveFileFocus = Boolean(requestedActiveFile || taggedActiveFile);
  const adaptiveContextBudget = resolveAdaptiveCompressedContextBudget({
    lastUserMessage,
    hasActiveFileFocus,
  });
  let capsuleContextEntries = [];
  let recoveredSpanEntries = [];
  let skippedOversizeContextPaths = [];
  let contextBlock = "";

  const capsuleContextResult = await loadCapsuleContextEntries(contextPaths, {
    maxFiles: adaptiveContextBudget.maxFiles,
    maxModelChars: adaptiveContextBudget.maxModelCompressedChars,
    firstFileMaxModelChars: adaptiveContextBudget.firstFileMaxModelCompressedChars,
    query: lastUserMessage,
    disableCodecDictionary: adaptiveContextBudget.disableCodecDictionary,
  });
  capsuleContextEntries = capsuleContextResult.entries;
  skippedOversizeContextPaths = capsuleContextResult.skippedOversizePaths;
  recoveredSpanEntries = await loadRecoveredSpanEntries(
    capsuleContextEntries.map((entry) => entry.path),
    lastUserMessage,
    { maxFiles: hasActiveFileFocus ? 2 : 1, maxSpansPerFile: hasActiveFileFocus ? 4 : 2 },
  );
  contextBlock = buildCapsuleContextBlock(capsuleContextEntries, recoveredSpanEntries);
  const requiresCodecDictionary = capsuleContextEntries.some((entry) => Boolean(entry.usesCodecDictionary));

  let modelMessages = injectCompressedContextIntoMessages(normalizedMessages, contextBlock);
  let injectedCodecContext = false;

  if (!hasCodecContextMarker(modelMessages) && !isCodecContextInitializedForSession(normalizedSessionId, {
    requireDictionary: requiresCodecDictionary,
  })) {
    modelMessages = injectCodecContextIntoMessages(modelMessages, {
      dictionaryEnabled: requiresCodecDictionary,
    });
    injectedCodecContext = true;
  }

  try {
    let routed = await runModelChat({
      model,
      messages: modelMessages,
      credentials: resolvedCredentials,
    });

    let rawModelContent = String(routed.content || "");
    let decodedResponse = decodeCompressedModelResponse(rawModelContent, {
      allowLegacy: true,
      allowUnframedRot47: true,
    });

    let usedServerCodecRecovery = false;
    if (!decodedResponse.codecValid) {
      decodedResponse = buildServerCodecRecovery(rawModelContent);
      usedServerCodecRecovery = true;
    }

    let polishedDecoded = polishDecompressedAssistantText(decodedResponse.decoded);
    let codecPolicyRecoveryApplied = false;
    if (looksLikeCodecProtocolRefusal(polishedDecoded)) {
      try {
        const protocolClarifier = [
          "<mesh_protocol_note>",
          "Answer the latest user request directly.",
          "Treat mesh codec content as app transport metadata, not as a policy debate task.",
          "If any compressed block is unreadable, continue with available context and ask for a specific file path.",
          "</mesh_protocol_note>",
        ].join("\n");

        const recoveryMessages = [
          ...modelMessages,
          { role: "user", content: protocolClarifier },
        ];

        routed = await runModelChat({
          model,
          messages: recoveryMessages,
          credentials: resolvedCredentials,
        });

        rawModelContent = String(routed.content || "");
        decodedResponse = decodeCompressedModelResponse(rawModelContent, {
          allowLegacy: true,
          allowUnframedRot47: true,
        });

        usedServerCodecRecovery = false;
        if (!decodedResponse.codecValid) {
          decodedResponse = buildServerCodecRecovery(rawModelContent);
          usedServerCodecRecovery = true;
        }

        polishedDecoded = polishDecompressedAssistantText(decodedResponse.decoded);
        codecPolicyRecoveryApplied = true;
      } catch {
        // Keep initial decoded response if recovery attempt fails.
      }
    }

    const contextFilePaths = capsuleContextEntries.map((entry) => entry.path);
    const guaranteedCompressedContent = encodeMeshModelCodec(polishedDecoded);
    const responseTransport = buildModelResponseTransport(
      guaranteedCompressedContent,
      polishedDecoded,
      decodedResponse.compressedByModel
    );

    if (injectedCodecContext) {
      markCodecContextInitialized(normalizedSessionId, {
        dictionaryReady: requiresCodecDictionary,
      });
    }

    res.json({
      ok: true,
      content: polishedDecoded,
      contentCompressed: guaranteedCompressedContent,
      referencedFiles: contextFilePaths.length ? contextFilePaths : referencedFiles,
      model: routed.model,
      provider: routed.provider,
      transport: {
        ...responseTransport,
        contextFilesCompressed: 0,
        contextFilesCapsules: capsuleContextEntries.length,
        contextFilesTruncated: capsuleContextEntries.filter((entry) => Boolean(entry.contentTruncated)).length,
        contextFilesPlain: 0,
        contextFilesSkippedOversize: skippedOversizeContextPaths.length,
        contextRecoveredSpans: recoveredSpanEntries.length,
        contextBudgetMode: adaptiveContextBudget.mode,
        contextCodec: MESH_MODEL_CODEC_VERSION,
        codecMode: decodedResponse.codecMode,
        codecRetryAttempted: false,
        serverCodecRecovery: usedServerCodecRecovery,
        responseCompressedByGateway: true,
        codecPolicyRecoveryApplied,
        providerInputTokens: Number(routed?.usage?.inputTokens || 0),
        providerOutputTokens: Number(routed?.usage?.outputTokens || 0),
        providerTotalTokens: Number(routed?.usage?.totalTokens || 0),
        providerCacheCreationInputTokens: Number(routed?.usage?.cacheCreationInputTokens || 0),
        providerCacheReadInputTokens: Number(routed?.usage?.cacheReadInputTokens || 0),
        providerRequestId: String(routed?.providerRequestId || ""),
      },
    });
  } catch (error) {
    const message = String(error?.message || "");
    if (/returned no content/i.test(message)) {
      try {
        const fallback = await localAssistantReply(model, normalizedMessages);
        const fallbackDecoded = polishDecompressedAssistantText(String(fallback?.content || ""));
        const fallbackCompressed = encodeMeshModelCodec(fallbackDecoded);
        res.json({
          ok: true,
          content: fallbackDecoded,
          contentCompressed: fallbackCompressed,
          referencedFiles,
          model,
          provider: "local-fallback",
          transport: {
            responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
            responseEncodedBytes: Buffer.byteLength(fallbackCompressed, "utf8"),
            responseDecodedBytes: Buffer.byteLength(fallbackDecoded, "utf8"),
            compressedByModel: false,
            contextFilesCompressed: 0,
            contextFilesCapsules: 0,
            contextFilesPlain: 0,
            contextFilesSkippedOversize: 0,
            contextRecoveredSpans: 0,
            contextCodec: MESH_MODEL_CODEC_VERSION,
            codecMode: "fallback-reencoded",
            serverCodecRecovery: false,
            responseCompressedByGateway: true,
            providerInputTokens: 0,
            providerOutputTokens: 0,
            providerTotalTokens: 0,
            providerCacheCreationInputTokens: 0,
            providerCacheReadInputTokens: 0,
            providerRequestId: "",
          },
          warning: `${message}. Falling back to local assistant context.`,
        });
        return;
      } catch {
        // Continue to regular error response below.
      }
    }

    res.status(400).json({
      ok: false,
      error: message || "Chat request failed",
      model,
      referencedFiles,
    });
  }
});


router.post("/api/assistant/codec/decode", requireAuth, async (req, res) => {
  try {
    const payload = String(req.body?.payload || req.body?.contentCompressed || "").trim();
    if (!payload) {
      res.status(400).json({ ok: false, error: "Missing compressed payload" });
      return;
    }

    const decoded = decodeCompressedModelResponse(payload, {
      allowLegacy: true,
      allowUnframedRot47: true,
    });

    if (!decoded.codecValid) {
      res.status(400).json({ ok: false, error: "Invalid compressed payload", codecMode: decoded.codecMode || "invalid" });
      return;
    }

    res.json({
      ok: true,
      content: polishDecompressedAssistantText(decoded.decoded),
      codecMode: decoded.codecMode || "decoded",
      responseEncoding: `mesh-${MESH_MODEL_CODEC_VERSION}`,
    });
  } catch (error) {
    res.status(400).json({ ok: false, error: String(error?.message || "Codec decode failed") });
  }
});

/* ─────────────────────────────────────────
   AI endpoint — POST /api/chat
   body: { model, messages: [{role,content}] }
───────────────────────────────────────── */


/* ─────────────────────────────────────────
   SSE Streaming Chat — POST /api/assistant/chat/stream
   Same pipeline as /api/assistant/chat but streams tokens via SSE
───────────────────────────────────────── */
router.post("/api/assistant/chat/stream", requireAuth, async (req, res) => {
  const {
    model = MESH_DEFAULT_MODEL || "gpt-5.4-mini",
    messages = [],
    activeFilePath = "",
    chatSessionId = "",
  } = req.body || {};

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  function sendSSE(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
    const resolvedCredentials = mergeChatCredentials(storedCredentials);
    const normalizedMessages = normalizeMessages(messages);
    const normalizedSessionId = normalizeChatSessionId(chatSessionId);

    let referencedFiles = [];
    const lastUserMessage = normalizedMessages.filter((m) => m?.role === "user").at(-1)?.content || "";
    try {
      const context = await meshTunnelRequest("chat", { model, messages: normalizedMessages });
      referencedFiles = Array.isArray(context?.referencedFiles) ? context.referencedFiles : [];
    } catch {
      referencedFiles = await localResolveReferencedFiles(lastUserMessage);
    }

    if (referencedFiles.length === 0) {
      const inferred = await inferReferencedFilesFromWorkspace(lastUserMessage);
      if (inferred.length > 0) referencedFiles = inferred;
    }

    const requestedActiveFile = toSafePath(activeFilePath);
    const taggedActiveFile = extractActiveFilePathFromMessages(normalizedMessages);
    const contextPaths = dedupePaths([requestedActiveFile, taggedActiveFile, ...referencedFiles]);
    const hasActiveFileFocus = Boolean(requestedActiveFile || taggedActiveFile);
    const adaptiveContextBudget = resolveAdaptiveCompressedContextBudget({
      lastUserMessage,
      hasActiveFileFocus,
    });

    const capsuleContextResult = await loadCapsuleContextEntries(contextPaths, {
      maxFiles: adaptiveContextBudget.maxFiles,
      maxModelChars: adaptiveContextBudget.maxModelCompressedChars,
      firstFileMaxModelChars: adaptiveContextBudget.firstFileMaxModelCompressedChars,
      query: lastUserMessage,
      disableCodecDictionary: adaptiveContextBudget.disableCodecDictionary,
    });
    const capsuleContextEntries = capsuleContextResult.entries;
    const recoveredSpanEntries = await loadRecoveredSpanEntries(
      capsuleContextEntries.map((entry) => entry.path),
      lastUserMessage,
      { maxFiles: hasActiveFileFocus ? 2 : 1, maxSpansPerFile: hasActiveFileFocus ? 4 : 2 },
    );
    const contextBlock = buildCapsuleContextBlock(capsuleContextEntries, recoveredSpanEntries);
    const requiresCodecDictionary = capsuleContextEntries.some((entry) => Boolean(entry.usesCodecDictionary));

    let modelMessages = injectCompressedContextIntoMessages(normalizedMessages, contextBlock);
    let injectedCodecContext = false;

    if (!hasCodecContextMarker(modelMessages) && !isCodecContextInitializedForSession(normalizedSessionId, {
      requireDictionary: requiresCodecDictionary,
    })) {
      modelMessages = injectCodecContextIntoMessages(modelMessages, {
        dictionaryEnabled: requiresCodecDictionary,
      });
      injectedCodecContext = true;
    }

    sendSSE("context", {
      referencedFiles: capsuleContextEntries.map((e) => e.path),
      capsuleCount: capsuleContextEntries.length,
      recoveredSpans: recoveredSpanEntries.length,
    });

    /* Resolve provider and stream */
    const resolved = resolveProviderForModel(model, resolvedCredentials);

    if (resolved.provider === "anthropic") {
      let apiKey = String(resolvedCredentials?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
      const bedrockToken = String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim();
      const isBedrockTarget = resolved.model.includes("opus-4") || resolved.model.includes("sonnet-4-6") || resolved.model.includes("haiku-4-5");

      if (!apiKey && bedrockToken && isBedrockTarget) {
        /* Bedrock proxy — stream via OpenAI-compatible SSE */
        await streamOpenAICompatible({
          apiKey: bedrockToken,
          model: resolved.model,
          messages: injectMeshSystemPrompt(modelMessages),
          baseUrl: "https://api.mesh-ai.com/v1",
          res, sendSSE,
        });
      } else if (apiKey) {
        /* Anthropic native streaming */
        const anthropicSystem = modelMessages.filter(m => m.role === "system").map(m => m.content).join("\n");
        const anthropicMsgs = toAnthropicMessages(modelMessages);
        const maxTokens = Math.max(64, Number(resolvedCredentials?.anthropic?.maxTokens || 1024));

        const streamBody = {
          model: resolved.model,
          max_tokens: maxTokens,
          messages: anthropicMsgs,
          stream: true,
        };
        if (anthropicSystem) streamBody.system = anthropicSystem;

        const streamResponse = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(streamBody),
        });

        if (!streamResponse.ok) {
          const errBody = await streamResponse.text();
          sendSSE("error", { error: `Anthropic error (${streamResponse.status}): ${errBody.slice(0, 200)}` });
          res.end();
          return;
        }

        let fullContent = "";
        const reader = streamResponse.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const event = JSON.parse(data);
                if (event.type === "content_block_delta" && event.delta?.text) {
                  fullContent += event.delta.text;
                  sendSSE("token", { text: event.delta.text });
                } else if (event.type === "message_delta" && event.usage) {
                  sendSSE("usage", {
                    inputTokens: event.usage.input_tokens || 0,
                    outputTokens: event.usage.output_tokens || 0,
                  });
                }
              } catch { /* skip malformed JSON */ }
            }
          }
        }

        /* Decode & finalize */
        await finalizeStreamedResponse({
          fullContent, injectedCodecContext, normalizedSessionId,
          requiresCodecDictionary, capsuleContextEntries, recoveredSpanEntries,
          adaptiveContextBudget, model, resolved, referencedFiles, sendSSE,
        });
      } else {
        sendSSE("error", { error: "Missing Anthropic API key" });
      }
    } else if (resolved.provider === "openai") {
      const userApiKey = String(resolvedCredentials?.openai?.apiKey || process.env.OPENAI_API_KEY || "").trim();
      const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").trim().replace(/\/+$/, "");
      const azureKey = String(process.env.AZURE_OPENAI_KEY || "").trim();

      if (userApiKey) {
        await streamOpenAICompatible({
          apiKey: userApiKey,
          model: resolved.model,
          messages: injectMeshSystemPrompt(modelMessages),
          baseUrl: "https://api.openai.com/v1",
          orgId: String(resolvedCredentials?.openai?.orgId || "").trim(),
          res, sendSSE,
          injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
          capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget,
          referencedFiles,
        });
      } else if (azureEndpoint && azureKey) {
        const deploymentName = resolved.model;
        const url = `${azureEndpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=2024-12-01-preview`;
        await streamOpenAICompatible({
          apiKey: azureKey,
          model: resolved.model,
          messages: injectMeshSystemPrompt(modelMessages),
          baseUrl: url,
          isAzure: true,
          res, sendSSE,
          injectedCodecContext, normalizedSessionId, requiresCodecDictionary,
          capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget,
          referencedFiles,
        });
      } else {
        sendSSE("error", { error: "Missing OpenAI API key" });
      }
    } else {
      /* Fallback: non-streaming for unsupported providers */
      const routed = await runModelChat({ model, messages: modelMessages, credentials: resolvedCredentials });
      const decoded = decodeCompressedModelResponse(String(routed.content || ""), { allowLegacy: true, allowUnframedRot47: true });
      const polished = polishDecompressedAssistantText(decoded.decoded);
      sendSSE("token", { text: polished });
      sendSSE("done", { content: polished, model: routed.model, provider: routed.provider });
    }

    res.end();
  } catch (error) {
    try {
      sendSSE("error", { error: error.message || "Stream failed" });
      res.end();
    } catch { /* response already ended */ }
  }
});

async function streamOpenAICompatible({ apiKey, model, messages, baseUrl, orgId, isAzure, res, sendSSE, injectedCodecContext, normalizedSessionId, requiresCodecDictionary, capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, referencedFiles }) {
  const headers = { "Content-Type": "application/json" };
  if (isAzure) {
    headers["api-key"] = apiKey;
  } else {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  if (orgId) headers["OpenAI-Organization"] = orgId;

  const url = isAzure ? baseUrl : `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const body = {
    model,
    messages: messages.map(m => ({ role: m.role === "system" ? "system" : m.role === "assistant" ? "assistant" : "user", content: m.content })),
    stream: true,
    max_tokens: 4096,
  };

  const streamResponse = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!streamResponse.ok) {
    const errBody = await streamResponse.text();
    sendSSE("error", { error: `Provider error (${streamResponse.status}): ${errBody.slice(0, 200)}` });
    return;
  }

  let fullContent = "";
  const reader = streamResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            fullContent += delta;
            sendSSE("token", { text: delta });
          }
        } catch { /* skip */ }
      }
    }
  }

  await finalizeStreamedResponse({
    fullContent, injectedCodecContext, normalizedSessionId,
    requiresCodecDictionary, capsuleContextEntries: capsuleContextEntries || [],
    recoveredSpanEntries: recoveredSpanEntries || [],
    adaptiveContextBudget: adaptiveContextBudget || {},
    model, resolved: { model }, referencedFiles: referencedFiles || [],
    sendSSE,
  });
}

async function finalizeStreamedResponse({ fullContent, injectedCodecContext, normalizedSessionId, requiresCodecDictionary, capsuleContextEntries, recoveredSpanEntries, adaptiveContextBudget, model, resolved, referencedFiles, sendSSE }) {
  let decodedResponse = decodeCompressedModelResponse(fullContent, { allowLegacy: true, allowUnframedRot47: true });
  let usedServerCodecRecovery = false;

  if (!decodedResponse.codecValid) {
    decodedResponse = buildServerCodecRecovery(fullContent);
    usedServerCodecRecovery = true;
  }

  const polished = polishDecompressedAssistantText(decodedResponse.decoded);
  const compressed = encodeMeshModelCodec(polished);

  if (injectedCodecContext) {
    markCodecContextInitialized(normalizedSessionId, { dictionaryReady: requiresCodecDictionary });
  }

  sendSSE("done", {
    content: polished,
    contentCompressed: compressed,
    referencedFiles: capsuleContextEntries.map(e => e.path).length ? capsuleContextEntries.map(e => e.path) : referencedFiles,
    model: resolved.model || model,
    transport: {
      contextFilesCapsules: capsuleContextEntries.length,
      contextRecoveredSpans: recoveredSpanEntries.length,
      contextBudgetMode: adaptiveContextBudget.mode,
      serverCodecRecovery: usedServerCodecRecovery,
    },
  });
}


/* ─────────────────────────────────────────
   Inline Completion — POST /api/inline-complete
   SSE streaming for inline code completions
───────────────────────────────────────── */
router.post("/api/inline-complete", requireAuth, async (req, res) => {
  const {
    model = MESH_DEFAULT_MODEL || "gpt-5.4-mini",
    prefix = "",
    suffix = "",
    filePath = "",
    language = "",
  } = req.body || {};

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  function sendSSE(event, data) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  try {
    const storedCredentials = await getStoredCredentialsForUser(req.authUser?.id);
    const resolvedCredentials = mergeChatCredentials(storedCredentials);
    const lang = language || filePath.split(".").pop() || "code";

    const messages = [
      { role: "system", content: `You are a code completion engine. Complete the code where the cursor is. Output ONLY the completion text — no explanation, no markdown fences, no surrounding code. Language: ${lang}` },
      { role: "user", content: `Complete the code at the cursor position:\n\n${prefix}<CURSOR>${suffix}\n\nProvide only the text that goes at <CURSOR>.` },
    ];

    const routed = await runModelChat({ model, messages, credentials: resolvedCredentials });
    const completion = String(routed.content || "").trim();

    sendSSE("completion", { text: completion });
    sendSSE("done", {});
    res.end();
  } catch (error) {
    sendSSE("error", { error: error.message || "Completion failed" });
    res.end();
  }
});


/* ─────────────────────────────────────────
   New Endpoints for Feature Modules
   (workspace/file, files, grep, git/diff, git/status, git/stage
    are already defined above — no duplicates)
───────────────────────────────────────── */

/* POST /api/assistant/workspace/reindex — trigger re-indexing */
router.post("/api/assistant/workspace/reindex", requireAuth, async (req, res) => {
  try {
    const { files } = req.body || {};
    const result = await meshTunnelRequest("reindex", { files });
    res.json({ ok: true, ...result });
  } catch (error) {
    try {
      if (localAssistantWorkspace.rootPath) {
        res.json({ ok: true, message: "Reindex queued (local mode)" });
      } else {
        throw error;
      }
    } catch {
      res.status(400).json({ ok: false, error: error.message || "Reindex failed" });
    }
  }
});

/* GET /api/assistant/workspace/span — resolve a span ID to file location */
router.get("/api/assistant/workspace/span", requireAuth, async (req, res) => {
  try {
    const spanId = String(req.query.id || "");
    if (!spanId) return res.status(400).json({ ok: false, error: "Missing span ID" });

    const files = localAssistantWorkspace.files;
    if (files && files.size > 0) {
      for (const [filePath, fileData] of files) {
        const capsule = fileData?.capsuleBase || fileData?.compressedContent || "";
        if (capsule.includes(spanId)) {
          const spanMatch = capsule.match(new RegExp(escapeRegexLiteral(spanId) + "[^\\n]*?(?:L|line|:)(\\d+)"));
          const line = spanMatch ? parseInt(spanMatch[1]) : 1;
          res.json({
            ok: true,
            file: filePath,
            line,
            symbol: spanId,
            kind: "symbol",
            preview: capsule.slice(Math.max(0, capsule.indexOf(spanId) - 100), capsule.indexOf(spanId) + 200),
          });
          return;
        }
      }
    }

    res.json({ ok: false, error: "Span not found" });
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message || "Span lookup failed" });
  }
});

/* GET /api/assistant/workspace/context-budget — token budget info for context visualizer */
router.get("/api/assistant/workspace/context-budget", requireAuth, async (req, res) => {
  try {
    const files = [];
    if (localAssistantWorkspace.files && localAssistantWorkspace.files.size > 0) {
      for (const [filePath, fileData] of localAssistantWorkspace.files) {
        const capsuleSize = fileData?.capsuleBase ? Buffer.byteLength(fileData.capsuleBase, "utf8") : 0;
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
    res.status(400).json({ ok: false, error: error.message || "Context budget failed" });
  }
});


// --- EXTENSIONS ---
router.post("/api/assistant/extensions/install", requireAuth, async (req, res) => {
  const { publisher, name, version = "latest" } = req.body;
  if (!publisher || !name) return res.status(400).json({ error: "Missing publisher/name" });

  const extensionsDir = path.resolve(__dirname, "../../extensions");
  if (!fs.existsSync(extensionsDir)) fs.mkdirSync(extensionsDir, { recursive: true });

  const extId = `${publisher}.${name}`;
  const extPath = path.join(extensionsDir, extId);
  const zipPath = path.join(extensionsDir, `${extId}.vsix`);

  // Open VSX Direct Download URL
  const downloadUrl = `https://open-vsx.org/api/${publisher}/${name}/${version}/file/${extId}-${version}.vsix`;

  try {
    const { promisify } = require('util');
    const exec = promisify(require('child_process').exec);
    
    // Download using curl
    await exec(`curl -L -o "${zipPath}" "${downloadUrl}"`);
    // Extract using unzip
    if (!fs.existsSync(extPath)) fs.mkdirSync(extPath, { recursive: true });
    await exec(`unzip -o "${zipPath}" -d "${extPath}"`);
    // Cleanup zip
    if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

    res.json({ ok: true, message: `Extension ${extId} installed successfully.` });
  } catch (e) {
    console.error('Install extension fail:', e);
    res.status(500).json({ error: "Installation failed. Ensure the extension exists on Open VSX." });
  }
});

module.exports = router;
