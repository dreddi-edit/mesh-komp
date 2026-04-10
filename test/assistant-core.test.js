"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildStructuralEditFallback,
  classifyTerminalCommandGuard,
  extractFirstJsonObject,
  extractQueryExtensionHints,
  normalizeAssistantEditPrefs,
  pathHasExtensionHint,
  rankWorkspacePathsForQuery,
  sanitizeAssistantRunPlan,
  shouldAutoApplyAction,
  toSafePath,
} = require("../assistant-core");

test("extractFirstJsonObject pulls json from fenced responses", () => {
  const payload = extractFirstJsonObject("planner reply\n```json\n{\"summary\":\"ok\",\"actions\":[]}\n```");
  assert.equal(payload, "{\"summary\":\"ok\",\"actions\":[]}");
});

test("sanitizeAssistantRunPlan keeps only supported actions", () => {
  const plan = sanitizeAssistantRunPlan({
    mode: "agent",
    summary: "Plan",
    actions: [
      { type: "search_workspace", payload: { q: "home page" } },
      { type: "unsupported_action", payload: {} },
      { type: "apply_write_batch", payload: { batchId: "latest-proposal" } },
    ],
  });

  assert.equal(plan.mode, "agent");
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].type, "search_workspace");
  assert.equal(plan.actions[1].type, "apply_write_batch");
});

test("toSafePath strips traversal and duplicate separators", () => {
  assert.equal(toSafePath("../app//pages/../home.html"), "app/home.html");
});

test("rankWorkspacePathsForQuery ranks the strongest filename match first", () => {
  const ranked = rankWorkspacePathsForQuery(
    "please update the settings account page",
    [
      "home.html",
      "settings-account.html",
      "assets/settings.js",
    ],
    3,
  );

  assert.equal(ranked[0], "settings-account.html");
});

test("extension hints filter matching paths", () => {
  const hints = extractQueryExtensionHints("search html layout files");
  assert.equal(pathHasExtensionHint("home.html", hints), true);
  assert.equal(pathHasExtensionHint("assets/settings.js", hints), false);
});

test("classifyTerminalCommandGuard distinguishes safe and destructive commands", () => {
  const safe = classifyTerminalCommandGuard("ls -la");
  const dangerous = classifyTerminalCommandGuard("rm -rf /tmp/demo");

  assert.equal(safe.needsApproval, false);
  assert.equal(dangerous.needsApproval, true);
  assert.equal(dangerous.risk, "destructive");
});

test("shouldAutoApplyAction respects autonomy rules", () => {
  assert.equal(shouldAutoApplyAction("apply_write_batch", "review", {}), false);
  assert.equal(shouldAutoApplyAction("apply_write_batch", "auto_edit_confirm_run", {}), true);
  assert.equal(shouldAutoApplyAction("run_terminal_command", "autonomous", { command: "rm -rf build" }), false);
  assert.equal(shouldAutoApplyAction("run_terminal_command", "autonomous", { command: "ls src" }), true);
});

test("normalizeAssistantEditPrefs keeps the new autonomy model stable", () => {
  const prefs = normalizeAssistantEditPrefs({
    autonomyMode: "autonomous",
    defaultMode: "agent",
    linkTerminal: false,
  });

  assert.deepEqual(prefs, {
    autonomyMode: "autonomous",
    defaultMode: "agent",
    linkTerminal: false,
    autoAccept: true,
  });
});

test("buildStructuralEditFallback reformats minified html for structure prompts", () => {
  const input = "<!doctype html><html><body><main><h1>Title</h1><p>Hello</p></main></body></html>";
  const output = buildStructuralEditFallback("home.html", "Bitte strukturiere die Datei besser.", input);

  assert.notEqual(output, input);
  assert.match(output, /<html>/);
  assert.match(output, /\n  <body>\n/);
  assert.match(output, /\n      <p>\n/);
  assert.match(output, /\n        Hello\n/);
});

test("buildStructuralEditFallback preserves readable content for non-structural prompts", () => {
  const input = [
    "<!doctype html>",
    "<html>",
    "  <body>",
    "    <main>Hello</main>",
    "  </body>",
    "</html>",
    "",
  ].join("\n");
  const output = buildStructuralEditFallback("home.html", "Add analytics later.", input);

  assert.equal(output, input);
});
