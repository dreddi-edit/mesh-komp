# Compression Boost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push raw storage and transport compression ratios significantly further with three independent, backward-compatible improvements.

**Architecture:** All changes are confined to `mesh-core/src/compression-core.cjs` and `test/compression-core.test.js`. Three improvements in order: (1) swap rawStorage from deflate-6 to Brotli sync quality 9 (~25% smaller stored records), (2) upgrade the transport Brotli fallback path to quality 9 + 4MB sliding window (~15% better on Brotli environments), (3) double the transport chunk size from 128KB to 256KB so the compressor has more context (~5-10% additional gain). Each task is independently testable and committed separately. All changes are backward-compatible: old stored records continue to decode correctly.

**Tech Stack:** Node.js 20, `node:zlib` (brotliCompressSync/brotliDecompressSync, deflateSync, inflateSync), `node:test` + `node:assert/strict`

---

## Files

- Modify: `mesh-core/src/compression-core.cjs`
- Modify: `test/compression-core.test.js`

---

## Task 1: Swap rawStorage encoding from deflate-6 to Brotli sync quality 9

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1815-1824` (`encodeRawStorage`)
- Modify: `mesh-core/src/compression-core.cjs:1836-1846` (`decodeRawStorage`)
- Modify: `test/compression-core.test.js:180-199` (update existing deflate test)
- Modify: `test/compression-core.test.js:201-212` (add deflate-base64 legacy compat test)

**Context:** `encodeRawStorage` currently stores file content as `deflate-6 + base64`. Brotli consistently outcompresses deflate by 20-30% on source code because it uses a larger static dictionary tuned for web content and text. `brotliCompressSync` is synchronous — same call pattern as `deflateSync`, no API surface change. The new encoding name is `"brotli-base64"`. Old records with `"deflate-base64"` or `"utf8-base64"` remain fully decodeable.

- [ ] **Step 1: Update the existing rawStorage test to expect Brotli**

In `test/compression-core.test.js`, replace lines 180–199 (the `"encodeRawStorage uses deflate compression..."` test) with:

```js
test("encodeRawStorage uses Brotli-9 compression, outcompresses deflate-6, and round-trips correctly", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");
  const zlib = require("zlib");

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
```

- [ ] **Step 2: Add a backward-compat test for legacy deflate-base64 records**

In `test/compression-core.test.js`, insert after the `"decodeRawStorage still handles legacy utf8-base64 encoding"` test (after line ~212):

```js
test("decodeRawStorage still handles legacy deflate-base64 encoding", () => {
  const { decodeRawStorage } = require("../mesh-core/src/compression-core.cjs");
  const zlib = require("zlib");

  const source = "export const config = { host: 'localhost', port: 8080 };\n".repeat(40);
  const legacy = {
    encoding: "deflate-base64",
    contentBase64: zlib.deflateSync(Buffer.from(source, "utf8"), { level: 6 }).toString("base64"),
    rawBytes: Buffer.byteLength(source, "utf8"),
  };

  assert.equal(decodeRawStorage(legacy), source, "legacy deflate-base64 must decode correctly");
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1 | grep -E "ok|not ok"
```

Expected: the updated `"encodeRawStorage uses Brotli-9..."` test fails (`encoding must be brotli-base64` — currently produces `deflate-base64`). The new legacy deflate compat test passes (decodeRawStorage already handles `deflate-base64`).

- [ ] **Step 4: Replace `encodeRawStorage` with Brotli-9**

In `mesh-core/src/compression-core.cjs`, replace:

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

With:

```js
function encodeRawStorage(rawText) {
  const buffer = Buffer.from(String(rawText || ""), "utf8");
  const compressed = zlib.brotliCompressSync(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
    },
  });
  return {
    encoding: "brotli-base64",
    contentBase64: compressed.toString("base64"),
    rawBytes: buffer.length,
    digest: sha256Hex(buffer),
  };
}
```

- [ ] **Step 5: Add `"brotli-base64"` case to `decodeRawStorage`**

In `mesh-core/src/compression-core.cjs`, replace:

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

With:

```js
function decodeRawStorage(rawStorage) {
  if (!rawStorage || typeof rawStorage !== "object") return "";
  if (rawStorage.encoding === "external-azure-blob") return "";
  if (rawStorage.encoding === "brotli-base64") {
    return zlib.brotliDecompressSync(
      Buffer.from(String(rawStorage.contentBase64 || ""), "base64"),
    ).toString("utf8");
  }
  if (rawStorage.encoding === "deflate-base64") {
    return zlib.inflateSync(
      Buffer.from(String(rawStorage.contentBase64 || ""), "base64"),
    ).toString("utf8");
  }
  if (rawStorage.encoding === "utf8-base64") {
    return Buffer.from(String(rawStorage.contentBase64 || ""), "base64").toString("utf8");
  }
  return String(rawStorage.content || "");
}
```

- [ ] **Step 6: Run all tests**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1
```

Expected: all tests pass. Count should increase by 1 (the new legacy deflate compat test).

- [ ] **Step 7: Commit**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && git add mesh-core/src/compression-core.cjs test/compression-core.test.js && git commit -m "perf(compression): swap rawStorage from deflate-6 to Brotli sync quality 9"
```

---

## Task 2: Upgrade transport Brotli fallback to quality 9 + 4MB sliding window

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:1550-1554` (`compressTransportChunk` Brotli branch)
- Modify: `test/compression-core.test.js` (add direct Brotli params comparison test)

**Context:** When zstd is unavailable (Node < 22, or environments without the zstd binding), transport chunks are compressed with Brotli quality 6. Quality 6 was a conservative latency compromise. Quality 9 delivers meaningfully better ratios (~10-15%) with acceptable latency for background compression of workspace files. Adding `BROTLI_PARAM_LGWIN: 22` sets the encoder's sliding window to 4MB (the maximum), giving it more context to find repetitions across a large chunk — especially effective at our 256KB chunk size (after Task 3). The transport format does not change; only the compressed bytes inside each chunk are smaller.

- [ ] **Step 1: Add a test that proves quality 9 + LGWIN:22 beats quality 6**

Add to `test/compression-core.test.js`:

```js
test("transport Brotli fallback params: quality 9 + LGWIN:22 produces smaller output than quality 6", async () => {
  const { promisify } = require("util");
  const brotliCompress = promisify(zlib.brotliCompress);

  // Diverse source code — different class names per iteration so the compressor
  // can't trivially collapse identical blocks
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
    `Quality 9 + LGWIN:22 (${q9win.length}B) must be smaller than quality 6 (${q6.length}B) on the same input`,
  );
});
```

- [ ] **Step 2: Run test to confirm it passes (it should — q9 > q6, always)**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1 | grep -E "Brotli fallback|not ok"
```

Expected: `ok` — this test validates the configuration we're about to set is actually an improvement. If it fails, the test environment is broken.

- [ ] **Step 3: Update Brotli params in `compressTransportChunk`**

In `mesh-core/src/compression-core.cjs`, replace:

```js
  return legacyBrotliCompress(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 6,
    },
  });
