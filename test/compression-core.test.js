"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const zlib = require("node:zlib");
const { promisify } = require("node:util");

const brotliCompress = promisify(zlib.brotliCompress);

const {
  LEGACY_WORKSPACE_ENCODING,
  TRANSPORT_CONTENT_ENCODING,
  TRANSPORT_ENVELOPE_VERSION,
  WORKSPACE_RECORD_VERSION,
  buildWorkspaceFileRecord,
  buildWorkspaceFileView,
  decodeTransportEnvelope,
  encodeRawStorage,
  ensureWorkspaceFileRecord,
  recoverWorkspaceFileRecord,
  suggestRecoverySpanIds,
} = require("../mesh-core/src/compression-core.cjs");

test("buildWorkspaceFileRecord creates capsule, focused, transport and recovery artifacts", async () => {
  const source = [
    "import path from 'node:path';",
    "export const title = 'Mesh';",
    "export function printTitle(prefix = 'workspace') {",
    "  const full = `${prefix}:${title}`;",
    "  console.log(full);",
    "  return path.basename(full);",
    "}",
    "",
  ].join("\n");

  const record = await buildWorkspaceFileRecord("demo/assets/app.js", source, { legacyBrotliQuality: 4 });
  assert.equal(record.formatVersion, WORKSPACE_RECORD_VERSION);
  assert.equal(record.fileType, "code/javascript");
  assert.equal(record.transportEnvelope.envelopeVersion, TRANSPORT_ENVELOPE_VERSION);
  assert.equal(record.transportEnvelope.contentEncoding, TRANSPORT_CONTENT_ENCODING);
  assert.equal(record.capsuleCache.capsule.recoveryEligible, true);
  assert.ok(record.capsuleVariants?.ultra);
  assert.ok(record.capsuleVariants?.medium);
  assert.ok(record.capsuleVariants?.loose);

  const capsuleView = await buildWorkspaceFileView(record, "capsule");
  assert.equal(capsuleView.encoding, "mesh-capsule-v2");
  assert.equal(capsuleView.capsuleTier, "ultra");
  assert.match(capsuleView.content, /CAPSULE v2/);
  assert.match(capsuleView.content, /@sp_/);

  const looseCapsuleView = await buildWorkspaceFileView(record, "capsule", { tier: "loose" });
  assert.equal(looseCapsuleView.capsuleTier, "loose");
  assert.ok(
    looseCapsuleView.content.length >= capsuleView.content.length,
    "Loose capsule should not be smaller than the default ultra capsule",
  );

  const focusedView = await buildWorkspaceFileView(record, "focused", { query: "title console" });
  assert.equal(focusedView.encoding, "mesh-capsule-v2");
  assert.equal(focusedView.query, "title console");
  assert.match(focusedView.content, /title/i);

  const transportView = await buildWorkspaceFileView(record, "transport");
  assert.equal(transportView.encoding, TRANSPORT_ENVELOPE_VERSION);
  assert.equal(transportView.contentEncoding, TRANSPORT_CONTENT_ENCODING);
  assert.match(String(transportView.content || ""), /mesh-envelope-v2/);

  const suggestedSpanIds = suggestRecoverySpanIds(record, "title console", 4);
  assert.ok(suggestedSpanIds.length >= 1);
  const recovery = await recoverWorkspaceFileRecord(record, { spanIds: suggestedSpanIds.slice(0, 2) });
  assert.ok(recovery.spans.length >= 1);
  assert.match(recovery.spans.map((entry) => entry.text).join("\n"), /(title|console\.log)/);
});

test("ensureWorkspaceFileRecord lazily migrates legacy brotli workspace entries", async () => {
  const source = "<section><h1>Account settings</h1><p>Billing and profile controls.</p></section>\n";
  const compressed = await brotliCompress(Buffer.from(source, "utf8"), {
    params: {
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    },
  });

  const legacy = {
    path: "demo/settings-account.html",
    compressedBase64: compressed.toString("base64"),
    originalSize: Buffer.byteLength(source, "utf8"),
    compressedSize: compressed.length,
    kind: "source",
  };

  const migrated = await ensureWorkspaceFileRecord(legacy, {
    path: legacy.path,
    legacyBrotliQuality: 4,
  });
  assert.equal(migrated.formatVersion, WORKSPACE_RECORD_VERSION);
  assert.equal(migrated.compressedBase64.length > 0, true);

  const originalView = await buildWorkspaceFileView(migrated, "original");
  assert.equal(originalView.encoding, "plain-text");
  assert.equal(originalView.content, source);

  const compressedView = await buildWorkspaceFileView(migrated, "compressed");
  assert.equal(compressedView.encoding, LEGACY_WORKSPACE_ENCODING);
  assert.equal(compressedView.content, legacy.compressedBase64);
});

