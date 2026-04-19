# Phase 16 Audit — Compression Pipeline Deep Code Audit

**Audited:** 2026-04-16
**Scope:** Verified findings from 16-RESEARCH.md via direct source reading.
**Files read (verbatim):**
- `mesh-core/src/compression-core.cjs` (2,567 lines)
- `mesh-core/src/compression-utils.cjs` (270 lines)
- `mesh-core/src/tree-sitter-worker.cjs` (574 lines)
- `src/core/workspace-infrastructure.js` (relevant sections)
- `src/core/workspace-ops.js` (relevant sections)
- `src/core/workspace-context.js` (relevant sections)
- `src/routes/assistant-chat.routes.js` (734 lines)
- `src/core/index.js` (skip constants, exports)
- `server.js` + `src/server.js:199`

---

## Data Flow

Exact path from filesystem bytes → LLM API call, with verified file:line anchors.

```
Workspace scan → Indexability gate → Capsule creation → Storage
                                                             ↓
                                                  Budget resolution
                                                             ↓
                                                    Capsule loading → Context injection → LLM
```

| # | Step | Function | Location |
|---|------|----------|----------|
| 1 | Workspace enumeration | `scanLocalWorkspaceFiles` | `src/core/workspace-infrastructure.js:~503` |
| 2 | Indexability gate | `isWorkspaceIndexablePath(pathInput)` | `src/core/workspace-infrastructure.js:79-88` |
| 2a | Skip-extensions regex check | `LOCAL_WORKSPACE_SKIP_EXTENSIONS.test(normalized)` | `src/core/workspace-infrastructure.js:83` → constant at `src/core/index.js:301` |
| 2b | Skip-dirs regex check | `LOCAL_WORKSPACE_SKIP_DIRS.test(normalized)` | `src/core/workspace-infrastructure.js:82` → constant at `src/core/index.js:302` |
| 2c | Lockfile skip | inline regex | `src/core/workspace-infrastructure.js:84` |
| 2d | Minified JS/CSS skip (inline) | `/\.min\.(js\|css)$/.test(normalized)` | `src/core/workspace-infrastructure.js:86` |
| 3 | Capsule creation entry | `buildWorkspaceFileRecord(pathValue, rawText, options)` | `mesh-core/src/compression-core.cjs:2145` |
| 3a | Base capsule build | `buildCodeCapsule(pathValue, text, fileType, workspaceFilePaths)` | `mesh-core/src/compression-core.cjs:582` |
| 3b | Parser selection | `CODE_LANGUAGE_MAP` / `NON_TREE_FILE_TYPES` | `mesh-core/src/compression-core.cjs:166-399` |
| 3c | Tree-sitter dispatch | `dispatchToTreeSitterWorker(pathValue, text, fileType)` | `mesh-core/src/compression-core.cjs:144-164` |
| 3d | Worker pool init | `getTreeSitterWorkerPool()` | `mesh-core/src/compression-core.cjs:118-142` |
| 3e | Regex fallback | `extractRegexLines(text, regex, mapper)` | `mesh-core/src/compression-core.cjs:514` |
| 4 | Raw compression | `encodeRawStorage(rawText, options)` | `mesh-core/src/compression-core.cjs:2056` |
| 4a | Storage decode | `decodeRawStorage(rawStorage)` | `mesh-core/src/compression-core.cjs:2086` |
| 4b | Serialize for DynamoDB | `serializeWorkspaceFileRecord(meta)` | `mesh-core/src/compression-core.cjs:2474` |
| 5 | Chat request entry | `router.post('/api/assistant/chat', ...)` | `src/routes/assistant-chat.routes.js:66-262` |
| 5' | Stream request entry | `router.post('/api/assistant/chat/stream', ...)` | `src/routes/assistant-chat.routes.js:291-~490` |
| 6 | Referenced file resolution | `meshTunnelRequest('chat', ...)` → `localResolveReferencedFiles` fallback | `src/routes/assistant-chat.routes.js:81-86` (and `:318-323`) |
| 7 | NLP file ranking | `inferReferencedFilesFromWorkspace(lastUserMessage, requestId)` | `src/routes/assistant-chat.routes.js:89` (LRU at `src/core/workspace-ops.js:~1584`) |
| 8 | Budget resolution | `resolveAdaptiveCompressedContextBudget({ lastUserMessage, hasActiveFileFocus })` | `src/core/workspace-ops.js:1440-1496` |
| 9 | Capsule + span parallel load | `Promise.all([loadCapsuleContextEntries(...), loadRecoveredSpanEntries(...)])` | `src/routes/assistant-chat.routes.js:101-113` (and `:338-350`) |
| 9a | Capsule loader | `loadCapsuleContextEntries(paths, options)` | `src/core/workspace-context.js:812-891` |
| 9b | Span recovery loader | `loadRecoveredSpanEntries(paths, query, options)` | `src/core/workspace-context.js:893-924` |
| 10 | Capsule encoding decision | `encodeMeshModelCodec(rendered, { withMeta, disableDictionary })` | `src/core/workspace-context.js:849-856` |
| 11 | Truncation fallback | inline slice + marker | `src/core/workspace-context.js:858-861` |
| 12 | Context block build | `buildCapsuleContextBlock(entries, recoveredSpans)` | `src/core/workspace-context.js:934-...` |
| 13 | Message injection | `injectCompressedContextIntoMessages(messages, block)` | `src/routes/assistant-chat.routes.js:119` (and `:355`) |
| 14 | Codec doc injection | `buildMeshCodecContextDocument({ dictionaryEnabled })` + `injectMeshSystemPrompt(...)` | `src/routes/assistant-chat.routes.js:125-136` |
| 15 | LLM call | `runModelChat({ model, messages, credentials })` | `src/routes/assistant-chat.routes.js:134` |
| 15' | LLM streaming call | `streamBedrockDirect` / `streamAnthropicNative` / `streamOpenAICompatible` | `src/routes/assistant-chat.routes.js:495, 547, 617` |
| 16 | Server listen | `server.listen(PORT, ...)` | `src/server.js:199` (note: `server.js` is a 1-line shim to `src/server.js`) |

