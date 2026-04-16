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
    "import fs from 'node:fs';",
    "export const title = 'Mesh';",
    "export const version = '2.0.0';",
    "export const MAX_RETRIES = 3;",
    "export function printTitle(prefix = 'workspace') {",
    "  const full = `${prefix}:${title}`;",
    "  console.log(full);",
    "  return path.basename(full);",
    "}",
    "export function readConfig(configPath) {",
    "  const resolved = path.resolve(configPath);",
    "  const raw = fs.readFileSync(resolved, 'utf8');",
    "  const parsed = JSON.parse(raw);",
    "  if (!parsed.name) throw new Error('Config must have a name');",
    "  if (!parsed.version) throw new Error('Config must have a version');",
    "  return { ...parsed, loadedAt: Date.now() };",
    "}",
    "export function formatOutput(data, options = {}) {",
    "  const indent = options.indent || 2;",
    "  const sorted = options.sortKeys ? Object.keys(data).sort() : Object.keys(data);",
    "  return JSON.stringify(data, sorted, indent);",
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
  assert.match(capsuleView.content, /^CAP /m);
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

test("encodeRawStorage uses Brotli-9 compression, outcompresses deflate-6, and round-trips correctly", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

  // Diverse-ish source — varied function names so the compressor can't trivially collapse it
  const source = Array.from({ length: 80 }, (_, i) =>
    `export function handler${i}(request, context) {\n  const id${i} = request.params.id;\n  return { status: 200, body: context.store.get(id${i}) };\n}`,
  ).join("\n");

  const storage = encodeRawStorage(source);

  // Encoding must be brotli-base64
  assert.equal(storage.encoding, "brotli-base64", "encoding must be brotli-base64");

  // Brotli-9 must produce a smaller result than deflate-6 on the same input
  const rawBuffer = Buffer.from(source, "utf8");
  const deflateSize = zlib.deflateSync(rawBuffer, { level: 6 }).length;
  const brotliSize = Buffer.from(storage.contentBase64, "base64").length;
  assert.ok(
    brotliSize < deflateSize,
    `Brotli-9 (${brotliSize}B) must be smaller than deflate-6 (${deflateSize}B) on the same input`,
  );

  // Round-trip must be lossless
  assert.equal(decodeRawStorage(storage), source, "round-trip must be lossless");
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

test("decodeRawStorage still handles legacy deflate-base64 encoding", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

  const source = "export const config = { host: 'localhost', port: 8080 };\n".repeat(40);
  const legacy = {
    encoding: "deflate-base64",
    contentBase64: zlib.deflateSync(Buffer.from(source, "utf8"), { level: 6 }).toString("base64"),
    rawBytes: Buffer.byteLength(source, "utf8"),
  };

  assert.equal(decodeRawStorage(legacy), source, "legacy deflate-base64 must decode correctly");
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
    "import fs from 'node:fs';",
    "export const title = 'Mesh';",
    "export const MAX_DEPTH = 10;",
    "export function printTitle(prefix = 'workspace') {",
    "  const full = `${prefix}:${title}`;",
    "  return path.basename(full);",
    "}",
    "export function walkDirectory(dirPath, depth = 0) {",
    "  if (depth > MAX_DEPTH) return [];",
    "  const entries = fs.readdirSync(dirPath, { withFileTypes: true });",
    "  const results = [];",
    "  for (const entry of entries) {",
    "    const fullPath = path.join(dirPath, entry.name);",
    "    if (entry.isDirectory()) {",
    "      results.push(...walkDirectory(fullPath, depth + 1));",
    "    } else {",
    "      results.push(fullPath);",
    "    }",
    "  }",
    "  return results;",
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
    String(mediumView.content || "").length <= String(looseView.content || "").length * 1.1,
    "medium tier should not be significantly larger than loose for small files",
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
    "  if (!user || !user.id) throw new Error('User must have an id');",
    "  const normalizedEmail = String(user.email || '').trim().toLowerCase();",
    "  const displayName = user.firstName && user.lastName",
    "    ? `${user.firstName} ${user.lastName}`",
    "    : user.username || 'Anonymous';",
    "  return { ...user, processed: true, normalizedEmail, displayName };",
    "}",
    "export function formatDate(date) {",
    "  if (!(date instanceof Date)) date = new Date(date);",
    "  const year = date.getFullYear();",
    "  const month = String(date.getMonth() + 1).padStart(2, '0');",
    "  const day = String(date.getDate()).padStart(2, '0');",
    "  return `${year}-${month}-${day}`;",
    "}",
    "export function logEvent(event) {",
    "  const timestamp = new Date().toISOString();",
    "  const severity = event.level || 'info';",
    "  console.log(`[${timestamp}] [${severity}] ${event.message}`);",
    "}",
    "export function validatePayload(payload, schema) {",
    "  const errors = [];",
    "  for (const [key, rule] of Object.entries(schema)) {",
    "    if (rule.required && !(key in payload)) errors.push(`Missing: ${key}`);",
    "    if (rule.type && typeof payload[key] !== rule.type) errors.push(`Invalid type: ${key}`);",
    "  }",
    "  return { valid: errors.length === 0, errors };",
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

test("transport Brotli fallback params: quality 9 + LGWIN:22 produces smaller output than quality 6", async () => {
  const { promisify } = require("util");
  const brotliCompress = promisify(zlib.brotliCompress);

  // Diverse source — varied class names per iteration so the compressor can't trivially collapse it
  const source = Array.from({ length: 60 }, (_, i) => [
    `export class Repository${i} {`,
    `  constructor(db${i}, cache${i}) { this.db = db${i}; this.cache = cache${i}; }`,
    `  async findById${i}(id) { const hit = await this.cache${i}.get(id); if (hit) return hit; return this.db${i}.query('SELECT * FROM table${i} WHERE id = ?', [id]); }`,
    `  async save${i}(entity) { await this.db${i}.execute('INSERT INTO table${i} VALUES (?)', [JSON.stringify(entity)]); await this.cache${i}.set(entity.id, entity); }`,
    `}`,
  ].join("\n")).join("\n");

  const buf = Buffer.from(source, "utf8");

  const [q6, q9win] = await Promise.all([
    brotliCompress(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }),
    brotliCompress(buf, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
        [zlib.constants.BROTLI_PARAM_LGWIN]: 22,
      },
    }),
  ]);

  assert.ok(
    q9win.length < q6.length,
    `Quality 9 + LGWIN:22 (${q9win.length}B) must be smaller than quality 6 (${q6.length}B)`,
  );
});

