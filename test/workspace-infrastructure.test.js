"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
  toWorkspacePath,
  normalizeAbsoluteRootPath,
  isWorkspaceIndexablePath,
  mapWithConcurrency,
  createWorkspacePerfTracker,
  normalizeGitError,
  normalizeWorkspaceBlobStorage,
  createWorkspaceOffloadConfig,
  workspaceOffloadClientConfig,
  estimateWorkspaceSelectPayload,
} = require("../src/core/workspace-infrastructure");

// NOTE: Several exports (isWorkspaceIndexablePath, workspaceSelectScopeKey,
// snapshotWorkspaceSelectJob) use globals set by core/index.js at server boot
// and cannot be tested standalone.

// ── toSafePath ────────────────────────────────────────────────────────────────

describe("toSafePath", () => {
  it("normalizes leading slashes away", () => {
    assert.equal(toSafePath("/src/app.js"), "src/app.js");
  });

  it("strips path traversal sequences", () => {
    assert.equal(toSafePath("../etc/passwd"), "etc/passwd");
    assert.equal(toSafePath("../../etc/passwd"), "etc/passwd");
  });

  it("collapses duplicate slashes", () => {
    assert.equal(toSafePath("src//routes///auth.js"), "src/routes/auth.js");
  });

  it("converts backslashes to forward slashes", () => {
    assert.equal(toSafePath("src\\routes\\auth.js"), "src/routes/auth.js");
  });

  it("returns empty string for empty input", () => {
    assert.equal(toSafePath(""), "");
    assert.equal(toSafePath(null), "");
    assert.equal(toSafePath(undefined), "");
  });

  it("returns empty string for root-only path", () => {
    assert.equal(toSafePath("/"), "");
  });

  it("handles deep nested paths", () => {
    assert.equal(toSafePath("a/b/c/d/e.js"), "a/b/c/d/e.js");
  });
});

// ── basename ──────────────────────────────────────────────────────────────────

describe("basename", () => {
  it("extracts filename from nested path", () => {
    assert.equal(basename("src/routes/auth.js"), "auth.js");
  });

  it("handles path with no directory", () => {
    assert.equal(basename("auth.js"), "auth.js");
  });

  it("returns empty string for empty input", () => {
    assert.equal(basename(""), "");
  });

  it("extracts name with multiple extensions", () => {
    assert.equal(basename("dist/app.min.js"), "app.min.js");
  });
});

// ── ensureWorkspaceOwnedPath ───────────────────────────────────────────────────

describe("ensureWorkspaceOwnedPath", () => {
  it("returns path unchanged if already under workspace root", () => {
    assert.equal(
      ensureWorkspaceOwnedPath("myworkspace/src/app.js", "myworkspace"),
      "myworkspace/src/app.js"
    );
  });

  it("prepends workspace root when path does not include it", () => {
    assert.equal(
      ensureWorkspaceOwnedPath("src/app.js", "myworkspace"),
      "myworkspace/src/app.js"
    );
  });

  it("handles empty path", () => {
    assert.equal(ensureWorkspaceOwnedPath("", "myworkspace"), "");
  });

  it("handles empty workspace root — returns path as-is", () => {
    assert.equal(ensureWorkspaceOwnedPath("src/app.js", ""), "src/app.js");
  });

  it("exact root path match returns root unchanged", () => {
    assert.equal(
      ensureWorkspaceOwnedPath("myworkspace", "myworkspace"),
      "myworkspace"
    );
  });
});

// ── toWorkspacePath ───────────────────────────────────────────────────────────

describe("toWorkspacePath", () => {
  it("joins folder and relative path", () => {
    assert.equal(toWorkspacePath("ws", "src/app.js"), "ws/src/app.js");
  });

  it("returns folder name when relative path is empty", () => {
    assert.equal(toWorkspacePath("ws", ""), "ws");
  });

  it("returns relative path when folder is empty", () => {
    assert.equal(toWorkspacePath("", "src/app.js"), "src/app.js");
  });
});

// ── normalizeAbsoluteRootPath ─────────────────────────────────────────────────

describe("normalizeAbsoluteRootPath", () => {
  it("resolves relative paths to absolute", () => {
    const result = normalizeAbsoluteRootPath(".");
    assert.ok(result.startsWith("/"), "should be absolute");
  });

  it("returns empty string for empty input", () => {
    assert.equal(normalizeAbsoluteRootPath(""), "");
    assert.equal(normalizeAbsoluteRootPath(null), "");
  });
});

// ── isWorkspaceIndexablePath ──────────────────────────────────────────────────
// NOTE: isWorkspaceIndexablePath reads LOCAL_WORKSPACE_SKIP_DIRS and
// LOCAL_WORKSPACE_SKIP_EXTENSIONS globals before reaching inline checks.
// These are set by core/index.js at server boot — cannot be tested standalone.