---

## Token Cost Analysis

Per-mode budget breakdown, confirmed from `resolveAdaptiveCompressedContextBudget` at `src/core/workspace-ops.js:1440-1496`. Token estimates use ≈4 chars/token heuristic.

| Mode | Max Files | 1st File Chars | Other Files Chars | Total Decoded Cap | Approx Input Tokens |
|------|-----------|----------------|-------------------|-------------------|---------------------|
| single-file | 1 | 6,500 | — | 10,000 | ~1,625 |
| active-file | 2 | 12,000 | 7,000 | 26,000 | ~4,750 |
| balanced | 2 | 22,000 | 12,000 | 52,000 | ~8,500 |
| broad | 3 | 32,000 | 18,000 (×2) | 90,000 | ~17,000 |

**Trigger logic (verified at workspace-ops.js:1440-1446):**
- `single-file`: (`hasActiveFileFocus` OR extension hint OR `SINGLE_FILE_LOOKUP_RE`) AND NOT `MULTI_FILE_LOOKUP_RE` AND NOT `BROAD_CHANGE_INTENT_RE`
- `active-file`: `hasActiveFileFocus` AND NOT `MULTI_FILE_LOOKUP_RE` (fallthrough from single-file)
- `broad`: `MULTI_FILE_LOOKUP_RE` OR `BROAD_CHANGE_INTENT_RE`
- `balanced`: default

**BROAD_CHANGE_INTENT_RE** (`workspace-ops.js:1438`):
`/\b(refactor|rewrite|rework|update|change|modify|implement|build|add|create|fix|bug|issue|across|project|repository|repo|codebase|architektur|architecture)\b/i`

> ⚠ The broad-intent regex is very wide — words like "add", "create", "update", "fix" will trigger broad mode even on small single-file changes. This inflates token costs for simple requests. Not in scope for Plan 02 but worth noting for a future phase.

**Disable codec dictionary:** true for `single-file` and `active-file`, false for `balanced` and `broad`. The dictionary costs ~2-4 KB of system-prompt tokens per session — disabling for small-context modes saves tokens when KV-cache has not yet warmed.

---

## Findings

### Finding 1: `LOCAL_WORKSPACE_SKIP_EXTENSIONS` regex does not cover minified JS/CSS
- **Severity:** MEDIUM
- **Location:** `src/core/index.js:301`
- **Description:** The exported regex omits `.min.js` and `.min.css`. The exact current value is:
  `/\.(png|jpg|jpeg|gif|svg|ico|webp|woff2?|ttf|eot|mp4|mp3|wav|ogg|zip|gz|tar|wasm|map)$/i`
- **Evidence:** Read verbatim at `src/core/index.js:301`. A secondary inline check exists at `src/core/workspace-infrastructure.js:86` (`if (/\.min\.(js|css)$/.test(normalized)) return false;`) — so minified files ARE currently being skipped during `isWorkspaceIndexablePath`, but the regex contract itself is incomplete. Any other caller that imports `LOCAL_WORKSPACE_SKIP_EXTENSIONS` directly (rather than going through `isWorkspaceIndexablePath`) will still try to index minified files.
- **Verified discrepancy with RESEARCH.md:** RESEARCH.md claimed minified files are NOT excluded. This is only half right — they ARE excluded by an inline check, but the exported constant is incomplete. Plan 02-01 correctly moves the exclusion into the canonical regex.