test("transport envelope uses 256KB chunk size — 700KB input produces at most 3 chunks", async () => {
  // ~750KB of varied source — at 256KB chunks: ceil(750/256) = 3 chunks
  // At the old 128KB cap: ceil(750/128) = 6 chunks — this test would fail
  const source = Array.from({ length: 7000 }, (_, i) =>
    `export const reducer${i} = (state, action) => ({ ...state, item${i}: action.payload, ts${i}: Date.now() });`,
  ).join("\n");

  assert.ok(
    Buffer.byteLength(source, "utf8") >= 700 * 1024,
    `Source must be at least 700KB to distinguish chunk sizes (got ${Buffer.byteLength(source, "utf8")} bytes)`,
  );

  const record = await buildWorkspaceFileRecord("src/reducers.js", source);
  const envelope = record.transportEnvelope;

  assert.ok(
    envelope.chunkIndex.length <= 3,
    `Expected ≤3 chunks at 256KB chunk size, got ${envelope.chunkIndex.length}`,
  );
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

test("buildWorkspaceFileRecord — Rust: extracts struct and fn symbols", async () => {
  const source = [
    "pub struct Config {",
    "    pub name: String,",
    "    pub port: u16,",
    "}",
    "",
    "pub fn load_config(path: &str) -> Config {",
    "    Config { name: String::from(path), port: 8080 }",
    "}",
    "",
    "pub async fn start_server(config: Config) {",
    "    println!(\"Starting on port {}\", config.port);",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("src/config.rs", source);
  assert.equal(record.fileType, "code/rust");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("load_config") || capsuleJson.includes("Config"),
    "Rust capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — C++: extracts class and function symbols", async () => {
  const source = [
    "#include <string>",
    "",
    "class HttpClient {",
    "public:",
    "    explicit HttpClient(const std::string& baseUrl);",
    "    std::string get(const std::string& path);",
    "    void setTimeout(int ms);",
    "};",
    "",
    "std::string parseJson(const std::string& raw) {",
    "    return raw;",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("src/http_client.cpp", source);
  assert.equal(record.fileType, "code/cpp");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("HttpClient") || capsuleJson.includes("parseJson"),
    "C++ capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — C#: extracts class and method symbols", async () => {
  const source = [
    "namespace Mesh.Api;",
    "",
    "public class UserService {",
    "    private readonly IUserRepository _repo;",
    "",
    "    public UserService(IUserRepository repo) { _repo = repo; }",
    "",
    "    public async Task<User> GetUserAsync(string id) {",
    "        return await _repo.FindByIdAsync(id);",
    "    }",
    "",
    "    public void DeleteUser(string id) {",
    "        _repo.Delete(id);",
    "    }",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("Services/UserService.cs", source);
  assert.equal(record.fileType, "code/csharp");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("UserService") || capsuleJson.includes("GetUserAsync"),
    "C# capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — Java: extracts class and method symbols", async () => {
  const source = [
    "package com.mesh.api;",
    "",
    "public class WorkspaceController {",
    "    private final WorkspaceService service;",
    "",
    "    public WorkspaceController(WorkspaceService service) {",
    "        this.service = service;",
    "    }",
    "",
    "    public ResponseEntity<Workspace> getWorkspace(String id) {",
    "        return ResponseEntity.ok(service.findById(id));",
    "    }",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("src/WorkspaceController.java", source);
  assert.equal(record.fileType, "code/java");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("WorkspaceController") || capsuleJson.includes("getWorkspace"),
    "Java capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — Ruby: extracts class and method symbols", async () => {
  const source = [
    "class UserRepository",
    "  def initialize(db)",
    "    @db = db",
    "  end",
    "",
    "  def find_by_id(id)",
    "    @db.query('SELECT * FROM users WHERE id = ?', id).first",
    "  end",
    "",
    "  def delete(id)",
    "    @db.execute('DELETE FROM users WHERE id = ?', id)",
    "  end",
    "end",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("lib/user_repository.rb", source);
  assert.equal(record.fileType, "code/ruby");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("UserRepository") || capsuleJson.includes("find_by_id"),
    "Ruby capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — PHP: extracts class and method symbols", async () => {
  const source = [
    "<?php",
    "namespace App\\Services;",
    "",
    "class CacheService {",
    "    private array $store = [];",
    "",
    "    public function get(string $key): mixed {",
    "        return $this->store[$key] ?? null;",
    "    }",
    "",
    "    public function set(string $key, mixed $value): void {",
    "        $this->store[$key] = $value;",
    "    }",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("src/Services/CacheService.php", source);
  assert.equal(record.fileType, "code/php");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("CacheService") || capsuleJson.includes("get"),
    "PHP capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — Kotlin: extracts class and function symbols", async () => {
  const source = [
    "package com.mesh.domain",
    "",
    "data class Workspace(",
    "    val id: String,",
    "    val name: String,",
    ")",
    "",
    "class WorkspaceService(private val repo: WorkspaceRepository) {",
    "    fun findById(id: String): Workspace? = repo.findById(id)",
    "    suspend fun create(name: String): Workspace {",
    "        return repo.save(Workspace(id = generateId(), name = name))",
    "    }",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("src/WorkspaceService.kt", source);
  assert.equal(record.fileType, "code/kotlin");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("WorkspaceService") || capsuleJson.includes("Workspace"),
    "Kotlin capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — Swift: extracts struct and func symbols", async () => {
  const source = [
    "import Foundation",
    "",
    "struct APIClient {",
    "    let baseURL: URL",
    "    let session: URLSession",
    "",
    "    func get(path: String) async throws -> Data {",
    "        let url = baseURL.appendingPathComponent(path)",
    "        let (data, _) = try await session.data(from: url)",
    "        return data",
    "    }",
    "}",
    "",
    "func buildDefaultClient() -> APIClient {",
    "    APIClient(baseURL: URL(string: \"https://api.mesh.dev\")!, session: .shared)",
    "}",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("Sources/APIClient.swift", source);
  assert.equal(record.fileType, "code/swift");
  assert.equal(record.capsuleCache.capsule.capsuleType, "structure");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("APIClient") || capsuleJson.includes("buildDefaultClient"),
    "Swift capsule should contain extracted symbol names"
  );
});

test("buildWorkspaceFileRecord — unknown extension: heuristic fallback extracts symbols", async () => {
  const source = [
    "-- Lua module",
    "local M = {}",
    "",
    "function M.greet(name)",
    "  return 'Hello, ' .. name",
    "end",
    "",
    "function M.farewell(name)",
    "  return 'Goodbye, ' .. name",
    "end",
    "",
    "return M",
  ].join("\n");
  const record = await buildWorkspaceFileRecord("plugin/greet.lua", source);
  // Lua has no tree-sitter grammar — falls back to heuristic
  assert.equal(record.fileType, "docs/text");
  const capsuleJson = JSON.stringify(record.capsuleCache.capsule);
  assert.ok(
    capsuleJson.includes("greet") || capsuleJson.includes("farewell"),
    "Heuristic fallback should extract Lua function names"
  );
});