test("ensureWorkspaceFileRecord restores raw source from a transport envelope only record", async () => {
  const source = [
    "## Recovery",
    "",
    "Exact lines are restored from the chunk envelope with digest validation.",
    "",
    "- capsule",
    "- focused",
    "- recovery",
  ].join("\n");

  const record = await buildWorkspaceFileRecord("docs/recovery.md", source, { legacyBrotliQuality: 4 });
  const restored = await ensureWorkspaceFileRecord({
    path: record.path,
    formatVersion: WORKSPACE_RECORD_VERSION,
    kind: "source",
    transportEnvelope: JSON.parse(JSON.stringify(record.transportEnvelope)),
  }, {
    path: record.path,
    legacyBrotliQuality: 4,
  });

  const originalView = await buildWorkspaceFileView(restored, "original");
  assert.equal(originalView.content, source);
  assert.equal(restored.transportEnvelope.envelopeVersion, TRANSPORT_ENVELOPE_VERSION);
});

test("decodeTransportEnvelope rejects tampered digests and invalid span ranges", async () => {
  const source = [
    "export function validateDigest(value) {",
    "  return String(value || '').trim();",
    "}",
    "",
  ].join("\n");

  const record = await buildWorkspaceFileRecord("src/validate.js", source, { legacyBrotliQuality: 4 });
  const tamperedDigest = JSON.parse(JSON.stringify(record.transportEnvelope));
  tamperedDigest.chunkIndex[0].digest = `${tamperedDigest.chunkIndex[0].digest}`.replace(/^./, "0");
  await assert.rejects(
    () => decodeTransportEnvelope(tamperedDigest),
    /digest mismatch/i,
  );

  const tamperedSpan = JSON.parse(JSON.stringify(record.transportEnvelope));
  const firstSpanId = Object.keys(tamperedSpan.spanIndex)[0];
  tamperedSpan.spanIndex[firstSpanId].endByte = tamperedSpan.rawBytes + 42;
  await assert.rejects(
    () => decodeTransportEnvelope(tamperedSpan),
    /out of range/i,
  );
});

test("transport envelope uses 128KB chunk size and produces fewer chunks for large input", async () => {
  // 300KB of repetitive source text — enough to span multiple chunks at both sizes
  const source = "export function compute(x) { return x * 2; }\n".repeat(6500);

  const record = await buildWorkspaceFileRecord("src/big.js", source);
  const envelope = record.transportEnvelope;

  // At 128KB chunks a 300KB input fits in 3 chunks; at 32KB it would need 10+
  assert.ok(
    envelope.chunkIndex.length <= 4,
    `Expected ≤4 chunks, got ${envelope.chunkIndex.length}`,
  );
  // Compression ratio should be high for repetitive text
  assert.ok(
    envelope.compressedBytes < envelope.rawBytes * 0.5,
    `Expected compressedBytes < 50% of rawBytes, got ${envelope.compressedBytes}/${envelope.rawBytes}`,
  );
});

test("encodeRawStorage uses deflate compression and decodeRawStorage round-trips correctly", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

  const source = "export function greet(name) {\n  return `Hello, ${name}!`;\n}\n".repeat(200);
  const storage = encodeRawStorage(source);

  assert.equal(storage.encoding, "deflate-base64", "encoding must be deflate-base64");

  // Compressed size must be meaningfully smaller than raw
  const rawBytes = Buffer.byteLength(source, "utf8");
  const compressedBytes = Buffer.from(storage.contentBase64, "base64").length;
  assert.ok(
    compressedBytes < rawBytes * 0.6,
    `Expected compressed < 60% of raw, got ${compressedBytes}/${rawBytes}`,
  );

  // Round-trip must be lossless
  const decoded = decodeRawStorage(storage);
  assert.equal(decoded, source);
});

test("decodeRawStorage still handles legacy utf8-base64 encoding", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

  const source = "const x = 1;\n";
  const legacy = {
    encoding: "utf8-base64",
    contentBase64: Buffer.from(source, "utf8").toString("base64"),
    rawBytes: Buffer.byteLength(source, "utf8"),
  };

  assert.equal(decodeRawStorage(legacy), source);
});

test("buildWorkspaceFileView defaults to ultra capsule tier and keeps aggressive compression for large files", async () => {
  // Small file: the default capsule tier should now be the explicit ultra tier.
  const small = "export const VERSION = '1.0.0';\nexport const NAME = 'mesh';\n";
  const smallRecord = await buildWorkspaceFileRecord("src/constants.js", small);
  assert.equal(smallRecord.defaultCapsuleTier, "ultra");
  assert.equal(smallRecord.capsuleCache.capsule.capsuleTier, "ultra");

  // Large file: ultra capsule should not exceed 20% of raw tokens
  const large = "export function transform(input, options = {}) {\n  const result = {};\n  return result;\n}\n".repeat(300);
  const largeRecord = await buildWorkspaceFileRecord("src/transform.js", large);
  const ratio = largeRecord.compressionStats.capsuleTokenEstimate / largeRecord.compressionStats.rawTokenEstimate;
  assert.ok(ratio <= 0.20, `Expected capsule ≤ 20% of raw for large file, got ${(ratio * 100).toFixed(1)}%`);
});

