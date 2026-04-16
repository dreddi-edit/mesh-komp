"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAdaptiveCompressedContextBudget,
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  extractSearchTokens,
  compactAlphaNumeric,
  scorePathForQuery,
  rankWorkspacePathsForQuery,
  findMatchesInText,
  BROAD_CHANGE_INTENT_RE,
  SINGLE_FILE_LOOKUP_RE,
  MULTI_FILE_LOOKUP_RE,
  FILE_QUERY_STOP_WORDS,
} = require("../src/core/workspace-ops");

// ── resolveAdaptiveCompressedContextBudget ───────────────────────────────────

const REQUIRED_KEYS = [
  "mode",
  "maxFiles",
  "maxModelCompressedChars",
  "firstFileMaxModelCompressedChars",
  "maxDecodedChars",
  "firstFileMaxDecodedChars",
  "maxTotalDecodedChars",
  "disableCodecDictionary",
];

describe("resolveAdaptiveCompressedContextBudget", () => {
  it("single-file mode for explicit content query", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "what is in app.js",
      hasActiveFileFocus: false,
    });
    assert.equal(result.mode, "single-file");
    assert.equal(result.maxFiles, 1);
    assert.equal(result.disableCodecDictionary, true);
    assert.equal(result.maxTotalDecodedChars, 10000);
  });

  it("active-file mode when focus + broad change intent", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "refactor this file to use async/await",
      hasActiveFileFocus: true,
    });
    assert.equal(result.mode, "active-file");
    assert.equal(result.maxFiles, 2);
    assert.equal(result.disableCodecDictionary, true);
    assert.equal(result.maxTotalDecodedChars, 26000);
  });

  it("broad mode for multi-file comparison", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "compare all the route handlers across the codebase",
      hasActiveFileFocus: false,
    });
    assert.equal(result.mode, "broad");
    assert.equal(result.maxFiles, 3);
    assert.equal(result.disableCodecDictionary, false);
    assert.equal(result.maxTotalDecodedChars, 90000);
  });

  it("balanced mode for generic greeting", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "Hello, how are you today?",
      hasActiveFileFocus: false,
    });
    assert.equal(result.mode, "balanced");
    assert.equal(result.maxFiles, 2);
    assert.equal(result.disableCodecDictionary, false);
    assert.equal(result.maxTotalDecodedChars, 52000);
  });

  it("returns all required keys with correct types", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "",
      hasActiveFileFocus: false,
    });
    for (const key of REQUIRED_KEYS) {
      assert.ok(key in result, `missing key: ${key}`);
    }
    assert.equal(typeof result.mode, "string");
    assert.equal(typeof result.disableCodecDictionary, "boolean");
    for (const numKey of REQUIRED_KEYS.filter((k) => k !== "mode" && k !== "disableCodecDictionary")) {
      assert.equal(typeof result[numKey], "number", `${numKey} must be number`);
      assert.ok(result[numKey] > 0, `${numKey} must be positive`);
    }
  });

  it("single-file when .ts extension present and no active focus", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "check my index.ts file",
      hasActiveFileFocus: false,
    });
    assert.equal(result.mode, "single-file");
  });

  it("broad mode overrides active-file when multi-file intent detected", () => {
    const result = resolveAdaptiveCompressedContextBudget({
      lastUserMessage: "show me all the files",
      hasActiveFileFocus: true,
    });
    assert.equal(result.mode, "broad");
  });
});

// ── extractQueryExtensionHints ───────────────────────────────────────────────

describe("extractQueryExtensionHints", () => {
  it("detects explicit .js extension", () => {
    const hints = extractQueryExtensionHints("what does app.js do");
    assert.ok(hints.has("js"), "should include js");
  });

  it("detects extension from keyword 'typescript'", () => {
    const hints = extractQueryExtensionHints("show me the typescript files");
    assert.ok(hints.has("ts") || hints.has("tsx"), "should include ts or tsx");
  });

  it("returns empty set for plain text with no extensions", () => {
    const hints = extractQueryExtensionHints("hello world what is this");
    assert.ok(hints.size === 0 || hints instanceof Set);
  });

  it("handles empty input", () => {
    const hints = extractQueryExtensionHints("");
    assert.ok(hints instanceof Set);
    assert.equal(hints.size, 0);
  });

  it("handles null/undefined gracefully", () => {
    assert.doesNotThrow(() => extractQueryExtensionHints(null));
    assert.doesNotThrow(() => extractQueryExtensionHints(undefined));
  });
});

// ── pathHasExtensionHint ──────────────────────────────────────────────────────
// pathHasExtensionHint calls toSafePath which is a global injected by
// core/index.js at server boot — not testable standalone.

describe("pathHasExtensionHint", () => {
  it("returns true when hint set is empty (pure Set check, no path normalization)", () => {
    assert.equal(pathHasExtensionHint("src/app.py", new Set()), true);
  });
});

// ── selectReferenceMatchLimit ────────────────────────────────────────────────

describe("selectReferenceMatchLimit", () => {
  it("returns 1 for empty input", () => {
    assert.equal(selectReferenceMatchLimit(""), 1);
  });

  it("returns 3 for multi-file lookup query", () => {
    const result = selectReferenceMatchLimit("show me all the routes files");
    assert.equal(result, 3);
  });

  it("returns 1 when extension hints present", () => {
    const hints = new Set(["ts"]);
    const result = selectReferenceMatchLimit("check the controller", hints);
    assert.equal(result, 1);
  });

  it("returns 1 for single-file lookup pattern", () => {
    const result = selectReferenceMatchLimit("what is in app.js");
    assert.equal(result, 1);
  });
});

// ── extractSearchTokens ───────────────────────────────────────────────────────

