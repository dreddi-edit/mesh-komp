"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEMO_EMAIL = "edgar@test.com";
const DEMO_PASSWORD = "12345";

let portCounter = 0;

function nextPort() {
  portCounter += 1;
  return 4500 + (process.pid % 400) + portCounter * 17;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
  const intervalMs = Math.max(50, Number(options.intervalMs) || 200);
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await condition();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }

  if (lastError) throw lastError;
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function makeTempEnvDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

async function startNodeProcess(entryPath, env, readyPattern) {
  const child = spawn(process.execPath, [entryPath], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (chunk) => {
    output += String(chunk || "");
  };

  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  try {
    await waitFor(() => readyPattern.test(output), { timeoutMs: 25000, intervalMs: 120 });
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`Failed to start ${entryPath}: ${error.message}\n${output}`);
  }

  return {
    child,
    getOutput() {
      return output;
    },
  };
}

async function stopNodeProcess(handle) {
  if (!handle?.child || handle.child.killed) return;
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => handle.child.once("exit", resolve)),
    wait(5000).then(() => {
      if (!handle.child.killed) handle.child.kill("SIGKILL");
    }),
  ]);
}

async function requestJson(baseUrl, pathname, jar, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (jar.cookie) headers.cookie = jar.cookie;

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    jar.cookie = setCookie.split(";")[0];
  }

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (error) {
    throw new Error(`Invalid JSON from ${pathname}: ${text}`);
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
  };
}

async function login(baseUrl, jar) {
  const response = await requestJson(baseUrl, "/api/auth/login", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.ok, true);
}

function sampleWorkspace(rootName) {
  return [
    {
      path: `${rootName}/home.html`,
      content: "<!doctype html>\n<html><body><main>Home workspace page</main></body></html>\n",
    },
    {
      path: `${rootName}/settings-account.html`,
      content: "<section><h1>Account settings</h1><p>Billing and profile controls.</p></section>\n",
    },
    {
      path: `${rootName}/assets/app.js`,
      content: [
        "import path from 'node:path';",
        "export const title = 'Mesh';",
        "export function printTitle(prefix = 'workspace') {",
        "  const full = `${prefix}:${title}`;",
        "  console.log(full);",
        "  return path.basename(full);",
        "}",
        "",
      ].join("\n"),
    },
  ];
}

function workspacePaths(rootName) {
  return {
    home: `${rootName}/home.html`,
    renamedHome: `${rootName}/dashboard/home.html`,
    settings: `${rootName}/settings-account.html`,
    app: `${rootName}/assets/app.js`,
    assistant: `${rootName}/assets/assistant.js`,
    notes: `${rootName}/notes.md`,
    docPlan: `${rootName}/docs/plan.md`,
  };
}

async function selectWorkspace(baseUrl, jar, rootName) {
  const response = await requestJson(baseUrl, "/api/assistant/workspace/select", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      folderName: rootName,
      files: sampleWorkspace(rootName),
    }),
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  assert.equal(response.json.ok, true);
}

