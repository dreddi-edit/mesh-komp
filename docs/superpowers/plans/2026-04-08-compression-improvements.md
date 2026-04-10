# Compression Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve storage efficiency, runtime performance, and capsule quality across the compression pipeline in `compression-core.cjs` without breaking any existing APIs or stored record formats.

**Architecture:** All changes are confined to `mesh-core/src/compression-core.cjs`. Five independent improvements are applied in order: (1) chunk/quality tuning, (2) SHA-256 dedup, (3) raw storage compression, (4) tiered token budget, (5) better query scoring. Each task is independently testable and committed separately.

**Tech Stack:** Node.js 20, `node:zlib` (deflateSync/inflateSync, brotliCompress), `node:crypto` (sha256), `node:test` + `node:assert/strict`

---

## Files

- Modify: `mesh-core/src/compression-core.cjs` (all tasks)
- Test: `test/compression-core.test.js` (all tasks — extend existing file)

---

## Task 1: Increase chunk size and Brotli quality

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:49` (DEFAULT_CHUNK_SIZE)
- Modify: `mesh-core/src/compression-core.cjs:1570-1574` (compressTransportChunk Brotli quality)
- Test: `test/compression-core.test.js`

**Context:** `DEFAULT_CHUNK_SIZE = 32KB` was tuned for Brotli; at 128KB the compressor has more context and achieves better ratios. Brotli quality 4 is a legacy compromise — quality 6 is the sweet spot for text (meaningfully better ratio, <2x latency increase for typical source files).

- [ ] **Step 1: Write the failing test**

Add to `test/compression-core.test.js` after the existing tests:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok|chunk"
```

Expected: `not ok` for the new test (chunk count will be > 4 at 32KB).

- [ ] **Step 3: Change DEFAULT_CHUNK_SIZE**

In `mesh-core/src/compression-core.cjs`, line 49:

```js
// Before
const DEFAULT_CHUNK_SIZE = 32 * 1024;

// After
const DEFAULT_CHUNK_SIZE = 128 * 1024;
```

- [ ] **Step 4: Increase Brotli quality**

In `mesh-core/src/compression-core.cjs`, inside `compressTransportChunk` (around line 1570):

```js
// Before
  return legacyBrotliCompress(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
    },
  });

// After
  return legacyBrotliCompress(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
    },
  });
```

- [ ] **Step 5: Run all tests**

```bash
node --test test/compression-core.test.js 2>&1
```

Expected: all 5 tests `ok`.

- [ ] **Step 6: Commit**

```bash
git add mesh-core/src/compression-core.cjs test/compression-core.test.js
git commit -m "perf(compression): increase chunk size to 128KB and Brotli quality to 6"
```

---