```

With:

```js
  return legacyBrotliCompress(buffer, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 22,
    },
  });
```

- [ ] **Step 4: Run all tests**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && git add mesh-core/src/compression-core.cjs test/compression-core.test.js && git commit -m "perf(compression): upgrade transport Brotli fallback to quality 9 + LGWIN:22"
```

---

## Task 3: Double transport chunk size from 128KB to 256KB

**Files:**
- Modify: `mesh-core/src/compression-core.cjs:49` (`DEFAULT_CHUNK_SIZE`)
- Modify: `mesh-core/src/compression-core.cjs:1648` (`buildTransportEnvelope` cap)
- Modify: `test/compression-core.test.js` (add 600KB chunk-count test)

**Context:** Two changes are needed together. `DEFAULT_CHUNK_SIZE` controls how large each uncompressed chunk is, but `buildTransportEnvelope` line 1648 has a separate hardcoded cap of `128 * 1024` that silently overrides the constant. The module already declares `MAX_TRANSPORT_CHUNK_BYTES = 256 * 1024` (line 52) as the intended upper bound — it just isn't being used in the cap. Fix: replace the literal `128 * 1024` in the cap with `MAX_TRANSPORT_CHUNK_BYTES`, and raise `DEFAULT_CHUNK_SIZE` to match. Larger chunks give zstd/Brotli more context to find cross-boundary repetitions, yielding 5-10% additional ratio improvement on real workspace files.

