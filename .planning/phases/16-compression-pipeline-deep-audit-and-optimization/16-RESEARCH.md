# Phase 16 Research — Compression Pipeline Deep Audit & Optimization

**Researched:** 2026-04-16
**Researcher:** Orchestrator (direct codebase read)
**Scope:** Full compression pipeline from file ingestion to LLM context injection

---

## 1. Compression Pipeline Map

The compression pipeline spans **5 layers** across **7 source files**.

### Layer 1: Indexability Gate
**File:** `src/core/index.js:301` / `src/core/workspace-infrastructure.js:81-85`

```
LOCAL_WORKSPACE_SKIP_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|wav|ogg|zip|gz|tar|wasm|map)$/i
LOCAL_WORKSPACE_SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|\.next|__pycache__)(\/|$)/
LOCAL_WORKSPACE_MAX_FILE_CHARS = 1_000_000
```

Used by `isWorkspaceIndexablePath()` (workspace-infrastructure.js:81), `generateMeshWorkspaceTree()` (:288), `generateMeshWorkspaceTreeFromManifest()` (:327), `scanLocalWorkspaceFiles()` (:503).

**⚠ Finding:** `.min.js` and `.min.css` are NOT in SKIP_EXTENSIONS — they were to be added in Phase 15 but the regex only covers binary formats. Minified JS/CSS still gets indexed and wastes token budget.

---

### Layer 2: Capsule Creation
**File:** `mesh-core/src/compression-core.cjs`

Entry point: `buildWorkspaceFileRecord(pathValue, text, options)` → calls `buildCodeCapsule()` for code files.

**Decision tree (buildCodeCapsule, line 582):**
```
File extension → CODE_LANGUAGE_MAP or NON_TREE_FILE_TYPES lookup
  → tree-sitter grammar available AND sourceBytes ≤ MAX_TREE_SITTER_SOURCE_BYTES (2.5 MB)?
      YES → dispatchToTreeSitterWorker() (worker thread pool, line 144)
            → parse → walkTree → extract symbols/imports/routes/literals
            → capsuleType: "structure" | "dom-outline" | "key-path" | "lineage"
      NO  → heuristic regex fallback (extractRegexLines)
            → capsuleType: "outline-evidence"
  → unknown extension → plain text excerpt
```

**Worker pool:** `TREE_SITTER_WORKER_COUNT` = `max(2, min(os.cpus().length, 8))`, configurable via `MESH_TREE_SITTER_WORKERS`. Pool lives in `getTreeSitterWorkerPool()` (line 118), lazily initialized, round-robin dispatched.

**Key limits (all env-configurable):**
| Constant | Default | Env var |
|---|---|---|
| `MAX_TREE_SITTER_SOURCE_BYTES` | 2.5 MB | `MESH_CAPSULE_MAX_TREE_SITTER_BYTES` |
| `MAX_TREE_WALK_NODES` | 50,000 | `MESH_CAPSULE_MAX_TREE_WALK_NODES` |
| `MAX_SYMBOL_DISCOVERY` | 1,200 | `MESH_CAPSULE_MAX_SYMBOLS` |
| `MAX_LLM_FALLBACK_SOURCE_BYTES` | 800 KB | `MESH_CAPSULE_MAX_LLM_FALLBACK_BYTES` |
| `TRANSPORT_CHUNK_PARALLELISM` | 4 | `MESH_TRANSPORT_CHUNK_PARALLELISM` |

**Transport encoding:** `zstd-chunked` (if Node ≥ 21 with zstd support) OR `brotli-chunked` fallback. Chunk size: 256 KB, max 512 chunks, parallelism 4.

---

### Layer 3: Storage (DynamoDB / S3)
**File:** `src/core/workspace-infrastructure.js` (blob storage), `workspace-metadata-store.cjs`

Workspace records serialized via `serializeWorkspaceFileRecord()` → Zstd/Brotli-compressed envelope → stored in DynamoDB or S3 depending on size. Read back via `decodeRawStorage()`.

---

### Layer 4: Context Budget Resolution
**File:** `src/core/workspace-ops.js:1440` — `resolveAdaptiveCompressedContextBudget()`

Per-request budget determined by NLP analysis of the last user message:

| Mode | maxFiles | maxModelCompressedChars (first file) | Codec dict |
|---|---|---|---|
| `single-file` | 1 | 6,500 | disabled |
| `active-file` | 2 | 12,000 | disabled |
| `balanced` | 2 | 22,000 | enabled |
| `broad` | 3 | 32,000 | enabled |

