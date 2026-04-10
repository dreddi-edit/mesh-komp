"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

/**
 * Helper — runs startup checks with a temporary env overlay, then restores original values.
 */
function checkWithEnv(overlay) {
  const saved = {};
  for (const key of Object.keys(overlay)) {
    saved[key] = process.env[key];
    if (overlay[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overlay[key];
    }
  }

  // Re-require to pick up fresh env reads (module is stateless, no cache issue)
  const { runStartupChecks } = require("../src/core/startup-checks");
  const result = runStartupChecks();

  for (const key of Object.keys(saved)) {
    if (saved[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = saved[key];
    }
  }

  return result;
}

test("given development env with no vars set, returns ok=true with warnings", () => {
  const result = checkWithEnv({
    NODE_ENV: undefined,
    MESH_DATA_ENCRYPTION_KEY: undefined,
    AUTH_SECRET: undefined,
    MESH_COSMOS_ENDPOINT: undefined,
    MESH_COSMOS_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
  });

  assert.equal(result.ok, true, "should be ok in dev even without vars");
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.length >= 1, "should have at least one warning");
});

test("given production env without encryption key, returns ok=false", () => {
  const result = checkWithEnv({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: undefined,
    AUTH_SECRET: undefined,
    MESH_COSMOS_ENDPOINT: "https://example.documents.azure.com",
    MESH_COSMOS_KEY: "some-key",
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_DATA_ENCRYPTION_KEY")));
});

test("given production env without Cosmos DB config, returns ok=false", () => {
  const result = checkWithEnv({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
    MESH_COSMOS_ENDPOINT: undefined,
    MESH_COSMOS_KEY: undefined,
  });

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_COSMOS_ENDPOINT")));
});

test("given production env with all required vars, returns ok=true", () => {
  const result = checkWithEnv({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
    MESH_COSMOS_ENDPOINT: "https://example.documents.azure.com",
    MESH_COSMOS_KEY: "some-key",
  });

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("given no ANTHROPIC_API_KEY, includes a warning", () => {
  const result = checkWithEnv({
    NODE_ENV: undefined,
    ANTHROPIC_API_KEY: undefined,
  });

  assert.ok(result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});

test("given ANTHROPIC_API_KEY set, no warning about it", () => {
  const result = checkWithEnv({
    NODE_ENV: undefined,
    ANTHROPIC_API_KEY: "sk-ant-test-key",
  });

  assert.ok(!result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});
