"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// ── env-utils tests ──

test("parseBooleanFlag returns fallback for empty input", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  assert.equal(parseBooleanFlag(undefined, false), false);
  assert.equal(parseBooleanFlag(null, true), true);
  assert.equal(parseBooleanFlag("", false), false);
});

test("parseBooleanFlag parses truthy strings", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  for (const value of ["1", "true", "yes", "on", "enabled"]) {
    assert.equal(parseBooleanFlag(value, false), true, `expected true for "${value}"`);
  }
});

test("parseBooleanFlag parses falsy strings", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  for (const value of ["0", "false", "no", "off", "disabled"]) {
    assert.equal(parseBooleanFlag(value, true), false, `expected false for "${value}"`);
  }
});

test("parseIntegerInRange clamps to range", () => {
  const { parseIntegerInRange } = require("../src/config/env-utils");
  assert.equal(parseIntegerInRange("50", 10, 1, 100), 50);
  assert.equal(parseIntegerInRange("200", 10, 1, 100), 100);
  assert.equal(parseIntegerInRange("-5", 10, 1, 100), 1);
  assert.equal(parseIntegerInRange(undefined, 10, 1, 100), 10);
  assert.equal(parseIntegerInRange("abc", 10, 1, 100), 10);
});

test("clampBrotliQuality clamps 0-11", () => {
  const { clampBrotliQuality } = require("../src/config/env-utils");
  assert.equal(clampBrotliQuality("7", 5), 7);
  assert.equal(clampBrotliQuality("15", 5), 11);
  assert.equal(clampBrotliQuality("-3", 5), 0);
  assert.equal(clampBrotliQuality(undefined, 5), 5);
});

test("trimTrailingSlashes removes trailing slashes", () => {
  const { trimTrailingSlashes } = require("../src/config/env-utils");
  assert.equal(trimTrailingSlashes("https://example.com///"), "https://example.com");
  assert.equal(trimTrailingSlashes(""), "");
});

test("normalizeSasToken strips leading question marks", () => {
  const { normalizeSasToken } = require("../src/config/env-utils");
  assert.equal(normalizeSasToken("??sv=2021"), "sv=2021");
  assert.equal(normalizeSasToken("sv=2021"), "sv=2021");
  assert.equal(normalizeSasToken(""), "");
});

test("sanitizeBlobContainerName lowercases and strips invalid chars", () => {
  const { sanitizeBlobContainerName } = require("../src/config/env-utils");
  assert.equal(sanitizeBlobContainerName("My_Container!"), "mycontainer");
  assert.equal(sanitizeBlobContainerName("valid-name-123"), "valid-name-123");
});

// ── config module tests ──

test("config module exports all expected keys", () => {
  const config = require("../src/config");
  assert.equal(typeof config.NODE_ENV, "string");
  assert.equal(typeof config.IS_PRODUCTION, "boolean");
  assert.equal(typeof config.PORT, "number");
  assert.equal(typeof config.MESH_CORE_URL, "string");
  assert.equal(typeof config.ANTHROPIC_API_KEY, "string");
  assert.equal(typeof config.MESH_DEFAULT_MODEL, "string");
  assert.equal(typeof config.WORKSPACE_BROTLI_QUALITY, "number");
  assert.equal(typeof config.MESH_WORKSPACE_PERF_LOG, "boolean");
});

test("config validation fails in production without encryption key", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_COSMOS_ENDPOINT: "https://example.com",
    MESH_COSMOS_KEY: "key",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_DATA_ENCRYPTION_KEY")));
});

test("config validation passes in production with all required vars", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
    MESH_DYNAMO_ENABLED: "true",
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("config validation warns when ANTHROPIC_API_KEY is missing", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "development",
  });
  assert.ok(result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});