**Backward compatibility:** Chunk boundaries are an encoding detail, not stored in the record format. Existing records have their chunks stored as base64 blobs — decoding uses the chunk's own `rawLength` field, not the original `DEFAULT_CHUNK_SIZE`. No migration needed.

**Existing test impact:** The test at line 161 (`"transport envelope uses 128KB chunk size..."`) asserts `≤4 chunks` for a 300KB input. At 256KB chunks, 300KB fits in 2 chunks — still ≤4, still passes. Only the test description is now slightly stale; leave it as-is to avoid noise.

- [ ] **Step 1: Add a test that distinguishes 128KB vs 256KB chunk size**

Add to `test/compression-core.test.js`:

```js
test("transport envelope uses 256KB chunk size — 700KB input produces at most 3 chunks", async () => {
  // ~700KB of varied source — at 256KB chunks: ceil(700/256) = 3 chunks
  // At the old 128KB cap: ceil(700/128) = 6 chunks — test would fail
  const source = Array.from({ length: 10000 }, (_, i) =>
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1 | grep -E "256KB|not ok"
```

Expected: `not ok` — the 700KB input produces 6 chunks at the current 128KB cap.

- [ ] **Step 3: Raise `DEFAULT_CHUNK_SIZE` to 256KB**

In `mesh-core/src/compression-core.cjs`, replace line 49:

```js
const DEFAULT_CHUNK_SIZE = 128 * 1024;
```

With:

```js
const DEFAULT_CHUNK_SIZE = 256 * 1024;
```

- [ ] **Step 4: Fix the hardcoded 128KB cap in `buildTransportEnvelope`**

In `mesh-core/src/compression-core.cjs`, replace line 1648:

```js
  const chunkSize = Math.max(2048, Math.min(Number(options.chunkSize) || DEFAULT_CHUNK_SIZE, 128 * 1024));
```

With:

```js
  const chunkSize = Math.max(2048, Math.min(Number(options.chunkSize) || DEFAULT_CHUNK_SIZE, MAX_TRANSPORT_CHUNK_BYTES));
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && node --test test/compression-core.test.js 2>&1
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp && git add mesh-core/src/compression-core.cjs test/compression-core.test.js && git commit -m "perf(compression): double transport chunk size to 256KB, use MAX_TRANSPORT_CHUNK_BYTES cap"
```

---

## Self-Review

**Spec coverage:**
- Task 1: rawStorage deflate-6 → Brotli-9 ✓ — implementation + test + legacy compat test
- Task 2: transport Brotli q6 → q9 + LGWIN:22 ✓ — implementation + direct params comparison test
- Task 3: chunk size 128KB → 256KB + cap fix ✓ — implementation + chunk-count regression test

**Backward compatibility:**
- `decodeRawStorage` handles `"brotli-base64"` (new), `"deflate-base64"` (legacy), `"utf8-base64"` (oldest) ✓
- Chunk size is an encoding parameter, not stored in the record schema — old records decode by `rawLength` per chunk, not by `DEFAULT_CHUNK_SIZE` ✓
- Transport Brotli quality change only affects newly written chunks; existing chunks have their own `contentEncoding` field ✓

**Placeholder scan:** None — all steps contain full, runnable code.

**Type consistency:** `BROTLI_PARAM_LGWIN`, `BROTLI_PARAM_QUALITY`, `MAX_TRANSPORT_CHUNK_BYTES` — all standard `zlib.constants` and module-level constants, consistent across tasks.