async function exerciseWorkspaceCrudScenario(baseUrl, jar, rootName) {
  const paths = workspacePaths(rootName);

  await selectWorkspace(baseUrl, jar, rootName);

  const initialFiles = await requestJson(baseUrl, "/api/assistant/workspace/files", jar);
  assert.equal(initialFiles.json.files.length, 3);

  const search = await requestJson(baseUrl, `/api/assistant/workspace/search?q=${encodeURIComponent("settings account")}&limit=5`, jar);
  const grep = await requestJson(baseUrl, "/api/assistant/workspace/grep", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: "console.log", limit: 10 }),
  });
  const capsule = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.app)}&view=capsule`,
    jar
  );
  const focused = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.app)}&view=focused&q=${encodeURIComponent("title console")}`,
    jar
  );
  const transport = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.app)}&view=transport`,
    jar
  );
  const recovery = await requestJson(baseUrl, "/api/assistant/workspace/recovery", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: paths.app,
      query: "title console",
    }),
  });

  const rename = await requestJson(baseUrl, "/api/assistant/workspace/rename", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fromPath: "home.html",
      toPath: "dashboard/home.html",
    }),
  });
  assert.equal(rename.json.ok, true);

  const renamedOpen = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.renamedHome)}`,
    jar
  );
  assert.equal(renamedOpen.json.path, paths.renamedHome);

  const batch = await requestJson(baseUrl, "/api/assistant/workspace/batch", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      operations: [
        { type: "create", path: "notes.md", content: "# Notes\n\nMesh workspace summary.\n" },
        { type: "rename", fromPath: "assets/app.js", toPath: "assets/assistant.js" },
      ],
    }),
  });
  assert.equal(batch.json.ok, true);
  assert.equal(batch.json.appliedCount, 2);

  const deleteResult = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent("settings-account.html")}`,
    jar,
    { method: "DELETE" }
  );
  assert.equal(deleteResult.json.ok, true);

  const finalFiles = await requestJson(baseUrl, "/api/assistant/workspace/files", jar);
  const notesFile = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.notes)}`,
    jar
  );

  return {
    searchTop: search.json.matches?.[0]?.path || "",
    grepTop: grep.json.matches?.[0]?.path || "",
    capsuleEncoding: capsule.json.encoding,
    capsuleMode: capsule.json.capsule?.capsuleMode || "",
    capsuleHasSpan: /@sp_/.test(String(capsule.json.content || "")),
    focusedEncoding: focused.json.encoding,
    focusedQuery: focused.json.query || "",
    focusedHasTitle: /title/i.test(String(focused.json.content || "")),
    transportEncoding: transport.json.encoding,
    transportEnvelopeVersion: transport.json.envelopeVersion || "",
    transportContentEncoding: transport.json.contentEncoding || "",
    recoverySpanCount: recovery.json.spans?.length || 0,
    recoveryText: (recovery.json.spans || []).map((entry) => entry.text).join("\n"),
    renamedPath: renamedOpen.json.path,
    renamedContent: renamedOpen.json.content,
    notesPath: notesFile.json.path,
    notesContent: notesFile.json.content,
    finalFiles: (finalFiles.json.files || []).map((entry) => entry.path).sort(),
  };
}