**⚠ Finding:** The balanced mode default of 22,000 chars ≈ ~5,500 tokens just for capsule content (before codec overhead). Broad mode: 32,000 chars ≈ ~8,000 tokens. These are significant input token costs per request.

---

### Layer 5: Context Injection into LLM
**File:** `src/core/workspace-context.js:812` — `loadCapsuleContextEntries()`

1. For each path in budget: `openWorkspaceFileWithFallback(path, "capsule"|"focused")`
2. Rendered capsule content vs. per-file char limit:
   - Content fits → inject as plain text
   - Content too large → apply `encodeMeshModelCodec()` (Mesh ROT47-variant + dictionary)
   - Still too large → truncate with `[capsule truncated by gateway budget]` marker
3. Build `<mesh_workspace_context>` XML block via `buildCapsuleContextBlock()`
4. Inject into messages via `injectCompressedContextIntoMessages()`

**Mesh Codec:** A proprietary token-saving encoding (ROT47-inspired) in `src/core/model-providers.js`. When `requiresCodecDictionary` is true, a `buildMeshCodecContextDocument()` is injected into the system prompt (once per session, cached via `meshCodecSessionState`). This document itself costs tokens — exact size unknown without reading model-providers.js.

**KV-Cache optimization (line 122-131):** Codec context is injected into the system prompt (not user messages) to keep the message prefix stable across turns, enabling Anthropic/Bedrock KV-cache reuse from turn 2 onward. This is a well-designed optimization.

**Span Recovery:** `loadRecoveredSpanEntries()` (workspace-context.js:893) runs in parallel with capsule loading. Only triggered when `shouldPrefetchRecoveryForPrompt()` detects keywords like "exact", "line", "verbatim", "regex". Adds 0-4 verbatim code spans per file.

---

### Layer 6: Chat Route (Entry Point for Each Request)
**File:** `src/routes/assistant-chat.routes.js:66`

Both `/api/assistant/chat` (line 66) and `/api/assistant/chat/stream` (line 291) execute the same pipeline:
1. `getStoredCredentialsForUser()` — DynamoDB lookup (cached 60s from Phase 9)
2. `meshTunnelRequest('chat', ...)` → try remote file reference resolution, fallback to `localResolveReferencedFiles()`
3. `inferReferencedFilesFromWorkspace()` — NLP-based file ranking (LRU-cached 30s, 50-entry cap, `workspace-ops.js:1584`)
4. `resolveAdaptiveCompressedContextBudget()` — budget determination
5. `Promise.all([loadCapsuleContextEntries(), loadRecoveredSpanEntries()])` — parallel fetch
6. `buildCapsuleContextBlock()` + `injectCompressedContextIntoMessages()`
7. Optional: `buildMeshCodecContextDocument()` injected into system prompt
8. `runModelChat()` → streaming or non-streaming

**⚠ Finding:** Both `/chat` and `/chat/stream` routes duplicate the entire pipeline (steps 1-8) verbatim. This is a DRY violation of ~100 lines — any bug fix or optimization needs applying twice.

---

## 2. Token Cost Analysis

### Per-Request Token Breakdown (estimated, balanced mode)

| Component | Chars | Approx Tokens |
|---|---|---|
| System prompt (base Mesh prompt) | ~500 | ~125 |
| Codec context document (first request only, per session) | ~2,000–4,000 | ~500–1,000 |
| Capsule context block (file 1, balanced) | up to 22,000 | up to ~5,500 |
| Capsule context block (file 2, balanced) | up to 12,000 | up to ~3,000 |
| Recovered spans (optional) | up to ~8,000 | up to ~2,000 |
| User message history | variable | variable |
| **Subtotal (context, no history)** | — | **~8,500–11,625** |

**Token cost drivers ranked:**
1. Capsule content (largest, per request)
2. Codec dictionary document (one-time per session — KV-cache mitigates this from turn 2)
3. Recovered spans (triggered by keyword detection)
4. System prompt (fixed)

**⚠ Finding:** No global token cap is enforced before calling the LLM. The budget system limits chars, but if multiple files are large and truncation kicks in (with `[capsule truncated by gateway budget]` markers), the LLM receives incomplete context without knowing what was cut.

---

## 3. Security Audit

