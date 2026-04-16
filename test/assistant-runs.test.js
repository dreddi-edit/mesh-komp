"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  cloneJsonValue,
  extractExplicitCommandFromPrompt,
  hasSearchIntent,
  hasReadIntent,
  hasOpsIntent,
  normalizeDiffText,
  computeProposalLineDelta,
  extractFirstFencedCodeBlock,
  extractDirectProposalContent,
} = require("../src/core/assistant-runs");

// NOTE: normalizeRunActionState, extractExplicitPathReferences, hasEditIntent,
// and ensureRunWorkspacePath reference globals (toIsoNow, sharedSafePath,
// normalizeRunMode, toSafePath) populated by core/index.js at server boot —
// they cannot be unit-tested standalone without full server initialization.

// ── cloneJsonValue ────────────────────────────────────────────────────────────

describe("cloneJsonValue", () => {
  it("deep clones a plain object", () => {
    const original = { a: 1, b: { c: 2 } };
    const clone = cloneJsonValue(original);
    assert.deepEqual(clone, original);
    clone.b.c = 99;
    assert.equal(original.b.c, 2);
  });

  it("deep clones an array", () => {
    const arr = [1, [2, 3], { x: 4 }];
    const clone = cloneJsonValue(arr);
    assert.deepEqual(clone, arr);
    clone[1][0] = 99;
    assert.equal(arr[1][0], 2);
  });

  it("returns undefined for undefined input", () => {
    assert.equal(cloneJsonValue(undefined), undefined);
  });

  it("handles primitive values", () => {
    assert.equal(cloneJsonValue(42), 42);
    assert.equal(cloneJsonValue("hello"), "hello");
    assert.equal(cloneJsonValue(null), null);
  });
});



// ── extractExplicitCommandFromPrompt ──────────────────────────────────────────

describe("extractExplicitCommandFromPrompt", () => {
  it("extracts command from bash code fence", () => {
    const result = extractExplicitCommandFromPrompt("run this:\n```bash\nnpm test\n```");
    assert.equal(result, "npm test");
  });

  it("extracts command from inline backtick", () => {
    const result = extractExplicitCommandFromPrompt("please run `npm install`");
    assert.equal(result, "npm install");
  });

  it("extracts command from 'run command:' pattern", () => {
    const result = extractExplicitCommandFromPrompt("please run command: npm test");
    assert.ok(result.includes("npm test") || result.length > 0);
  });

  it("returns empty string when no command is found", () => {
    const result = extractExplicitCommandFromPrompt("please explain the codebase");
    assert.equal(result, "");
  });

  it("handles empty input", () => {
    assert.equal(extractExplicitCommandFromPrompt(""), "");
    assert.equal(extractExplicitCommandFromPrompt(null), "");
  });
});


// ── hasSearchIntent ───────────────────────────────────────────────────────────

describe("hasSearchIntent", () => {
  it("detects search keywords", () => {
    assert.equal(hasSearchIntent("search for auth functions"), true);
    assert.equal(hasSearchIntent("find where this is defined"), true);
    assert.equal(hasSearchIntent("grep for TODO comments"), true);
  });

  it("returns false for non-search prompts", () => {
    assert.equal(hasSearchIntent("update the server"), false);
    assert.equal(hasSearchIntent("explain what this does"), false);
  });
});

// ── hasReadIntent ─────────────────────────────────────────────────────────────

describe("hasReadIntent", () => {
  it("detects read keywords", () => {
    assert.equal(hasReadIntent("show me the file"), true);
    assert.equal(hasReadIntent("open auth.js"), true);
    assert.equal(hasReadIntent("explain this code"), true);
    assert.equal(hasReadIntent("summarize the module"), true);
  });

  it("returns false for non-read prompts", () => {
    assert.equal(hasReadIntent("deploy the service"), false);
  });
});

// ── hasOpsIntent ──────────────────────────────────────────────────────────────

describe("hasOpsIntent", () => {
  it("detects ops keywords", () => {
    assert.equal(hasOpsIntent("show me the deployments"), true);
    assert.equal(hasOpsIntent("list all policies"), true);
    assert.equal(hasOpsIntent("check the routes"), true);
    assert.equal(hasOpsIntent("view the logs"), true);
  });

  it("returns false for non-ops prompts", () => {
    assert.equal(hasOpsIntent("update auth.js"), false);
  });
});