test("fallback gateway serves the workbench and supports terminal plus multi-file run approvals", { timeout: 90000 }, async (t) => {
  const port = nextPort();
  const tmpDir = makeTempEnvDir("mesh-gateway-fallback");
  const dbFile = path.join(tmpDir, "secure.sqlite");
  const gateway = await startNodeProcess(
    "server.js",
    {
      PORT: String(port),
      MESH_CORE_URL: "http://127.0.0.1:65534/mesh/tunnel",
      MESH_SECURE_DB_FILE: dbFile,
      MESH_AUTH_COOKIE_NAME: `mesh_auth_${port}`,
      MESH_AUTH_COOKIE_SECURE: "false",
    },
    /"msg":"Server started"/
  );
  t.after(() => stopNodeProcess(gateway));

  const baseUrl = `http://127.0.0.1:${port}`;
  const jar = {};
  const rootName = "demo-workspace";
  const paths = workspacePaths(rootName);

  const appHtml = await fetch(`${baseUrl}/app.html`).then((response) => response.text());
  assert.match(appHtml, /assets\/app-workspace\.css/);
  assert.match(appHtml, /assets\/app-workspace\.js/);
  assert.match(appHtml, /meshAssistantWorkbenchBridge/);

  await login(baseUrl, jar);
  const session = await requestJson(baseUrl, "/api/auth/session", jar);
  assert.equal(session.status, 200);
  assert.equal(session.json.user.email, DEMO_EMAIL);

  await selectWorkspace(baseUrl, jar, rootName);

  const structureRun = await requestJson(baseUrl, "/api/assistant/runs", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "Bitte strukturiere die aktive HTML-Datei besser und mache sie lesbar.",
      model: "claude-sonnet-4-6",
      mode: "edit",
      autonomyMode: "review",
      workspaceFolderName: rootName,
      activeFilePath: paths.home,
      selectedPaths: [paths.home],
      chatSessionId: "integration-structure-edit",
    }),
  });
  assert.equal(structureRun.status, 201, JSON.stringify(structureRun.json));
  assert.equal(structureRun.json.run.artifacts.proposalBatches.length, 1);
  assert.equal(structureRun.json.run.artifacts.proposalBatches[0].proposals.length, 1);

  const structureAction = structureRun.json.run.actions.find((action) =>
    action.type === "apply_write_batch" && action.status === "requires_approval"
  );
  assert.ok(structureAction);

  const approveStructure = await requestJson(
    baseUrl,
    `/api/assistant/runs/${encodeURIComponent(structureRun.json.run.id)}/actions/${encodeURIComponent(structureAction.id)}`,
    jar,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    }
  );
  assert.equal(approveStructure.status, 200, JSON.stringify(approveStructure.json));

  const structuredHome = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.home)}`,
    jar
  );
  assert.equal(structuredHome.status, 200);
  assert.match(structuredHome.json.content, /\n  <body>\n/);
  assert.match(structuredHome.json.content, /\n    <main>\n/);
  assert.match(structuredHome.json.content, /\n      Home workspace page\n/);

  const terminal = await requestJson(baseUrl, "/api/assistant/terminal/session", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(terminal.status, 201);
  const sessionId = terminal.json.session.id;

  const marker = "assistant-terminal-smoke";
  await requestJson(baseUrl, `/api/assistant/terminal/session/${encodeURIComponent(sessionId)}/input`, jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: `echo ${marker}\n` }),
  });

  const terminalOutput = await waitFor(async () => {
    const output = await requestJson(
      baseUrl,
      `/api/assistant/terminal/session/${encodeURIComponent(sessionId)}/output?since=0`,
      jar
    );
    const combined = (output.json.entries || []).map((entry) => entry.text).join("\n");
    return combined.includes(marker) ? output : null;
  }, { timeoutMs: 12000, intervalMs: 250 });
  assert.match((terminalOutput.json.entries || []).map((entry) => entry.text).join("\n"), /assistant-terminal-smoke/);

  const runCreate = await requestJson(baseUrl, "/api/assistant/runs", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: 'Create "notes.md" and "docs/plan.md" with a short workspace summary.',
      model: "claude-sonnet-4-6",
      mode: "edit",
      autonomyMode: "review",
      workspaceFolderName: rootName,
      chatSessionId: "integration-multifile",
    }),
  });

  assert.equal(runCreate.status, 201, JSON.stringify(runCreate.json));
  assert.equal(runCreate.json.ok, true);
  assert.equal(runCreate.json.run.status, "awaiting_approval");
  assert.equal(runCreate.json.run.artifacts.proposalBatches.length, 1);
  assert.equal(runCreate.json.run.artifacts.proposalBatches[0].proposals.length, 2);

  const batch = runCreate.json.run.artifacts.proposalBatches[0];
  const proposalPathById = new Map(batch.proposals.map((proposal) => [proposal.id, proposal.path]));
  const approvalActions = runCreate.json.run.actions.filter((action) => action.type === "apply_write_batch" && action.status === "requires_approval");
  assert.equal(approvalActions.length, 2);

  const notesAction = approvalActions.find((action) => proposalPathById.get(action.payload.proposalId) === paths.notes);
  const docPlanAction = approvalActions.find((action) => proposalPathById.get(action.payload.proposalId) === paths.docPlan);
  assert.ok(notesAction);
  assert.ok(docPlanAction);

  const approveNotes = await requestJson(
    baseUrl,
    `/api/assistant/runs/${encodeURIComponent(runCreate.json.run.id)}/actions/${encodeURIComponent(notesAction.id)}`,
    jar,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "approve" }),
    }
  );
  assert.equal(approveNotes.json.ok, true);

  const rejectDocPlan = await requestJson(
    baseUrl,
    `/api/assistant/runs/${encodeURIComponent(runCreate.json.run.id)}/actions/${encodeURIComponent(docPlanAction.id)}`,
    jar,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: "reject" }),
    }
  );
  assert.equal(rejectDocPlan.json.ok, true);

  const notesFile = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.notes)}`,
    jar
  );
  assert.equal(notesFile.status, 200);
  assert.match(notesFile.json.content, /# notes\.md/i);

  const missingDocPlan = await requestJson(
    baseUrl,
    `/api/assistant/workspace/file?path=${encodeURIComponent(paths.docPlan)}`,
    jar
  );
  assert.equal(missingDocPlan.status, 404);

  const finalRun = rejectDocPlan.json.run;
  assert.equal(finalRun.artifacts.proposalBatches[0].status, "partial");
});