test("buildWorkspaceFileRecord creates ultra, medium, and loose capsule tiers per file", async () => {
  const source = [
    "import { readFileSync } from 'node:fs';",
    "export const APP_NAME = 'mesh';",
    "export function loadConfig(path) {",
    "  const raw = readFileSync(path, 'utf8');",
    "  return JSON.parse(raw);",
    "}",
    "export function formatConfig(config) {",
    "  return Object.entries(config).map(([k, v]) => `${k}:${v}`).join('\\n');",
    "}",
    "export function printConfig(config) {",
    "  console.log(formatConfig(config));",
    "}",
  ].join("\n").repeat(40);

  const record = await buildWorkspaceFileRecord("src/config.js", source);
  const ultra = record.capsuleVariants?.ultra?.capsule;
  const medium = record.capsuleVariants?.medium?.capsule;
  const loose = record.capsuleVariants?.loose?.capsule;

  assert.ok(ultra && medium && loose, "expected all three capsule tiers");
  assert.equal(ultra.capsuleTier, "ultra");
  assert.equal(medium.capsuleTier, "medium");
  assert.equal(loose.capsuleTier, "loose");
  assert.ok(
    ultra.capsuleTokenEstimate <= medium.capsuleTokenEstimate && medium.capsuleTokenEstimate <= loose.capsuleTokenEstimate,
    "capsule tiers should get progressively looser",
  );

  const ultraRemaining = ultra.capsuleTokenEstimate / ultra.rawTokenEstimate;
  assert.ok(
    ultraRemaining <= 0.20,
    `expected ultra capsule to keep <=20% of raw tokens, got ${(ultraRemaining * 100).toFixed(1)}%`,
  );

  const mediumView = await buildWorkspaceFileView(record, "capsule", { tier: "medium" });
  const looseView = await buildWorkspaceFileView(record, "capsule", { tier: "loose" });
  assert.equal(mediumView.capsuleTier, "medium");
  assert.equal(looseView.capsuleTier, "loose");
  assert.ok(
    String(looseView.content || "").length >= String(mediumView.content || "").length,
    "loose tier should render at least as much content as medium tier",
  );
});

test("small files still produce meaningfully different capsule tiers", async () => {
  const source = [
    "import path from 'node:path';",
    "export const title = 'Mesh';",
    "export function printTitle(prefix = 'workspace') {",
    "  const full = `${prefix}:${title}`;",
    "  return path.basename(full);",
    "}",
  ].join("\n");

  const record = await buildWorkspaceFileRecord("src/small.js", source);
  const ultraView = await buildWorkspaceFileView(record, "capsule", { tier: "ultra" });
  const mediumView = await buildWorkspaceFileView(record, "capsule", { tier: "medium" });
  const looseView = await buildWorkspaceFileView(record, "capsule", { tier: "loose" });

  assert.equal(ultraView.capsuleTier, "ultra");
  assert.equal(mediumView.capsuleTier, "medium");
  assert.equal(looseView.capsuleTier, "loose");
  assert.ok(
    String(ultraView.content || "").length <= String(mediumView.content || "").length,
    "ultra tier should never be larger than medium for small files",
  );
  assert.ok(
    String(mediumView.content || "").length <= String(looseView.content || "").length,
    "medium tier should never be larger than loose for small files",
  );
  assert.ok(
    String(ultraView.content || "") !== String(looseView.content || ""),
    "small-file ultra and loose tiers should not collapse to identical output",
  );
});

test("buildWorkspaceFileView focused mode ranks exact function name matches above incidental mentions", async () => {
  const source = [
    "// This module exports several utilities for processing user data.",
    "// The processUser function is central to user management workflows.",
    "export function processUser(user) {",
    "  return { ...user, processed: true };",
    "}",
    "export function formatDate(date) {",
    "  return date.toISOString();",
    "}",
    "export function logEvent(event) {",
    "  console.log(event);",
    "}",
  ].join("\n");

  const record = await buildWorkspaceFileRecord("src/utils.js", source);
  const focused = await buildWorkspaceFileView(record, "focused", { query: "processUser" });

  // The function definition must appear in the focused capsule
  assert.match(focused.content, /processUser/, "focused capsule must contain processUser");

  // The processUser function must rank first among symbols
  const symbolsSection = (focused.capsule?.sections ?? []).find(
    (s) => s.name === "symbols" || s.name === "exports",
  );
  if (symbolsSection && symbolsSection.items.length > 0) {
    assert.match(
      symbolsSection.items[0].text,
      /processUser/,
      "First symbol item must be the processUser function",
    );
  }
});

test("buildWorkspaceFileRecord transport envelope digest matches pre-computed rawStorage digest", async () => {
  const source = "export const x = 1;\n".repeat(50);
  const storage = encodeRawStorage(source);

  const record = await buildWorkspaceFileRecord("src/x.js", source);

  // The transport envelope digest must equal the rawStorage digest —
  // both hash the same raw buffer, so the dedup must produce the same value.
  assert.equal(
    record.transportEnvelope.digest,
    storage.digest,
    "Transport envelope digest must match rawStorage digest",
  );
});