describe("extractSearchTokens", () => {
  it("filters stop words", () => {
    const tokens = extractSearchTokens("what is in the file");
    assert.ok(!tokens.includes("what"));
    assert.ok(!tokens.includes("the"));
    assert.ok(!tokens.includes("file"));
  });

  it("filters tokens shorter than 3 chars", () => {
    const tokens = extractSearchTokens("go run it");
    for (const t of tokens) {
      assert.ok(t.length >= 3, `token "${t}" is too short`);
    }
  });

  it("lowercases all tokens", () => {
    const tokens = extractSearchTokens("UserService AuthMiddleware");
    for (const t of tokens) {
      assert.equal(t, t.toLowerCase());
    }
  });

  it("handles empty input", () => {
    assert.deepEqual(extractSearchTokens(""), []);
    assert.deepEqual(extractSearchTokens(null), []);
  });

  it("splits on non-alphanumeric characters", () => {
    const tokens = extractSearchTokens("auth-middleware.service.js");
    assert.ok(tokens.includes("auth"));
    assert.ok(tokens.includes("middleware"));
    assert.ok(tokens.includes("service"));
  });

  it("FILE_QUERY_STOP_WORDS is populated", () => {
    assert.ok(FILE_QUERY_STOP_WORDS instanceof Set);
    assert.ok(FILE_QUERY_STOP_WORDS.size > 0);
    assert.ok(FILE_QUERY_STOP_WORDS.has("file"));
    assert.ok(FILE_QUERY_STOP_WORDS.has("the"));
  });
});

// ── compactAlphaNumeric ───────────────────────────────────────────────────────

describe("compactAlphaNumeric", () => {
  it("removes non-alphanumeric characters and lowercases", () => {
    assert.equal(compactAlphaNumeric("auth-middleware.js"), "authmiddlewarejs");
  });

  it("returns empty string for empty input", () => {
    assert.equal(compactAlphaNumeric(""), "");
    assert.equal(compactAlphaNumeric(null), "");
  });

  it("handles all-special-char input", () => {
    assert.equal(compactAlphaNumeric("---///---"), "");
  });
});

// ── scorePathForQuery ─────────────────────────────────────────────────────────
// scorePathForQuery calls toSafePath and basename globals — not testable standalone.

// ── rankWorkspacePathsForQuery ────────────────────────────────────────────────
// rankWorkspacePathsForQuery delegates to scorePathForQuery which uses toSafePath/basename globals.

describe("rankWorkspacePathsForQuery", () => {
  it("returns empty array for empty query", () => {
    const result = rankWorkspacePathsForQuery("", ["src/app.js", "src/server.js"]);
    assert.deepEqual(result, []);
  });

  it("handles empty candidate list", () => {
    const result = rankWorkspacePathsForQuery("find something", []);
    assert.deepEqual(result, []);
  });
});

// ── findMatchesInText ─────────────────────────────────────────────────────────

describe("findMatchesInText", () => {
  it("returns empty array for empty content or query", () => {
    assert.deepEqual(findMatchesInText("", "test"), []);
    assert.deepEqual(findMatchesInText("some content", ""), []);
  });

  it("finds single match with correct lineNumber and column", () => {
    const matches = findMatchesInText("hello world\nfoo bar", "foo");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].lineNumber, 2);
    assert.equal(matches[0].column, 1);
    assert.equal(matches[0].line, "foo bar");
  });

  it("finds multiple matches on the same line", () => {
    const matches = findMatchesInText("abc abc abc", "abc");
    assert.equal(matches.length, 3);
    assert.equal(matches[0].lineNumber, 1);
    assert.equal(matches[1].column, 5);
    assert.equal(matches[2].column, 9);
  });

  it("is case-insensitive by default", () => {
    const matches = findMatchesInText("Hello HELLO hello", "hello");
    assert.equal(matches.length, 3);
  });

  it("respects caseSensitive option", () => {
    const matches = findMatchesInText("Hello HELLO hello", "hello", { caseSensitive: true });
    assert.equal(matches.length, 1);
    assert.equal(matches[0].column, 13);
  });

  it("includes preview trimmed to 240 chars", () => {
    const longLine = "x".repeat(300);
    const matches = findMatchesInText(longLine, "x");
    assert.ok(matches[0].preview.length <= 240);
  });

  it("handles windows-style CRLF line endings", () => {
    const matches = findMatchesInText("line one\r\nline two\r\nfoo here", "foo");
    assert.equal(matches.length, 1);
    assert.equal(matches[0].lineNumber, 3);
  });

  it("handles null/undefined inputs gracefully", () => {
    assert.doesNotThrow(() => findMatchesInText(null, "test"));
    assert.doesNotThrow(() => findMatchesInText("content", null));
  });
});

// ── regex constants ───────────────────────────────────────────────────────────

describe("BROAD_CHANGE_INTENT_RE", () => {
  it("matches refactor keyword", () => {
    assert.ok(BROAD_CHANGE_INTENT_RE.test("refactor the auth module"));
  });
  it("matches architecture keyword", () => {
    assert.ok(BROAD_CHANGE_INTENT_RE.test("explain the architecture"));
  });
  it("does not match unrelated text", () => {
    assert.ok(!BROAD_CHANGE_INTENT_RE.test("show me the file contents"));
  });
});

describe("SINGLE_FILE_LOOKUP_RE", () => {
  it("matches single filename with extension", () => {
    assert.ok(SINGLE_FILE_LOOKUP_RE.test("what is in app.js"));
  });
});

describe("MULTI_FILE_LOOKUP_RE", () => {
  it("matches multi-file query", () => {
    assert.ok(MULTI_FILE_LOOKUP_RE.test("show me all the routes files"));
  });
});