### Finding 2: `/api/assistant/chat` and `/api/assistant/chat/stream` duplicate ~35 lines of pipeline setup
- **Severity:** HIGH
- **Location:** `src/routes/assistant-chat.routes.js:79-117` (chat) and `:316-353` (stream)
- **Description:** Both routes run the same 6-step pipeline to resolve referenced files, compute `hasActiveFileFocus`, call `resolveAdaptiveCompressedContextBudget`, and `Promise.all` over `loadCapsuleContextEntries` + `loadRecoveredSpanEntries`, then call `buildCapsuleContextBlock` and `injectCompressedContextIntoMessages`. The two blocks differ only in indentation depth (one is inside a try/catch wrapping the whole stream handler) and in `const modelMessages` vs. `let modelMessages`.
- **Evidence:** Diffed the two blocks by reading `:79-119` and `:316-355`. Content is semantically identical. A bug fix (e.g., handling of the tunnel failure path) would have to be applied in two places.
- **Impact:** Any future optimization — caching, request-level dedup, scoring-based first-file selection — must be duplicated. High risk of drift.

### Finding 3: Truncation marker is opaque — LLM cannot calibrate what's missing
- **Severity:** MEDIUM
- **Location:** `src/core/workspace-context.js:859`
- **Description:** Exact string: `${rendered.slice(0, nextLimit)}\n\n[capsule truncated by gateway budget]`. No indication of how much was cut. A 5% truncation and a 95% truncation look the same to the model, so the LLM cannot reason about whether the answer is grounded in most of the file or only a sliver.
- **Evidence:** Read verbatim at `src/core/workspace-context.js:859`. The variable `nextLimit` is `Math.max(600, perFileLimit - 128)` and `rendered` is the full capsule string.
- **Exact current marker string for Plan 02-03:** `[capsule truncated by gateway budget]`

### Finding 4: `getTreeSitterWorkerPool` is lazy — first request pays worker spawn cost
- **Severity:** MEDIUM
- **Location:** `mesh-core/src/compression-core.cjs:118-142`
- **Description:** The worker pool is instantiated on first call to `dispatchToTreeSitterWorker()`. A cold server's first user request bears the cost of spawning `TREE_SITTER_WORKER_COUNT` worker threads (default 2-8 based on CPU count), each of which must require tree-sitter grammars.
- **Evidence:** Read verbatim at `:113-142`. `let _tsWorkerPool = null;` at line 113, initialized at line 120 only when `getTreeSitterWorkerPool()` is called. Also confirmed the symbol is **NOT** in the `module.exports` block at `:2539-2567`.
- **Blocker for Plan 02-04:** The current export list does NOT include `getTreeSitterWorkerPool`, so server-side pre-warming requires adding it to `module.exports` first.

### Finding 5: `resolveAdaptiveCompressedContextBudget` is not covered by automated tests
- **Severity:** MEDIUM
- **Location:** `src/core/workspace-ops.js:1440-1496`
- **Description:** The function encodes the entire token-cost policy of the gateway (4 modes × 8 knobs each = 32 tunable values). A regression here could silently 4× token costs. No tests exist — `test/compression-core.test.js` covers only the capsule machinery, not the budget layer.
- **Evidence:** Grep confirmed `grep -c resolveAdaptiveCompressedContextBudget test/*.js` returned 0 matches before Plan 02-05.

### Finding 6: `loadCapsuleContextEntries` always sorts alphabetically, even with a single entry
- **Severity:** LOW
- **Location:** `src/core/workspace-context.js:885` — `entries.sort((a, b) => a.path.localeCompare(b.path));`
- **Description:** The sort discards the relevance ordering from `inferReferencedFilesFromWorkspace` (which ranked by score). Most-relevant file ends up second/third depending on alphabetical ordering. This also weakens KV-cache stability across turns because the first file's position in the prefix changes as the set grows/shrinks.
- **Evidence:** Read verbatim at `:885`. Called unconditionally regardless of `entries.length`.
- **Not in Plan 02 scope** — flagged for a follow-up phase.

### Finding 7: LLM fallback regex scan is unbounded on total items
- **Severity:** LOW
- **Location:** `mesh-core/src/compression-core.cjs:514` (`extractRegexLines`) and `:85-89` (`MAX_LLM_FALLBACK_SOURCE_BYTES = 800 KB`)
- **Description:** The heuristic fallback caps total bytes processed but does not cap items per section early. A crafted 800 KB file with thousands of regex-matchable lines will fully scan, then truncate, rather than short-circuit at `MAX_RENDER_ITEMS.compact = 8`.
- **Evidence:** Read at `:85-96`. `MAX_RENDER_ITEMS` defines limits but they're applied at render time, not during extraction.
- **Not in Plan 02 scope** — noted for a future security/performance pass.