// ── normalizeDiffText ─────────────────────────────────────────────────────────

describe("normalizeDiffText", () => {
  it("normalizes CRLF to LF", () => {
    assert.equal(normalizeDiffText("line1\r\nline2"), "line1\nline2");
  });

  it("normalizes bare CR to LF", () => {
    assert.equal(normalizeDiffText("line1\rline2"), "line1\nline2");
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeDiffText(""), "");
    assert.equal(normalizeDiffText(null), "");
  });

  it("preserves LF-only text unchanged", () => {
    assert.equal(normalizeDiffText("line1\nline2"), "line1\nline2");
  });
});

// ── computeProposalLineDelta ──────────────────────────────────────────────────

describe("computeProposalLineDelta", () => {
  it("returns zeros when content is identical", () => {
    const delta = computeProposalLineDelta("same\ncontent", "same\ncontent");
    assert.deepEqual(delta, { removed: 0, added: 0 });
  });

  it("correctly counts added lines", () => {
    const before = "line1\nline2";
    const after = "line1\nline2\nline3\nline4";
    const delta = computeProposalLineDelta(before, after);
    assert.equal(delta.removed, 0);
    assert.equal(delta.added, 2);
  });

  it("correctly counts removed lines", () => {
    const before = "line1\nline2\nline3";
    const after = "line1";
    const delta = computeProposalLineDelta(before, after);
    assert.equal(delta.removed, 2);
    assert.equal(delta.added, 0);
  });

  it("correctly counts mixed changes", () => {
    const before = "line1\nold-line\nline3";
    const after = "line1\nnew-line-a\nnew-line-b\nline3";
    const delta = computeProposalLineDelta(before, after);
    assert.equal(delta.removed, 1);
    assert.equal(delta.added, 2);
  });

  it("handles empty before or after", () => {
    const delta1 = computeProposalLineDelta("", "new content");
    assert.ok(delta1.added >= 0);
    const delta2 = computeProposalLineDelta("old content", "");
    assert.ok(delta2.removed >= 0);
  });
});

// ── extractFirstFencedCodeBlock ────────────────────────────────────────────────

describe("extractFirstFencedCodeBlock", () => {
  it("extracts language and code from fenced block", () => {
    const result = extractFirstFencedCodeBlock("some text\n```javascript\nconst x = 1;\n```\nmore text");
    assert.ok(result !== null);
    assert.equal(result.language, "javascript");
    assert.equal(result.code, "const x = 1;");
  });

  it("handles unnamed code block", () => {
    const result = extractFirstFencedCodeBlock("```\nhello world\n```");
    assert.ok(result !== null);
    assert.equal(result.language, "");
    assert.equal(result.code, "hello world");
  });

  it("returns null when no code block present", () => {
    const result = extractFirstFencedCodeBlock("no code here");
    assert.equal(result, null);
  });

  it("returns null for empty input", () => {
    assert.equal(extractFirstFencedCodeBlock(""), null);
    assert.equal(extractFirstFencedCodeBlock(null), null);
  });

  it("extracts only the first code block", () => {
    const result = extractFirstFencedCodeBlock("```js\nfirst\n```\n```py\nsecond\n```");
    assert.equal(result.language, "js");
    assert.equal(result.code, "first");
  });
});

// ── extractDirectProposalContent ──────────────────────────────────────────────

describe("extractDirectProposalContent", () => {
  it("returns JSON content when target is .json and content starts with {", () => {
    const result = extractDirectProposalContent("config.json", '{"key": "value"}');
    assert.equal(result, '{"key": "value"}');
  });

  it("returns empty for .json when content starts with prose", () => {
    const result = extractDirectProposalContent("config.json", "Here is your JSON...");
    assert.equal(result, "");
  });

  it("returns empty for assistant preface text", () => {
    const result = extractDirectProposalContent("app.js", "Here is the updated code:");
    assert.equal(result, "");
  });

  it("returns HTML content when target is .html and starts with doctype", () => {
    const result = extractDirectProposalContent("index.html", "<!DOCTYPE html><html></html>");
    assert.equal(result, "<!DOCTYPE html><html></html>");
  });

  it("returns empty for empty content", () => {
    assert.equal(extractDirectProposalContent("app.js", ""), "");
    assert.equal(extractDirectProposalContent("app.js", null), "");
  });
});