test("integration tests", async (t) => {
  const rootName = `test-workspace-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const workerPort = nextPort();
  const fallbackPort = nextPort();
  const workerGatewayPort = nextPort();
  const fallbackTmp = makeTempEnvDir("mesh-gateway-compare-fallback");
  const workerTmp = makeTempEnvDir("mesh-gateway-compare-worker");

  const worker = await startNodeProcess(
    path.join("mesh-core", "src", "server.js"),
    {
      PORT: String(workerPort),
    },
    /\[Mesh Tunnel Server\] Listening on port/
  );
  const fallbackGateway = await startNodeProcess(
    "server.js",
    {
      PORT: String(fallbackPort),
      MESH_CORE_URL: "http://127.0.0.1:65534/mesh/tunnel",
      MESH_SECURE_DB_FILE: path.join(fallbackTmp, "secure.sqlite"),
      MESH_AUTH_COOKIE_NAME: `mesh_auth_${fallbackPort}`,
      MESH_AUTH_COOKIE_SECURE: "false",
    },
    /"msg":"Server started"/
  );
  const workerGateway = await startNodeProcess(
    "server.js",
    {
      PORT: String(workerGatewayPort),
      MESH_CORE_URL: `http://127.0.0.1:${workerPort}/mesh/tunnel`,
      MESH_SECURE_DB_FILE: path.join(workerTmp, "secure.sqlite"),
      MESH_AUTH_COOKIE_NAME: `mesh_auth_${workerGatewayPort}`,
      MESH_AUTH_COOKIE_SECURE: "false",
    },
    /"msg":"Server started"/
  );

  t.after(() => stopNodeProcess(workerGateway));
  t.after(() => stopNodeProcess(fallbackGateway));
  t.after(() => stopNodeProcess(worker));

  const fallbackBaseUrl = `http://127.0.0.1:${fallbackPort}`;
  const workerBaseUrl = `http://127.0.0.1:${workerGatewayPort}`;
  const fallbackJar = {};
  const workerJar = {};

  await login(fallbackBaseUrl, fallbackJar);
  await login(workerBaseUrl, workerJar);

  const fallbackStatus = await requestJson(fallbackBaseUrl, "/api/assistant/status", fallbackJar);
  const workerStatus = await requestJson(workerBaseUrl, "/api/assistant/status", workerJar);
  assert.equal(fallbackStatus.json.mode, "local-fallback");
  assert.equal(workerStatus.json.mode, "mesh-worker");

  const fallbackSummary = await exerciseWorkspaceCrudScenario(fallbackBaseUrl, fallbackJar, "parity-workspace-fallback");
  const workerSummary = await exerciseWorkspaceCrudScenario(workerBaseUrl, workerJar, "parity-workspace-worker");

  assert.deepEqual(
    {
      searchTop: fallbackSummary.searchTop.split("/").slice(1).join("/"),
      grepTop: fallbackSummary.grepTop.split("/").slice(1).join("/"),
      capsuleEncoding: fallbackSummary.capsuleEncoding,
      capsuleMode: fallbackSummary.capsuleMode,
      capsuleHasSpan: fallbackSummary.capsuleHasSpan,
      focusedEncoding: fallbackSummary.focusedEncoding,
      focusedQuery: fallbackSummary.focusedQuery,
      focusedHasTitle: fallbackSummary.focusedHasTitle,
      transportEncoding: fallbackSummary.transportEncoding,
      transportEnvelopeVersion: fallbackSummary.transportEnvelopeVersion,
      transportContentEncoding: fallbackSummary.transportContentEncoding,
      recoverySpanCount: fallbackSummary.recoverySpanCount,
      recoveryText: fallbackSummary.recoveryText,
      renamedPath: fallbackSummary.renamedPath.split("/").slice(1).join("/"),
      renamedContent: fallbackSummary.renamedContent,
      notesPath: fallbackSummary.notesPath.split("/").slice(1).join("/"),
      notesContent: fallbackSummary.notesContent,
      finalFiles: fallbackSummary.finalFiles.map((entry) => entry.split("/").slice(1).join("/")),
    },
    {
      searchTop: workerSummary.searchTop.split("/").slice(1).join("/"),
      grepTop: workerSummary.grepTop.split("/").slice(1).join("/"),
      capsuleEncoding: workerSummary.capsuleEncoding,
      capsuleMode: workerSummary.capsuleMode,
      capsuleHasSpan: workerSummary.capsuleHasSpan,
      focusedEncoding: workerSummary.focusedEncoding,
      focusedQuery: workerSummary.focusedQuery,
      focusedHasTitle: workerSummary.focusedHasTitle,
      transportEncoding: workerSummary.transportEncoding,
      transportEnvelopeVersion: workerSummary.transportEnvelopeVersion,
      transportContentEncoding: workerSummary.transportContentEncoding,
      recoverySpanCount: workerSummary.recoverySpanCount,
      recoveryText: workerSummary.recoveryText,
      renamedPath: workerSummary.renamedPath.split("/").slice(1).join("/"),
      renamedContent: workerSummary.renamedContent,
      notesPath: workerSummary.notesPath.split("/").slice(1).join("/"),
      notesContent: workerSummary.notesContent,
      finalFiles: workerSummary.finalFiles.map((entry) => entry.split("/").slice(1).join("/")),
    }
  );
});