### 🔴 MEDIUM: No size limit on `meshTunnelRequest` response before processing
`assistant-chat.routes.js:82` — response from `meshTunnelRequest('chat', ...)` is trusted for `referencedFiles` without validation of array length or path content. A malicious tunnel server could return thousands of paths, causing `loadCapsuleContextEntries()` to make many DynamoDB reads. **Mitigation:** `dedupedPaths.slice(0, maxFiles)` in loadCapsuleContextEntries caps this to maxFiles (1-8), so actual impact is bounded.

### 🟡 LOW: `activeFilePath` from client body not fully sanitized before use
`assistant-chat.routes.js:93` — `toSafePath(activeFilePath)` is called, which normalizes path separators and trims. However `toSafePath()` may not prevent paths like `../../etc/passwd` if the workspace root is not enforced. Need to verify `toSafePath` implementation.

### 🟡 LOW: Codec policy recovery sends user-influenced data back to model
`assistant-chat.routes.js:155-176` — On codec protocol refusal, a recovery prompt with `<mesh_protocol_note>` is injected. If the original `modelMessages` contains user-controlled content that caused the refusal, the retry sends it again. No risk of SSRF/injection into backend, but the LLM receives the message twice, doubling output token costs on recovery paths.

### 🟢 INFO: Worker thread error handling crashes pool correctly
`compression-core.cjs:130-138` — Worker fatal errors reject all pending tasks and set `_tsWorkerPool = null`, allowing pool rebuild on next call. This is correct behavior.

### 🟢 INFO: `MAX_TRANSPORT_DECOMPRESSED_BYTES = 8 MB` bomb limit
Decompressed workspace blobs are capped at 8 MB (line 58), preventing decompression bombs.

---

## 4. Optimization Opportunities

### 💰 Cost: Eliminate `.min.js`/`.min.css` from indexing
**Location:** `src/core/index.js:301`
**Current:** `LOCAL_WORKSPACE_SKIP_EXTENSIONS` doesn't include minified files
**Fix:** Add `\.min\.(js|css)$` to the regex (already planned in Phase 15 scope but not verified as done)
**Impact:** Eliminates entire capsule processing overhead for minified files + removes token-wasting capsules from context

### 💰 Cost: Deduplicate chat/stream pipeline
**Location:** `src/routes/assistant-chat.routes.js:66` + `:291`
**Current:** ~100 lines of identical pipeline code in two route handlers
**Fix:** Extract `resolveChatContext(req, normalizedMessages, options)` helper that returns `{ capsuleContextEntries, recoveredSpanEntries, contextBlock, modelMessages, requiresCodecDictionary, adaptiveContextBudget }`
**Impact:** Single point of optimization/fixing, ~200 lines code reduction

### ⚡ Speed: Lazy worker pool initialization cost on cold start
**Location:** `compression-core.cjs:118` — `getTreeSitterWorkerPool()` initialized on first call
**Current:** First compression request after server start bears full worker pool startup cost
**Fix:** Call `getTreeSitterWorkerPool()` during server initialization, not on first request
**Impact:** Eliminates cold-start latency spike for first user request (covered partly by Phase 13, but tree-sitter pool not pre-warmed)

### ⚡ Speed: `loadCapsuleContextEntries` sorts entries alphabetically (line 885)
**Current:** `entries.sort((a, b) => a.path.localeCompare(b.path))` — always re-sorts, even single entry
**Fix:** Skip sort for `entries.length <= 1`, and consider sorting by relevance score (from `inferReferencedFilesFromWorkspace`) instead of alphabetically — more relevant files should come first to maximize KV-cache prefix stability
**Impact:** Minor CPU savings + better context quality for multi-file requests

### 🎯 Quality: Truncated capsule marker is misleading
**Location:** `workspace-context.js:859`
**Current:** `[capsule truncated by gateway budget]` appended to cut content
**Fix:** Add what percentage was retained: `[capsule truncated: showing first 45% of ${Math.round(rendered.length/1000)}k chars]`
**Impact:** LLM can better calibrate how much context is missing

### 🎯 Quality: No relevance ranking before capsule injection
**Location:** `loadCapsuleContextEntries()` + `resolveAdaptiveCompressedContextBudget()`
**Current:** Files are deduplicated and loaded in path order; no quality signal about which file is most relevant to the query
**Fix:** After `inferReferencedFilesFromWorkspace()` returns ranked paths (it already scores them), pass the score into `loadCapsuleContextEntries` and use it to prioritize first-file budget allocation to the highest-scored file
**Impact:** First file (which gets the largest char budget) is always the most relevant one

