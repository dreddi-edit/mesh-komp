"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  FIXTURE_FAMILIES,
  SIZE_MULTIPLIERS,
  runBenchmarks,
} = require("../benchmarks/compression-benchmark.js");

test("compression benchmark suite covers every fixture family and size with baseline metrics", async () => {
  const report = await runBenchmarks();
  assert.equal(report.cases.length, FIXTURE_FAMILIES.length * SIZE_MULTIPLIERS.length);

  const seenFamilies = [...new Set(report.cases.map((entry) => entry.family))].sort();
  const expectedFamilies = FIXTURE_FAMILIES.map((entry) => entry.id).sort();
  assert.deepEqual(seenFamilies, expectedFamilies);

  const sample = report.cases.find((entry) => entry.family === "code" && entry.size === "small");
  assert.ok(sample);
  assert.equal(sample.parseOk, true);
  assert.equal(sample.capsule.bytes > 0, true);
  assert.equal(sample.focused.bytes > 0, true);
  assert.equal(sample.transport.bytes >= 0, true);
  assert.equal(sample.legacy.llm80.bytes > 0, true);
  assert.equal(sample.recovery.spans >= 1, true);
  assert.equal(Array.isArray(report.summary.byFamily), true);
});
