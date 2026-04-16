"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeDeploymentRisk,
  normalizePolicyMode,
  normalizePolicyStatus,
  normalizePolicyRegion,
  parsePolicyScopeFromPayload,
  stringifyPolicyScope,
} = require("../src/core/deployments");

// ── normalizeDeploymentRisk ───────────────────────────────────────────────────

describe("normalizeDeploymentRisk", () => {
  it("passes through valid values", () => {
    assert.equal(normalizeDeploymentRisk("low"), "low");
    assert.equal(normalizeDeploymentRisk("moderate"), "moderate");
    assert.equal(normalizeDeploymentRisk("high"), "high");
  });

  it("lowercases input", () => {
    assert.equal(normalizeDeploymentRisk("HIGH"), "high");
    assert.equal(normalizeDeploymentRisk("MODERATE"), "moderate");
  });

  it("trims whitespace", () => {
    assert.equal(normalizeDeploymentRisk("  low  "), "low");
  });

  it("defaults to 'low' for invalid input", () => {
    assert.equal(normalizeDeploymentRisk("critical"), "low");
    assert.equal(normalizeDeploymentRisk(""), "low");
    assert.equal(normalizeDeploymentRisk(null), "low");
    assert.equal(normalizeDeploymentRisk(undefined), "low");
  });
});

// ── normalizePolicyMode ───────────────────────────────────────────────────────

describe("normalizePolicyMode", () => {
  it("passes through valid values", () => {
    assert.equal(normalizePolicyMode("auto"), "auto");
    assert.equal(normalizePolicyMode("manual"), "manual");
    assert.equal(normalizePolicyMode("enforced"), "enforced");
    assert.equal(normalizePolicyMode("disabled"), "disabled");
  });

  it("defaults to 'manual' for invalid input", () => {
    assert.equal(normalizePolicyMode("unknown"), "manual");
    assert.equal(normalizePolicyMode(""), "manual");
    assert.equal(normalizePolicyMode(null), "manual");
  });

  it("lowercases and trims input", () => {
    assert.equal(normalizePolicyMode("  AUTO  "), "auto");
  });
});

// ── normalizePolicyStatus ─────────────────────────────────────────────────────

describe("normalizePolicyStatus", () => {
  it("passes through valid values", () => {
    assert.equal(normalizePolicyStatus("active"), "active");
    assert.equal(normalizePolicyStatus("review"), "review");
    assert.equal(normalizePolicyStatus("disabled"), "disabled");
  });

  it("defaults to 'active' for invalid input", () => {
    assert.equal(normalizePolicyStatus("unknown"), "active");
    assert.equal(normalizePolicyStatus(""), "active");
    assert.equal(normalizePolicyStatus(null), "active");
  });

  it("lowercases and trims", () => {
    assert.equal(normalizePolicyStatus("  REVIEW  "), "review");
  });
});

// ── normalizePolicyRegion ─────────────────────────────────────────────────────

describe("normalizePolicyRegion", () => {
  it("passes through valid region values", () => {
    assert.equal(normalizePolicyRegion("eu"), "eu");
    assert.equal(normalizePolicyRegion("us"), "us");
    assert.equal(normalizePolicyRegion("ap"), "ap");
    assert.equal(normalizePolicyRegion("global"), "global");
  });

  it("lowercases and trims", () => {
    assert.equal(normalizePolicyRegion("EU"), "eu");
    assert.equal(normalizePolicyRegion("  US  "), "us");
  });

  it("returns empty string for invalid input", () => {
    assert.equal(normalizePolicyRegion(""), "");
    assert.equal(normalizePolicyRegion(null), "");
    assert.equal(normalizePolicyRegion("unknown-region"), "");
  });
});

// ── parsePolicyScopeFromPayload ───────────────────────────────────────────────

describe("parsePolicyScopeFromPayload", () => {
  it("extracts direct route and region when provided", () => {
    const scope = parsePolicyScopeFromPayload({ route: "api", region: "eu" });
    assert.equal(scope.route, "api");
    assert.equal(scope.region, "eu");
  });

  it("uses fallback when payload is empty", () => {
    const scope = parsePolicyScopeFromPayload({}, { route: "workspace", region: "global" });
    assert.equal(scope.route, "workspace");
    assert.equal(scope.region, "global");
  });

  it("parses from 'applied' field as comma-separated route,region", () => {
    const scope = parsePolicyScopeFromPayload({ applied: "api, us" });
    assert.equal(scope.route, "api");
    assert.equal(scope.region, "us");
  });

  it("uses fallback region when applied only has route", () => {
    const scope = parsePolicyScopeFromPayload(
      { applied: "workspace" },
      { route: "workspace", region: "eu" }
    );
    assert.equal(scope.route, "workspace");
    assert.equal(scope.region, "eu");
  });

  it("handles null payload gracefully", () => {
    assert.doesNotThrow(() => parsePolicyScopeFromPayload(null, {}));
  });

  it("handles undefined payload gracefully", () => {
    const scope = parsePolicyScopeFromPayload();
    assert.ok(typeof scope.route === "string");
    assert.ok(typeof scope.region === "string");
  });

  it("direct route takes priority over 'applied' field", () => {
    const scope = parsePolicyScopeFromPayload({ route: "direct-route", applied: "applied-route, eu" });
    assert.equal(scope.route, "direct-route");
  });
});

// ── stringifyPolicyScope ──────────────────────────────────────────────────────

describe("stringifyPolicyScope", () => {
  it("formats route and region with comma separator", () => {
    assert.equal(stringifyPolicyScope("api", "eu"), "api, eu");
  });

  it("normalizes region to lowercase", () => {
    assert.equal(stringifyPolicyScope("workspace", "EU"), "workspace, eu");
  });

  it("uses defaults for empty inputs", () => {
    const result = stringifyPolicyScope("", "");
    assert.equal(result, "workspace, global");
  });

  it("uses default region 'global' when region is invalid", () => {
    const result = stringifyPolicyScope("api", "unknown-region");
    assert.equal(result, "api, global");
  });
});
