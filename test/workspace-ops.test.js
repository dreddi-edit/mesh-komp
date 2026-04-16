"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveAdaptiveCompressedContextBudget,
} = require("../src/core/workspace-ops");

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

test("resolveAdaptiveCompressedContextBudget: single-file mode for explicit content query", () => {
  const result = resolveAdaptiveCompressedContextBudget({
    lastUserMessage: "what is in app.js",
    hasActiveFileFocus: false,
  });

  assert.equal(result.mode, "single-file");
  assert.equal(result.maxFiles, 1);
  assert.equal(result.disableCodecDictionary, true);
  assert.equal(result.maxTotalDecodedChars, 10000);
});

test("resolveAdaptiveCompressedContextBudget: active-file mode when focus + broad change intent", () => {
  const result = resolveAdaptiveCompressedContextBudget({
    lastUserMessage: "refactor this file to use async/await",
    hasActiveFileFocus: true,
  });

  assert.equal(result.mode, "active-file");
  assert.equal(result.maxFiles, 2);
  assert.equal(result.disableCodecDictionary, true);
  assert.equal(result.maxTotalDecodedChars, 26000);
});

test("resolveAdaptiveCompressedContextBudget: broad mode for multi-file comparison", () => {
  const result = resolveAdaptiveCompressedContextBudget({
    lastUserMessage: "compare all the route handlers across the codebase",
    hasActiveFileFocus: false,
  });

  assert.equal(result.mode, "broad");
  assert.equal(result.maxFiles, 3);
  assert.equal(result.disableCodecDictionary, false);
  assert.equal(result.maxTotalDecodedChars, 90000);
});

test("resolveAdaptiveCompressedContextBudget: balanced mode for generic greeting", () => {
  const result = resolveAdaptiveCompressedContextBudget({
    lastUserMessage: "Hello, how are you today?",
    hasActiveFileFocus: false,
  });

  assert.equal(result.mode, "balanced");
  assert.equal(result.maxFiles, 2);
  assert.equal(result.disableCodecDictionary, false);
  assert.equal(result.maxTotalDecodedChars, 52000);
});

test("resolveAdaptiveCompressedContextBudget: returns all required keys with numeric types", () => {
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