### 💰🔒 Cost+Security: Unbounded `MAX_LLM_FALLBACK_SOURCE_BYTES` = 800 KB
**Location:** `compression-core.cjs:86`
**Current:** LLM fallback (non-tree-sitter) capsules can process up to 800 KB of source text via heuristic regex
**Risk:** A crafted file with millions of regex-matchable lines could cause catastrophic backtracking or extreme memory usage
**Fix:** Cap heuristic line extraction at `MAX_RENDER_ITEMS.compact` (8) items per section early, before full regex scan
**Impact:** Bounded memory + CPU for heuristic fallback

---

## 5. Caching Architecture

| Cache | Location | TTL | Size Cap | What's Cached |
|---|---|---|---|---|
| Tree-sitter parser instances | `compression-core.cjs:421` Map | permanent (per process) | unbounded | Parser objects keyed by language name |
| Session auth cache | `src/core/auth.js` | 30s | per user | DynamoDB session + user lookup |
| BYOK credential cache | `src/core/auth.js` | 60s | per user | DynamoDB credential bundle |
| File inference cache | `workspace-ops.js:1584` | 30s | 50 entries | `inferReferencedFilesFromWorkspace` results |
| Codec session state | `src/core/model-providers.js` | session lifetime | per sessionId | Whether codec context was injected |
| Workspace blob (DynamoDB/S3) | workspace-infrastructure.js | permanent | S3 offload | Compressed workspace records |

**⚠ Gap:** No cache for `openWorkspaceFileWithFallback()` results within a single request. For multi-file requests (broad mode, maxFiles=3), if two different requests ask for the same file within 30s, the file is fetched twice from DynamoDB/S3. An in-flight dedup (request-level Map<path, Promise>) would eliminate this.

**⚠ Gap:** Tree-sitter parsers are permanently cached but the pool (`_tsWorkerPool`) can be destroyed on worker error and rebuilt empty on next call. The parsers inside worker threads are re-initialized from scratch on each pool rebuild.

---

## 6. File Inventory (All Compression-Related Files)

| File | Role |
|---|---|
| `mesh-core/src/compression-core.cjs` | Capsule creation, transport encode/decode, workspace record management |
| `mesh-core/src/compression-utils.cjs` | Utility functions (sha256, tokenEstimation, span management) |
| `mesh-core/src/tree-sitter-worker.cjs` | Worker thread for tree-sitter parsing (offloads main thread) |
| `src/core/workspace-infrastructure.js` | File indexability, workspace scan, blob storage I/O |
| `src/core/workspace-context.js` | Capsule loading, budget enforcement, context block building |
| `src/core/workspace-ops.js` | Budget resolution, file ranking, inference cache |
| `src/core/model-providers.js` | Mesh codec (encode/decode), session codec state, system prompt injection |
| `src/core/index.js` | Aggregates all core exports, defines skip constants |
| `src/routes/assistant-chat.routes.js` | Chat + stream routes that consume the full pipeline |
| `test/compression-core.test.js` | 711-line test suite covering transport encode/decode + capsule creation |

---

## 7. Validation Architecture

### Automated (npm test)
- `npm test` runs `test/compression-core.test.js` via Node built-in test runner (~10s)
- Covers: `buildWorkspaceFileRecord`, `buildWorkspaceFileView`, `ensureWorkspaceFileRecord`, `recoverWorkspaceFileRecord`, `suggestRecoverySpanIds`, transport encode/decode
- **NOT covered by automated tests:** `resolveAdaptiveCompressedContextBudget`, `loadCapsuleContextEntries`, `buildCapsuleContextBlock`, codec injection logic, `inferReferencedFilesFromWorkspace`

### Grep-verifiable acceptance criteria
- `LOCAL_WORKSPACE_SKIP_EXTENSIONS` contains `.min.js` pattern: `grep -n "min\.js" src/core/index.js`
- Chat pipeline extracted to helper: `grep -n "resolveChatContext" src/routes/assistant-chat.routes.js`
- Truncation marker improved: `grep -n "showing first" src/core/workspace-context.js`
- Worker pool pre-warm: `grep -n "getTreeSitterWorkerPool()" src/core/index.js`

### Manual verification required
- End-to-end token cost comparison (baseline vs. optimized): requires live Anthropic API + token counting
- Streaming codec decode quality: requires browser + open workspace
- Worker pool pre-warm timing: requires profiling server startup

### Estimated test runtime
- `npm test` — ~10 seconds
- Manual browser verification — 15-30 minutes per test scenario