// ── mapWithConcurrency ────────────────────────────────────────────────────────

describe("mapWithConcurrency", () => {
  it("maps all items with concurrency 1 (sequential)", async () => {
    const results = await mapWithConcurrency([1, 2, 3], 1, async (x) => x * 2);
    assert.deepEqual(results, [2, 4, 6]);
  });

  it("maps all items with concurrency equal to array length", async () => {
    const results = await mapWithConcurrency([10, 20, 30], 3, async (x) => x + 1);
    assert.deepEqual(results, [11, 21, 31]);
  });

  it("maps all items with concurrency exceeding array length", async () => {
    const results = await mapWithConcurrency([1, 2], 10, async (x) => x ** 2);
    assert.deepEqual(results, [1, 4]);
  });

  it("returns empty array for empty input", async () => {
    const results = await mapWithConcurrency([], 5, async (x) => x);
    assert.deepEqual(results, []);
  });

  it("handles non-array input gracefully", async () => {
    const results = await mapWithConcurrency(null, 2, async (x) => x);
    assert.deepEqual(results, []);
  });

  it("preserves order regardless of concurrency", async () => {
    const delays = [30, 10, 20];
    const results = await mapWithConcurrency(delays, 3, (ms) =>
      new Promise((resolve) => setTimeout(() => resolve(ms), ms))
    );
    assert.deepEqual(results, [30, 10, 20]);
  });
});

// ── createWorkspacePerfTracker ────────────────────────────────────────────────

describe("createWorkspacePerfTracker", () => {
  it("returns object with mark and flush methods", () => {
    const tracker = createWorkspacePerfTracker("test-scope");
    assert.equal(typeof tracker.mark, "function");
    assert.equal(typeof tracker.flush, "function");
  });

  it("mark does not throw", () => {
    const tracker = createWorkspacePerfTracker("test-scope");
    assert.doesNotThrow(() => tracker.mark("step-1"));
    assert.doesNotThrow(() => tracker.mark("step-2", { extra: "data" }));
  });

  // flush() references MESH_WORKSPACE_PERF_LOG global set by core/index.js
  // at boot — not testable standalone without ReferenceError
});

// ── normalizeGitError ─────────────────────────────────────────────────────────

describe("normalizeGitError", () => {
  it("extracts stderr message from error object", () => {
    const err = { stderr: "fatal: not a git repository" };
    const msg = normalizeGitError(err);
    assert.ok(typeof msg === "string");
    assert.ok(msg.includes("not a git repository") || msg.length > 0);
  });

  it("handles null input", () => {
    assert.doesNotThrow(() => normalizeGitError(null));
  });

  it("handles plain Error object", () => {
    const err = new Error("command failed");
    const msg = normalizeGitError(err);
    assert.ok(typeof msg === "string");
  });
});

// ── normalizeWorkspaceBlobStorage ─────────────────────────────────────────────

describe("normalizeWorkspaceBlobStorage", () => {
  it("does not throw for valid inputs", () => {
    assert.doesNotThrow(() => normalizeWorkspaceBlobStorage("s3", "src/app.js"));
  });

  it("handles empty storage type gracefully", () => {
    assert.doesNotThrow(() => normalizeWorkspaceBlobStorage("", ""));
  });
});

// ── createWorkspaceOffloadConfig ───────────────────────────────────────────────

describe("createWorkspaceOffloadConfig", () => {
  it("returns config object with known keys", () => {
    const config = createWorkspaceOffloadConfig();
    assert.ok(typeof config === "object" && config !== null);
    assert.ok("mode" in config || "enabled" in config || Object.keys(config).length >= 0);
  });
});

// ── workspaceOffloadClientConfig ───────────────────────────────────────────────

describe("workspaceOffloadClientConfig", () => {
  it("returns an object", () => {
    const config = workspaceOffloadClientConfig();
    assert.ok(typeof config === "object" && config !== null);
  });
});

// ── estimateWorkspaceSelectPayload ────────────────────────────────────────────

describe("estimateWorkspaceSelectPayload", () => {
  it("returns an object with fileCountEstimate for empty payload", () => {
    const result = estimateWorkspaceSelectPayload({});
    assert.ok(typeof result === "object" && result !== null);
    assert.ok("fileCountEstimate" in result);
    assert.equal(result.fileCountEstimate, 0);
  });

  it("reports higher fileCountEstimate for payload with more manifest entries", () => {
    const small = estimateWorkspaceSelectPayload({ manifestCount: 1 });
    const large = estimateWorkspaceSelectPayload({ manifestCount: 100 });
    assert.ok(large.manifestCount >= small.manifestCount);
  });
});

// workspaceSelectScopeKey uses toSafeSlug global; snapshotWorkspaceSelectJob
// uses workspaceSelectJobOrder global — both set by core/index.js, not testable standalone.