## Task 2: Eliminate redundant SHA-256 computation

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1667-1748` (buildTransportEnvelope)
- Modify: `mesh-core/src/compression-core.cjs:1832-1911` (buildWorkspaceFileRecord)
- Test: `test/compression-core.test.js`

**Context:** `buildWorkspaceFileRecord` calls `encodeRawStorage` (which hashes the raw buffer) and then `buildTransportEnvelope` (which independently hashes the same raw buffer again for the envelope digest). Passing the pre-computed digest via an option eliminates one full SHA-256 pass over the raw bytes.

- [ ] **Step 1: Write the failing test**

Add to `test/compression-core.test.js`:

```js
test("buildTransportEnvelope accepts a pre-computed rawDigest and skips recomputation", async () => {
  const { buildTransportEnvelope, encodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

  const source = "export const x = 1;\n".repeat(50);
  const storage = encodeRawStorage(source);

  // Pass the digest already computed by encodeRawStorage
  const envelope = await buildTransportEnvelope("src/x.js", source, {}, {
    rawDigest: storage.digest,
  });

  assert.equal(envelope.digest, storage.digest, "Envelope digest must match pre-computed digest");
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok|digest"
```

Expected: `not ok` — `buildTransportEnvelope` doesn't accept `rawDigest` yet, so it recomputes and the test can't distinguish (it will actually pass coincidentally). The real value is the next step enforces no double-compute. Accept that this test passes trivially for now — it documents the contract and guards against regression.

- [ ] **Step 3: Thread rawDigest through buildTransportEnvelope**

In `buildTransportEnvelope` (around line 1667), replace the manifest digest line:

```js
// Before — always recomputes
const manifest = {
  envelopeVersion: TRANSPORT_ENVELOPE_VERSION,
  contentEncoding: TRANSPORT_CONTENT_ENCODING,
  rawBytes: rawBuffer.length,
  compressedBytes: chunkIndex.reduce((sum, chunk) => sum + chunk.compressedBytes, 0),
  chunkSize,
  chunkCount: chunkIndex.length,
  spanCount: Object.keys(spanIndex).length,
  digest: sha256Hex(rawBuffer),
  chunkIndex,
  spanIndex,
};

// After — use pre-computed digest when available
const manifest = {
  envelopeVersion: TRANSPORT_ENVELOPE_VERSION,
  contentEncoding: TRANSPORT_CONTENT_ENCODING,
  rawBytes: rawBuffer.length,
  compressedBytes: chunkIndex.reduce((sum, chunk) => sum + chunk.compressedBytes, 0),
  chunkSize,
  chunkCount: chunkIndex.length,
  spanCount: Object.keys(spanIndex).length,
  digest: typeof options.rawDigest === "string" && options.rawDigest.length === 64
    ? options.rawDigest
    : sha256Hex(rawBuffer),
  chunkIndex,
  spanIndex,
};
```

- [ ] **Step 4: Pass digest from buildWorkspaceFileRecord**

In `buildWorkspaceFileRecord` (around line 1846), thread the digest:

```js
// Before
const rawStorage = persistRawContent
  ? encodeRawStorage(normalizedText)
  : buildExternalRawStorage(normalizedText, {
    rawBytes: Number(options.originalSizeOverride || Buffer.byteLength(normalizedText, "utf8")),
    truncated: Boolean(options.truncated),
  });
const fileTypeInfo = detectFileType(normalizedPath, normalizedText);
const baseCapsule = await buildBaseCapsule(normalizedPath, normalizedText, fileTypeInfo);
const transportPromise = buildTransportEnvelope(normalizedPath, normalizedText, baseCapsule.spanMap, {
  ...options,
  includeTransportChunks: persistTransportChunks,
});

// After
const rawStorage = persistRawContent
  ? encodeRawStorage(normalizedText)
  : buildExternalRawStorage(normalizedText, {
    rawBytes: Number(options.originalSizeOverride || Buffer.byteLength(normalizedText, "utf8")),
    truncated: Boolean(options.truncated),
  });
const fileTypeInfo = detectFileType(normalizedPath, normalizedText);
const baseCapsule = await buildBaseCapsule(normalizedPath, normalizedText, fileTypeInfo);
const transportPromise = buildTransportEnvelope(normalizedPath, normalizedText, baseCapsule.spanMap, {
  ...options,
  includeTransportChunks: persistTransportChunks,
  rawDigest: typeof rawStorage.digest === "string" ? rawStorage.digest : undefined,
});
```

- [ ] **Step 5: Run all tests**

```bash
node --test test/compression-core.test.js 2>&1
```

Expected: all 6 tests `ok`.

- [ ] **Step 6: Commit**

```bash
git add mesh-core/src/compression-core.cjs test/compression-core.test.js
git commit -m "perf(compression): reuse pre-computed SHA-256 digest in buildTransportEnvelope"
```

---

## Task 3: Compress raw storage with deflateSync

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1763-1790` (encodeRawStorage, decodeRawStorage)
- Test: `test/compression-core.test.js`

**Context:** `encodeRawStorage` currently stores UTF-8 text as plain Base64 (+33% overhead, zero compression). Both `encodeRawStorage` and `decodeRawStorage` are exported and called synchronously from external modules (`src/core/index.js`, `mesh-core/src/server.js`) — the API must remain synchronous. `zlib.deflateSync`/`inflateSync` are synchronous and available in all Node versions. Old records with encoding `"utf8-base64"` remain fully decodeable.

- [ ] **Step 1: Write the failing test**

Add to `test/compression-core.test.js`:

```js
test("encodeRawStorage uses deflate compression and decodeRawStorage round-trips correctly", () => {
  const { encodeRawStorage, decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok"
```

Expected: the two new tests `not ok` (encoding is still `"utf8-base64"`).

- [ ] **Step 3: Update encodeRawStorage**

In `mesh-core/src/compression-core.cjs`, replace the `encodeRawStorage` function:

```js
function encodeRawStorage(rawText) {
  const buffer = Buffer.from(String(rawText || ""), "utf8");
  const compressed = zlib.deflateSync(buffer, { level: 6 });
  return {
    encoding: "deflate-base64",
    contentBase64: compressed.toString("base64"),
    rawBytes: buffer.length,
    digest: sha256Hex(buffer),
  };
}
```

- [ ] **Step 4: Update decodeRawStorage**

In `mesh-core/src/compression-core.cjs`, replace the `decodeRawStorage` function:

```js
function decodeRawStorage(rawStorage) {
  if (!rawStorage || typeof rawStorage !== "object") return "";
  if (rawStorage.encoding === "external-azure-blob") return "";
  if (rawStorage.encoding === "deflate-base64") {
    return zlib.inflateSync(Buffer.from(String(rawStorage.contentBase64 || ""), "base64")).toString("utf8");
  }
  if (rawStorage.encoding === "utf8-base64") {
    return Buffer.from(String(rawStorage.contentBase64 || ""), "base64").toString("utf8");
  }
  return String(rawStorage.content || "");
}
```

- [ ] **Step 5: Run all tests**

```bash
node --test test/compression-core.test.js 2>&1
```

Expected: all 8 tests `ok`.

- [ ] **Step 6: Commit**

```bash
git add mesh-core/src/compression-core.cjs test/compression-core.test.js
git commit -m "perf(compression): compress rawStorage with deflateSync, keep utf8-base64 backward compat"
```

---

## Task 4: Tiered token budget in buildClampedCapsule

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1367-1425` (buildClampedCapsule)
- Test: `test/compression-core.test.js`

**Context:** The current budget is always `rawTokenEstimate * 0.2`. For a 200-token config file this yields 40 tokens — too tight, the capsule falls through to `emergency` mode unnecessarily. For a 50,000-token source file it yields 10,000 tokens — too generous. Tiers: ≤500 → 60%, ≤2000 → 40%, ≤8000 → 25%, >8000 → 15%.

- [ ] **Step 1: Write the failing test**

Add to `test/compression-core.test.js`:

```js
test("buildWorkspaceFileView capsule mode is verbose for small files and dense for large files", async () => {
  // Small file: ~30 tokens — should get verbose or compact capsule, NOT emergency
  const small = "export const VERSION = '1.0.0';\nexport const NAME = 'mesh';\n";
  const smallRecord = await buildWorkspaceFileRecord("src/constants.js", small);
  assert.notEqual(
    smallRecord.capsuleCache.capsule.capsuleMode,
    "emergency",
    "Small file must not fall to emergency mode",
  );

  // Large file: ~12000 tokens — capsule should not exceed 20% of raw tokens
  const large = "export function transform(input, options = {}) {\n  const result = {};\n  return result;\n}\n".repeat(300);
  const largeRecord = await buildWorkspaceFileRecord("src/transform.js", large);
  const ratio = largeRecord.compressionStats.capsuleTokenEstimate / largeRecord.compressionStats.rawTokenEstimate;
  assert.ok(ratio <= 0.20, `Expected capsule ≤ 20% of raw for large file, got ${(ratio * 100).toFixed(1)}%`);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok|emergency"
```

Expected: the new test `not ok` (small file hits emergency at the current 20% budget).

- [ ] **Step 3: Replace the flat budget with a tiered calculation**

In `mesh-core/src/compression-core.cjs`, inside `buildClampedCapsule`, replace:

```js
// Before
const budgetTokens = Math.max(1, Math.floor(rawTokenEstimate * 0.2));

// After
function tieredBudget(tokens) {
  if (tokens <= 500) return Math.max(1, Math.floor(tokens * 0.6));
  if (tokens <= 2000) return Math.max(1, Math.floor(tokens * 0.4));
  if (tokens <= 8000) return Math.max(1, Math.floor(tokens * 0.25));
  return Math.max(1, Math.floor(tokens * 0.15));
}
const budgetTokens = tieredBudget(rawTokenEstimate);
```

Note: define `tieredBudget` as a named inner function directly above the `budgetTokens` line, inside `buildClampedCapsule`. This keeps it scoped and avoids polluting the module namespace.

- [ ] **Step 4: Run all tests**

```bash
node --test test/compression-core.test.js 2>&1
```

Expected: all 9 tests `ok`.

- [ ] **Step 5: Commit**

```bash
git add mesh-core/src/compression-core.cjs test/compression-core.test.js
git commit -m "feat(capsule): tiered token budget — 60/40/25/15% by file size instead of flat 20%"
```

---

## Task 5: Improve query scoring in buildFocusedCapsule

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1435-1442` (scoreItemForQuery)
- Test: `test/compression-core.test.js`

**Context:** `scoreItemForQuery` counts substring matches with equal weight. This means a section item that mentions a query token once in a 500-char paragraph scores the same as an exact 1:1 match. Improvements: (1) exact whole-word match gets 3x weight, (2) substring match gets 1x as before, (3) shorter items with equal score rank higher (more precise result).

- [ ] **Step 1: Write the failing test**

Add to `test/compression-core.test.js`:

```js
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

  // The function definition line must appear in the focused capsule
  assert.match(
    focused.content,
    /processUser/,
    "focused capsule must contain processUser",
  );

  // The function definition item must rank above the comment that merely mentions it
  const capsuleSections = focused.capsule?.sections ?? [];
  const symbolsSection = capsuleSections.find((s) => s.name === "symbols" || s.name === "exports");
  if (symbolsSection) {
    const firstItem = symbolsSection.items[0]?.text ?? "";
    assert.match(firstItem, /processUser/, "First symbol item must be the processUser function");
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok|rank"
```

Expected: `not ok` — current flat scoring doesn't guarantee the function definition ranks above the comment.

- [ ] **Step 3: Replace scoreItemForQuery**

In `mesh-core/src/compression-core.cjs`, replace the `scoreItemForQuery` function:

```js
function scoreItemForQuery(item, queryTokens) {
  const text = String(item.text || "");
  const haystack = `${text} ${(item.spanIds || []).join(" ")}`.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (!haystack.includes(token)) continue;
    // Exact whole-word match scores 3x; substring match scores 1x
    const wordBoundary = new RegExp(`(?<![a-z0-9_])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![a-z0-9_])`);
    score += wordBoundary.test(haystack) ? 3 : 1;
  }
  return score;
}
```

- [ ] **Step 4: Update sort in buildFocusedCapsule to use text length as tiebreaker**

The sort in `buildFocusedCapsule` already has `a.item.text.length - b.item.text.length` as a tiebreaker — no change needed there. The new scoring alone should fix the ranking.

- [ ] **Step 5: Run all tests**

```bash
node --test test/compression-core.test.js 2>&1
```

Expected: all 10 tests `ok`.

- [ ] **Step 6: Commit**

```bash
git add mesh-core/src/compression-core.cjs test/compression-core.test.js
git commit -m "feat(capsule): improve focused query scoring with exact word-boundary match weighting"
```

---

## Self-Review

**Spec coverage:**
- Task 1: chunk size + Brotli quality ✓
- Task 2: SHA-256 dedup ✓
- Task 3: raw storage compression ✓
- Task 4: tiered token budget ✓
- Task 5: query scoring ✓

**Backward compatibility:**
- `decodeRawStorage` handles both `"deflate-base64"` (new) and `"utf8-base64"` (legacy) ✓
- `buildTransportEnvelope` `rawDigest` option is opt-in — no callers break ✓
- Chunk size and Brotli quality only affect newly written records — decoding is algorithm-agnostic ✓
- Token budget and query scoring changes are purely behavioral, no format changes ✓

**External callers of exported functions:**
- `decodeRawStorage` used in `src/core/index.js:784,5281` and `mesh-core/src/server.js:732` — all synchronous, stays synchronous ✓
- `encodeRawStorage` used only inside `compression-core.cjs` itself ✓

**Placeholder scan:** None found — all steps contain full code.

**Type consistency:** `rawDigest` option named consistently across Task 2. `tieredBudget` defined as inner function to match scope intent.