---

## Caching Gaps

| Gap | Impact | Suggested fix |
|-----|--------|---------------|
| No request-level dedup for `openWorkspaceFileWithFallback` | In broad mode (`maxFiles: 3`), if two paths are aliases of the same underlying record, the file is fetched twice from DynamoDB/S3 within one request | Wrap with a `Map<path, Promise>` memoizer scoped to a single request |
| `getTreeSitterWorkerPool()` is lazy (Finding 4) | Cold-start latency spike on first compression request | Plan 02-04 pre-warms it |
| Tree-sitter parser instances are permanently cached but can be silently dropped when pool is destroyed | On worker error, `_tsWorkerPool = null` (line 137) but parsers inside workers are re-initialized from scratch on rebuild | Not addressed in this phase |
| No cache for `resolveAdaptiveCompressedContextBudget` results across turns in a session | Each chat turn re-runs NLP classification on the last user message | Session-scoped cache keyed on `(lastUserMessage, hasActiveFileFocus)` — low priority, NLP is cheap |

---

## Implementation Order

Ranked by ratio of impact to implementation risk.

1. **Plan 02-02 — Extract `resolveChatContext` helper** — Highest impact: unlocks every future optimization. Single-file change (`assistant-chat.routes.js`), ~40 lines deleted from each route. Risk: medium (must preserve two subtle differences: `const vs. let modelMessages`, try/catch wrapping in stream path).
2. **Plan 02-05 — Unit tests for `resolveAdaptiveCompressedContextBudget`** — Medium impact: pins down the exact mode-selection contract before future refactors. Zero-risk: new file.
3. **Plan 02-04 — Pre-warm tree-sitter worker pool** — Medium impact: eliminates cold-start spike (likely 200-500ms on first request, varies by OS). Must add `getTreeSitterWorkerPool` to `module.exports` first (Finding 4 confirms it is missing). Note: the `grep "getTreeSitterWorkerPool" server.js` acceptance criterion only passes if we put the pre-warm in `src/server.js` (the real listen file) and accept that `server.js` is a shim.
4. **Plan 02-03 — Improve truncation marker** — Medium impact: gives LLM better self-awareness of cut context. Zero-risk single-line edit.
5. **Plan 02-01 — Add `.min.js`/`.min.css` to skip regex** — Lowest additional impact (already skipped by the inline check at `workspace-infrastructure.js:86`) but closes the contract gap on the exported constant. Zero-risk. Required for grep-verifiable plan criteria.

Estimated token savings:
- Plan 02-01: marginal (≤1% — already caught inline).
- Plan 02-02: 0% now, but enables future work (scoring, dedup cache) that could save 10-20%.
- Plan 02-03: quality improvement, not a token reduction — but prevents LLM from wasting output tokens asking for clarification of missing context.
- Plan 02-04: 0 token cost, ~200-500ms latency on first request.
- Plan 02-05: 0 token cost, regression safety net.

---

## Verification Notes

Discrepancies between `16-RESEARCH.md` and verified code:

- RESEARCH.md claimed `.min.js` was "not excluded"; verified it IS excluded by the inline check at `workspace-infrastructure.js:86`, but the named regex constant `LOCAL_WORKSPACE_SKIP_EXTENSIONS` does NOT include it. Plan 02-01 is still the correct fix — it closes the contract gap.
- RESEARCH.md claimed both routes duplicate "~100 lines"; actual duplicate block is ~35 lines per route (~70 total). Still substantial, still worth the helper.
- RESEARCH.md referenced "`getTreeSitterWorkerPool()` initialized on first call" — confirmed at `compression-core.cjs:118-142`. Also verified it is **not** currently in `module.exports` (`:2539-2567`) — must be added for Plan 02-04 to work.
- RESEARCH.md's token estimates align with mode char limits × ¼ tokens-per-char — numbers are accurate.
- RESEARCH.md called out `entries.sort` alphabetical (Finding 6) — confirmed at `workspace-context.js:885`. Not in scope for Plan 02.
- `server.js` is a 1-line shim (`require('./src/server.js');`) — the real `server.listen(PORT, ...)` is at `src/server.js:199`. Plan 02-04 pre-warm code must go into `src/server.js`, not `server.js`.

No behavioral changes were made during the audit — Plan 16-01 is strictly read-only.
