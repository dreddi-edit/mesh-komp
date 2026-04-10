# Codebase Cleanup — Archive + File Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every source file stays under 2000 lines, non-runtime archive assets move to `archive/`, and all links/requires/imports continue working without behaviour change.

**Architecture:** All refactors are pure moves — no logic changes. `src/core/index.js` extractions follow the existing globals pattern: extracted modules use bare-name references to globals (server.js propagates every `module.exports` key onto `global` at boot). For `mesh-core/src/server.js` (ESM), shared mutable state moves to a dedicated `mesh-state.js` module that all files import from. `compression-core.cjs` offloads self-contained text utilities to `compression-utils.cjs`.

**Tech Stack:** Node.js 20 CJS + ESM, Express, `node --check` for syntax validation, `npm test` (node --test) for regression checks.

---

## Files Over 2000 Lines (Must Be Split)

| File | Current | Target | Strategy |
|---|---|---|---|
| `src/core/index.js` | 4802 | ~950 | Extract 4 modules (globals pattern) |
| `mesh-core/src/server.js` | 2798 | ~1150 | Extract state + operations modules (ESM import) |
| `mesh-core/src/compression-core.cjs` | 2196 | ~1960 | Extract text utilities to `compression-utils.cjs` |

## Archive Items (Must Be Moved)

| Source | Destination | Reason |
|---|---|---|
| `Animationen/` | `archive/Animationen/` | Runtime uses `assets/animations/*` only |
| `Logos/` | `archive/Logos/` | Runtime uses `assets/brand/*` only |
| `CODEX-PHASE-2-3.md` | `docs/archive/CODEX-PHASE-2-3.md` | Historical plan, no longer active |

---

## Globals Pattern (Reference — Read Before Tasks 2–6)

`src/server.js` line 7-9:
```js
Object.keys(core).forEach(k => {
    global[k] = core[k];
});
```
Every key in `src/core/index.js`'s `module.exports` becomes a global. Extracted CJS modules can therefore reference any export of index.js by bare name — as long as the function is only _called_ at request-time (after server boot), never at `require()` time. This is the same pattern used by `src/core/assistant-runs.js`. External Node.js modules (`path`, `fs`, etc.) still need explicit `require()` in each file.

---

## Task 1: Archive Non-Runtime Folders and Files

**Files:**
- Move: `Animationen/` → `archive/Animationen/`
- Move: `Logos/` → `archive/Logos/`
- Move: `CODEX-PHASE-2-3.md` → `docs/archive/CODEX-PHASE-2-3.md`
- Modify: `CODEBASE-MAP.md`

- [ ] **Step 1: Create archive folder and move Animationen**

```bash
mkdir -p archive
mv Animationen archive/Animationen
```

- [ ] **Step 2: Move Logos**

```bash
mv Logos archive/Logos
```

- [ ] **Step 3: Move historical doc**

```bash
mv CODEX-PHASE-2-3.md docs/archive/CODEX-PHASE-2-3.md
```

- [ ] **Step 4: Update CODEBASE-MAP.md**

Find the section `## Asset Archives and Non-Canonical Source Material` and replace the entries:

```markdown
## Asset Archives and Non-Canonical Source Material

All raw/archive assets live under `archive/` at the repo root.

- `archive/Animationen/`
  Purpose: raw animation source files (Lottie JSON source + preview HTML).
  Works with: reference only; runtime uses `assets/animations/*`.

- `archive/Logos/`
  Purpose: raw brand logo exports in jpeg/png/svg for three variants.
  Works with: reference only; runtime uses `assets/brand/*`.

- `docs/archive/CODEX-PHASE-2-3.md`
  Purpose: historical build/refactor plan from earlier phases.
  Works with: historical context only.
```

- [ ] **Step 5: Verify and commit**

```bash
ls archive/
ls docs/archive/
```

Expected: `archive/Animationen  archive/Logos` and `docs/archive/CODEX-PHASE-2-3.md` exist.

```bash
git add -A
git commit -m "chore: move archive assets to archive/ and docs/archive/"
```

---

## Task 2: Extract `mesh-core/src/compression-utils.cjs`

**Context:** `compression-core.cjs` is 2196 lines. Lines 322–562 contain 18 self-contained text/span utility functions with no dependency on tree-sitter or capsule logic. Extracting them brings the file to ~1960 lines.

**Files:**
- Create: `mesh-core/src/compression-utils.cjs`
- Modify: `mesh-core/src/compression-core.cjs`

- [ ] **Step 1: Establish baseline**

```bash
node --check mesh-core/src/compression-core.cjs
npm test 2>&1 | tail -5
```

Expected: syntax OK, tests pass (note current pass count for later comparison).

- [ ] **Step 2: Create `mesh-core/src/compression-utils.cjs`**

Cut lines 322–562 from `compression-core.cjs` (functions `sha256Hex` through `dedupeByText` and `createSpanManager`) and paste them as the body of the new file:

```js
'use strict';
/**
 * MESH Compression — Text and span utilities.
 * Extracted from compression-core.cjs. No tree-sitter or capsule dependencies.
 */

// --- paste functions sha256Hex (line 322) through createSpanManager (line 562) here ---

module.exports = {
  sha256Hex,
  safeJsonClone,
  finiteInteger,
  mapWithConcurrency,
  trimPath,
  extensionOf,
  basename,
  slugify,
  normalizeWhitespace,
  truncateText,
  estimateTextTokens,
  buildLineStarts,
  locateLineFromCharIndex,
  byteOffsetFromCharIndex,
  charIndexFromLineRange,
  sliceTextByLines,
  dedupeByText,
  createSpanManager,
};
```

- [ ] **Step 3: Update `compression-core.cjs` — replace cut lines with a require**

At the point where `sha256Hex` was (original line 322, now a gap), insert:

```js
const {
  sha256Hex, safeJsonClone, finiteInteger, mapWithConcurrency,
  trimPath, extensionOf, basename, slugify, normalizeWhitespace,
  truncateText, estimateTextTokens, buildLineStarts,
  locateLineFromCharIndex, byteOffsetFromCharIndex, charIndexFromLineRange,
  sliceTextByLines, dedupeByText, createSpanManager,
} = require('./compression-utils.cjs');
```

- [ ] **Step 4: Verify syntax and line counts**

```bash
node --check mesh-core/src/compression-utils.cjs && echo "utils OK"
node --check mesh-core/src/compression-core.cjs && echo "core OK"
wc -l mesh-core/src/compression-core.cjs mesh-core/src/compression-utils.cjs
```

Expected: both OK; `compression-core.cjs` under 2000 lines.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: same pass count as Step 1 baseline.

- [ ] **Step 6: Commit**

```bash
git add mesh-core/src/compression-utils.cjs mesh-core/src/compression-core.cjs
git commit -m "refactor(compression): extract text/span utilities to compression-utils.cjs"
```

---

## Task 3: Extract `src/core/workspace-infrastructure.js`

**Context:** Lines 686–1794 of `index.js` contain ~56 functions: tunnel request, path utilities, workspace state helpers, workspace-select queue, Azure blob I/O, and blob helpers. None depend on later functions in index.js. They reference `localAssistantWorkspace`, `workspaceMetadataStore`, `brotliCompress`, `brotliDecompress`, `appendOperationLog`, `toIsoNow`, and the workspace constants — all of which are in `module.exports` and therefore in `global` at call time.

**Files:**
- Create: `src/core/workspace-infrastructure.js`
- Modify: `src/core/index.js`

- [ ] **Step 1: Establish line-count baseline**

```bash
wc -l src/core/index.js
node --check src/core/index.js
```

- [ ] **Step 2: Create `src/core/workspace-infrastructure.js`**

```js
'use strict';
/**
 * MESH — Workspace Infrastructure Layer
 * Extracted from src/core/index.js.
 * Uses globals set up by server.js at runtime:
 *   localAssistantWorkspace, workspaceMetadataStore, brotliCompress, brotliDecompress,
 *   appendOperationLog, toIsoNow, workspaceSelectJobs, workspaceSelectJobOrder,
 *   workspaceSelectChains, operationsStore, and all WORKSPACE_* / MESH_* constants.
 * External packages required below for blob and filesystem operations.
 */

const path   = require('path');
const fs     = require('fs');
const zlib   = require('zlib');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);
const { BlobClient, BlockBlobClient } = require('@azure/storage-blob');
const {
  buildWorkspaceFileRecord,
  buildWorkspaceFileView,
  decodeRawStorage,
  ensureWorkspaceFileRecord,
  recoverWorkspaceFileRecord,
  serializeWorkspaceFileRecord,
  suggestRecoverySpanIds,
  LEGACY_WORKSPACE_ENCODING,
  TRANSPORT_CONTENT_ENCODING,
  TRANSPORT_ENVELOPE_VERSION,
  WORKSPACE_RECORD_VERSION,
} = require('../../mesh-core/src/compression-core.cjs');
const { createWorkspaceMetadataStore: _unused } = require('../../workspace-metadata-store.cjs');

// --- paste index.js lines 686–1794 here (meshTunnelRequest through deleteWorkspaceBlob) ---

module.exports = {
  meshTunnelRequest,
  toSafePath,
  basename,
  ensureWorkspaceOwnedPath,
  localWorkspaceSummary,
  clearLocalWorkspaceState,
  isLocalPathWorkspaceState,
  isUploadWorkspaceState,
  syncLocalUploadWorkspaceSummary,
  toWorkspacePath,
  toWorkspaceRelativePath,
  normalizeAbsoluteRootPath,
  resolveLocalWorkspaceAbsolutePath,
  gitPathFromWorkspacePath,
  workspacePathFromGitPath,
  generateMeshWorkspaceTree,
  generateMeshWorkspaceTreeFromManifest,
  provisionMeshWorkspaceMetadata,
  readLocalWorkspaceFileText,
  scanLocalWorkspaceFiles,
  packLocalWorkspaceContent,
  localWorkspaceUploadBlobStorageForPath,
  packLocalBlobBackedWorkspaceRecord,
  writeLocalWorkspaceFileToDisk,
  normalizeGitError,
  getLocalGitCwd,
  runLocalGit,
  isMeshWorkerUnavailableError,
  countPendingWorkspaceSelectJobs,
  pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload,
  workspaceSelectScopeKey,
  computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob,
  buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback,
  enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload,
  getWorkspaceSelectJobForUser,
  sortedLocalPaths,
  buildAzureBlobAbsoluteUrl,
  buildAzureBlobCanonicalUrl,
  normalizeWorkspaceBlobStorage,
  buildWorkspaceBlobReadUrl,
  createWorkspaceOffloadConfig,
  workspaceOffloadClientConfig,
  compressLocalWorkspaceText,
  decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile,
  readWorkspaceBlobText,
  writeWorkspaceBlobText,
  copyWorkspaceBlob,
  deleteWorkspaceBlob,
};
```

- [ ] **Step 3: Remove lines 686–1794 from `index.js` and add require + destructure**

In `index.js`, delete lines 686–1794. In their place, add:

```js
const wi = require('./workspace-infrastructure');
const {
  meshTunnelRequest, toSafePath, basename, ensureWorkspaceOwnedPath,
  localWorkspaceSummary, clearLocalWorkspaceState, isLocalPathWorkspaceState,
  isUploadWorkspaceState, syncLocalUploadWorkspaceSummary, toWorkspacePath,
  toWorkspaceRelativePath, normalizeAbsoluteRootPath, resolveLocalWorkspaceAbsolutePath,
  gitPathFromWorkspacePath, workspacePathFromGitPath, generateMeshWorkspaceTree,
  generateMeshWorkspaceTreeFromManifest, provisionMeshWorkspaceMetadata,
  readLocalWorkspaceFileText, scanLocalWorkspaceFiles, packLocalWorkspaceContent,
  localWorkspaceUploadBlobStorageForPath, packLocalBlobBackedWorkspaceRecord,
  writeLocalWorkspaceFileToDisk, normalizeGitError, getLocalGitCwd, runLocalGit,
  isMeshWorkerUnavailableError, countPendingWorkspaceSelectJobs, pruneWorkspaceSelectJobs,
  estimateWorkspaceSelectPayload, workspaceSelectScopeKey, computeWorkspaceSelectQueuePosition,
  snapshotWorkspaceSelectJob, buildWorkspaceSelectAcceptedResponse,
  executeWorkspaceSelectWithFallback, enqueueWorkspaceSelectJob,
  shouldQueueWorkspaceSelectPayload, getWorkspaceSelectJobForUser, sortedLocalPaths,
  buildAzureBlobAbsoluteUrl, buildAzureBlobCanonicalUrl, normalizeWorkspaceBlobStorage,
  buildWorkspaceBlobReadUrl, createWorkspaceOffloadConfig, workspaceOffloadClientConfig,
  compressLocalWorkspaceText, decompressLocalWorkspaceText,
  normalizeIncomingWorkspacePreindexedFile, readWorkspaceBlobText, writeWorkspaceBlobText,
  copyWorkspaceBlob, deleteWorkspaceBlob,
} = wi;
```

All these names are already present in `module.exports` of index.js — confirm the exports block still lists them (or add any missing ones).

- [ ] **Step 4: Syntax check**

```bash
node --check src/core/workspace-infrastructure.js && echo "wi OK"
node --check src/core/index.js && echo "index OK"
wc -l src/core/index.js
```

Expected: both files pass; index.js now ~3650 lines.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

Expected: same pass count as Task 2.

- [ ] **Step 6: Commit**

```bash
git add src/core/workspace-infrastructure.js src/core/index.js
git commit -m "refactor(core): extract workspace infrastructure layer to workspace-infrastructure.js"
```

---

## Task 4: Extract `src/core/workspace-context.js`

**Context:** After Task 3, lines that were originally 1796–2820 in index.js have shifted. They contain: worker chunk compression, fallback wrappers (open/recover/search/grep/rename/delete/batch/openLocal/git), terminal session management, and context/capsule loading + building. All referenced external state is in globals.

**Files:**
- Create: `src/core/workspace-context.js`
- Modify: `src/core/index.js`

- [ ] **Step 1: Identify current line range in the updated index.js**

```bash
grep -n "^async function compressLocalWorkspaceChunkFiles\|^function polishDecompressedAssistantText\|^function looksLikeCodecProtocolRefusal" src/core/index.js
```

Note the start line for `compressLocalWorkspaceChunkFiles` and the end line of `looksLikeCodecProtocolRefusal` (the line just before `async function localWorkspaceSelect`).

- [ ] **Step 2: Create `src/core/workspace-context.js`**

```js
'use strict';
/**
 * MESH — Workspace Context Layer
 * Extracted from src/core/index.js.
 * Uses globals: localAssistantWorkspace, workspaceMetadataStore, assistantTerminalSessions,
 *   brotliCompress, brotliDecompress, meshTunnelRequest, readWorkspaceBlobText,
 *   writeWorkspaceBlobText, and all WORKSPACE_* constants.
 */

const {
  buildWorkspaceFileRecord, buildWorkspaceFileView, decodeRawStorage,
  ensureWorkspaceFileRecord, recoverWorkspaceFileRecord, serializeWorkspaceFileRecord,
  suggestRecoverySpanIds, LEGACY_WORKSPACE_ENCODING, TRANSPORT_CONTENT_ENCODING,
  TRANSPORT_ENVELOPE_VERSION, WORKSPACE_RECORD_VERSION,
} = require('../../mesh-core/src/compression-core.cjs');

// --- paste functions compressLocalWorkspaceChunkFiles through looksLikeCodecProtocolRefusal ---

module.exports = {
  compressLocalWorkspaceChunkFiles,
  openWorkspaceFileWithFallback,
  recoverWorkspaceWithFallback,
  searchWorkspaceWithFallback,
  grepWorkspaceWithFallback,
  renameWorkspaceFileWithFallback,
  deleteWorkspaceFileWithFallback,
  applyWorkspaceBatchWithFallback,
  openLocalWorkspaceWithFallback,
  runGitWithFallback,
  sanitizeTerminalChunk,
  makeAssistantTerminalEntry,
  getAssistantTerminalSession,
  createAssistantTerminalSession,
  listAssistantTerminalOutput,
  writeAssistantTerminalInput,
  destroyAssistantTerminalSession,
  createCompressedContextExcerpt,
  normalizeContextExcerptText,
  normalizeExcerptFocusTerms,
  collectFocusedCharRanges,
  mergeCharRanges,
  buildExcerptFromCharRanges,
  loadCompressedContextEntries,
  loadPlainContextEntries,
  buildPlainContextBlock,
  buildCompressedContextBlock,
  shouldPrefetchRecoveryForPrompt,
  loadCapsuleContextEntries,
  loadRecoveredSpanEntries,
  buildCapsuleContextBlock,
  injectCompressedContextIntoMessages,
  buildModelResponseTransport,
  buildServerCodecRecovery,
  polishDecompressedAssistantText,
  looksLikeCodecProtocolRefusal,
};
```

- [ ] **Step 3: Remove the lines from `index.js` and add require + destructure**

Delete the block (from `compressLocalWorkspaceChunkFiles` through `looksLikeCodecProtocolRefusal`) and insert:

```js
const wc = require('./workspace-context');
const {
  compressLocalWorkspaceChunkFiles, openWorkspaceFileWithFallback,
  recoverWorkspaceWithFallback, searchWorkspaceWithFallback, grepWorkspaceWithFallback,
  renameWorkspaceFileWithFallback, deleteWorkspaceFileWithFallback,
  applyWorkspaceBatchWithFallback, openLocalWorkspaceWithFallback, runGitWithFallback,
  sanitizeTerminalChunk, makeAssistantTerminalEntry, getAssistantTerminalSession,
  createAssistantTerminalSession, listAssistantTerminalOutput, writeAssistantTerminalInput,
  destroyAssistantTerminalSession, createCompressedContextExcerpt, normalizeContextExcerptText,
  normalizeExcerptFocusTerms, collectFocusedCharRanges, mergeCharRanges,
  buildExcerptFromCharRanges, loadCompressedContextEntries, loadPlainContextEntries,
  buildPlainContextBlock, buildCompressedContextBlock, shouldPrefetchRecoveryForPrompt,
  loadCapsuleContextEntries, loadRecoveredSpanEntries, buildCapsuleContextBlock,
  injectCompressedContextIntoMessages, buildModelResponseTransport, buildServerCodecRecovery,
  polishDecompressedAssistantText, looksLikeCodecProtocolRefusal,
} = wc;
```

- [ ] **Step 4: Syntax check**

```bash
node --check src/core/workspace-context.js && echo "wc OK"
node --check src/core/index.js && echo "index OK"
wc -l src/core/index.js
```

Expected: both pass; index.js now ~2600 lines.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/core/workspace-context.js src/core/index.js
git commit -m "refactor(core): extract workspace context and terminal layer to workspace-context.js"
```

---

## Task 5: Extract `src/core/workspace-ops.js`

**Context:** The block from `localWorkspaceSelect` through `localAssistantReply` (~1427 lines) contains all local workspace I/O: select, open-local, CRUD, search, grep, git, ingest, query heuristics, and the local assistant reply wrapper.

**Files:**
- Create: `src/core/workspace-ops.js`
- Modify: `src/core/index.js`

- [ ] **Step 1: Identify current line range**

```bash
grep -n "^async function localWorkspaceSelect\|^async function localAssistantReply" src/core/index.js
```

Note start line (`localWorkspaceSelect`) and end line of `localAssistantReply` body.

- [ ] **Step 2: Create `src/core/workspace-ops.js`**

```js
'use strict';
/**
 * MESH — Workspace Operations (local I/O, search, git, query heuristics)
 * Extracted from src/core/index.js.
 * Uses globals: localAssistantWorkspace, workspaceMetadataStore, brotliCompress,
 *   brotliDecompress, appendOperationLog, toIsoNow, runModelChat,
 *   toSafePath, runLocalGit, readWorkspaceBlobText, writeWorkspaceBlobText,
 *   copyWorkspaceBlob, deleteWorkspaceBlob, meshTunnelRequest,
 *   openWorkspaceFileWithFallback, recoverWorkspaceWithFallback, loadCapsuleContextEntries,
 *   and all WORKSPACE_* / QUERY_* constants.
 */

const path = require('path');
const fs   = require('fs');
const {
  buildWorkspaceFileRecord, buildWorkspaceFileView, decodeRawStorage,
  ensureWorkspaceFileRecord, recoverWorkspaceFileRecord, serializeWorkspaceFileRecord,
  suggestRecoverySpanIds, LEGACY_WORKSPACE_ENCODING, TRANSPORT_CONTENT_ENCODING,
  TRANSPORT_ENVELOPE_VERSION, WORKSPACE_RECORD_VERSION,
} = require('../../mesh-core/src/compression-core.cjs');
const {
  pathHasExtensionHint: sharedPathHasExtensionHint,
  rankWorkspacePathsForQuery: sharedRankWorkspacePathsForQuery,
  scorePathForQuery: sharedScorePathForQuery,
  selectReferenceMatchLimit: sharedSelectReferenceMatchLimit,
  toSafePath: sharedSafePath,
} = require('../../assistant-core');

// --- paste functions localWorkspaceSelect through localAssistantReply ---

module.exports = {
  localWorkspaceSelect,
  localWorkspaceOpenLocal,
  localWorkspaceFiles,
  localWorkspaceFile,
  localWorkspaceSave,
  localWorkspaceCreate,
  buildWorkspaceQueryContext,
  localWorkspaceSearch,
  findMatchesInText,
  localWorkspaceGrep,
  localWorkspaceRename,
  localWorkspaceDelete,
  localWorkspaceBatch,
  localGitStatus,
  ingestWorkspaceChunkFromOffload,
  localResolveReferencedFiles,
  extractQueryExtensionHints,
  pathHasExtensionHint,
  selectReferenceMatchLimit,
  resolveAdaptiveCompressedContextBudget,
  extractSearchTokens,
  compactAlphaNumeric,
  scorePathForQuery,
  rankWorkspacePathsForQuery,
  inferReferencedFilesFromWorkspace,
  localAssistantReply,
  QUERY_EXTENSION_HINTS,
  SINGLE_FILE_LOOKUP_RE,
  MULTI_FILE_LOOKUP_RE,
  FILE_QUERY_STOP_WORDS,
  BROAD_CHANGE_INTENT_RE,
};
```

**Note:** If `QUERY_EXTENSION_HINTS`, `SINGLE_FILE_LOOKUP_RE`, `MULTI_FILE_LOOKUP_RE`, `FILE_QUERY_STOP_WORDS`, `BROAD_CHANGE_INTENT_RE` are constant declarations in this block (not functions), move them to the top of workspace-ops.js before the functions.

- [ ] **Step 3: Remove the block from `index.js` and add require + destructure**

Delete lines from `localWorkspaceSelect` through `localAssistantReply` (including any constant declarations that are part of this block) and insert:

```js
const wo = require('./workspace-ops');
const {
  localWorkspaceSelect, localWorkspaceOpenLocal, localWorkspaceFiles, localWorkspaceFile,
  localWorkspaceSave, localWorkspaceCreate, buildWorkspaceQueryContext, localWorkspaceSearch,
  findMatchesInText, localWorkspaceGrep, localWorkspaceRename, localWorkspaceDelete,
  localWorkspaceBatch, localGitStatus, ingestWorkspaceChunkFromOffload,
  localResolveReferencedFiles, extractQueryExtensionHints, pathHasExtensionHint,
  selectReferenceMatchLimit, resolveAdaptiveCompressedContextBudget, extractSearchTokens,
  compactAlphaNumeric, scorePathForQuery, rankWorkspacePathsForQuery,
  inferReferencedFilesFromWorkspace, localAssistantReply,
  QUERY_EXTENSION_HINTS, SINGLE_FILE_LOOKUP_RE, MULTI_FILE_LOOKUP_RE,
  FILE_QUERY_STOP_WORDS, BROAD_CHANGE_INTENT_RE,
} = wo;
```

- [ ] **Step 4: Syntax check**

```bash
node --check src/core/workspace-ops.js && echo "wo OK"
node --check src/core/index.js && echo "index OK"
wc -l src/core/index.js
```

Expected: both pass; index.js now ~1200 lines.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/core/workspace-ops.js src/core/index.js
git commit -m "refactor(core): extract workspace I/O and query operations to workspace-ops.js"
```

---

## Task 6: Extract `src/core/deployments.js`

**Context:** Lines from `normalizeDeploymentRisk` through `updatePolicy` (~190 lines) are self-contained deployment/policy management functions that only reference `operationsStore` and `appendOperationLog` from globals.

**Files:**
- Create: `src/core/deployments.js`
- Modify: `src/core/index.js`

- [ ] **Step 1: Identify current line range**

```bash
grep -n "^function normalizeDeploymentRisk\|^function updatePolicy" src/core/index.js
```

- [ ] **Step 2: Create `src/core/deployments.js`**

```js
'use strict';
/**
 * MESH — Deployment and Policy Management
 * Extracted from src/core/index.js.
 * Uses globals: operationsStore, appendOperationLog.
 */

// --- paste functions normalizeDeploymentRisk through updatePolicy ---

module.exports = {
  normalizeDeploymentRisk,
  normalizePolicyMode,
  normalizePolicyStatus,
  normalizePolicyRegion,
  parsePolicyScopeFromPayload,
  stringifyPolicyScope,
  uniqueDeploymentId,
  queueDeployment,
  settleDeploymentAction,
  uniquePolicyId,
  createPolicy,
  updatePolicy,
};
```

- [ ] **Step 3: Remove lines from `index.js` and add require + destructure**

Delete the deployment/policy block and insert:

```js
const dep = require('./deployments');
const {
  normalizeDeploymentRisk, normalizePolicyMode, normalizePolicyStatus, normalizePolicyRegion,
  parsePolicyScopeFromPayload, stringifyPolicyScope, uniqueDeploymentId, queueDeployment,
  settleDeploymentAction, uniquePolicyId, createPolicy, updatePolicy,
} = dep;
```

These names are already in `module.exports` of index.js — confirm they remain listed there (just now they come via destructuring).

- [ ] **Step 4: Syntax check and line count**

```bash
node --check src/core/deployments.js && echo "dep OK"
node --check src/core/index.js && echo "index OK"
wc -l src/core/index.js
```

Expected: index.js is now under 1100 lines.

- [ ] **Step 5: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 6: Confirm all src/core files are under 2000 lines**

```bash
wc -l src/core/*.js
```

Expected: all files under 2000 lines.

- [ ] **Step 7: Commit**

```bash
git add src/core/deployments.js src/core/index.js
git commit -m "refactor(core): extract deployment and policy management to deployments.js"
```

---

## Task 7: Split `mesh-core/src/server.js`

**Context:** `mesh-core/src/server.js` is 2798 lines (ESM). The `workspaceState` mutable object is referenced by ~60 functions. Moving it to a shared `mesh-state.js` module lets the bulk of the operations (~lines 884–2562) be extracted to `workspace-operations.js`. Routes and `app.listen` stay in `server.js`.

**Files:**
- Create: `mesh-core/src/mesh-state.js`
- Create: `mesh-core/src/workspace-operations.js`
- Modify: `mesh-core/src/server.js`

- [ ] **Step 1: Baseline**

```bash
node --check mesh-core/src/server.js
npm test 2>&1 | tail -5
```

- [ ] **Step 2: Create `mesh-core/src/mesh-state.js`**

The `workspaceState` object in `server.js` is a plain object with all-null initial values (lines ~67–83). Move it here:

```js
/**
 * MESH Worker — Shared workspace state.
 * Single source of truth for the in-memory workspace during worker operation.
 * Both server.js and workspace-operations.js import this object; mutations are shared
 * because Node ESM module instances are cached.
 */
export const workspaceState = {
  folderName: null,
  rootPath: null,
  workspaceId: null,
  sessionId: null,
  sourceKind: 'upload',
  files: new Map(),
  fileCountTotal: 0,
  fileCountCompleted: 0,
  fileCountFailed: 0,
  fileCountPending: 0,
  status: '',
  indexedAt: null,
};
```

- [ ] **Step 3: Update `server.js` — replace inline `workspaceState` definition with import**

Remove the `const workspaceState = { ... }` block and replace with:

```js
import { workspaceState } from './mesh-state.js';
```

- [ ] **Step 4: Create `mesh-core/src/workspace-operations.js`**

```js
/**
 * MESH Worker — Workspace operations (indexing, select, file I/O, search, git, chat).
 * Extracted from server.js. Imports workspaceState from mesh-state.js.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { pipeline } from 'stream/promises';
import zlib from 'zlib';
import { promisify } from 'util';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { BlobClient, BlockBlobClient } from '@azure/storage-blob';
import { workspaceState } from './mesh-state.js';
import compressionCore from './compression-core.cjs';

const require = createRequire(import.meta.url);
// Import any assistantCore/workspaceMetadataStore helpers needed by these functions

const {
  buildWorkspaceFileRecord, buildWorkspaceFileView, decodeRawStorage,
  ensureWorkspaceFileRecord, recoverWorkspaceFileRecord, serializeWorkspaceFileRecord,
  suggestRecoverySpanIds,
} = compressionCore;

// --- paste functions compressWorkspaceChunkFiles (line 884) through handleChat (line 2549) ---
// (and any helper functions in between: openLocalWorkspace, enqueueForIndexing,
//  runIndexerForWorkspace, selectWorkspaceFolder, listWorkspaceFiles, getWorkspaceGraph,
//  generateDependencyMapMarkdown, purgeWorkspace, provisionDependencyMap,
//  enqueueIntelligenceJob, drainIntelligenceQueue, provisionIntelligenceArtifacts,
//  buildIntelligenceArtifacts, openWorkspaceFile, recoverWorkspaceSpans, saveWorkspaceFile,
//  createWorkspaceFile, buildWorkspaceQueryContext, searchWorkspace, findMatchesInText,
//  grepWorkspace, renameWorkspaceFile, deleteWorkspaceFile, applyWorkspaceBatch,
//  gitStatusPayload, resolveReferencedFiles, mockAssistantReply, polishWorkerDisplayText,
//  handleChat)

export {
  compressWorkspaceChunkFiles,
  openLocalWorkspace,
  enqueueForIndexing,
  runIndexerForWorkspace,
  selectWorkspaceFolder,
  listWorkspaceFiles,
  getWorkspaceGraph,
  generateDependencyMapMarkdown,
  purgeWorkspace,
  provisionDependencyMap,
  enqueueIntelligenceJob,
  drainIntelligenceQueue,
  provisionIntelligenceArtifacts,
  buildIntelligenceArtifacts,
  openWorkspaceFile,
  recoverWorkspaceSpans,
  saveWorkspaceFile,
  createWorkspaceFile,
  buildWorkspaceQueryContext,
  searchWorkspace,
  findMatchesInText,
  grepWorkspace,
  renameWorkspaceFile,
  deleteWorkspaceFile,
  applyWorkspaceBatch,
  gitStatusPayload,
  resolveReferencedFiles,
  mockAssistantReply,
  polishWorkerDisplayText,
  handleChat,
};
```

**Important:** Carefully copy any constant declarations (`const SOME_LIMIT = ...`) that belong to the extracted functions and move them to `workspace-operations.js`. If constants are shared between server.js and operations, move them to `mesh-state.js` instead.

- [ ] **Step 5: Update `server.js` — import from workspace-operations.js**

Remove the extracted function bodies and replace with:

```js
import {
  compressWorkspaceChunkFiles, openLocalWorkspace, enqueueForIndexing,
  runIndexerForWorkspace, selectWorkspaceFolder, listWorkspaceFiles, getWorkspaceGraph,
  generateDependencyMapMarkdown, purgeWorkspace, provisionDependencyMap,
  enqueueIntelligenceJob, drainIntelligenceQueue, provisionIntelligenceArtifacts,
  buildIntelligenceArtifacts, openWorkspaceFile, recoverWorkspaceSpans, saveWorkspaceFile,
  createWorkspaceFile, buildWorkspaceQueryContext, searchWorkspace, findMatchesInText,
  grepWorkspace, renameWorkspaceFile, deleteWorkspaceFile, applyWorkspaceBatch,
  gitStatusPayload, resolveReferencedFiles, mockAssistantReply, polishWorkerDisplayText,
  handleChat,
} from './workspace-operations.js';
```

- [ ] **Step 6: Syntax check**

```bash
node --check mesh-core/src/mesh-state.js && echo "state OK"
node --check mesh-core/src/workspace-operations.js && echo "ops OK"
node --check mesh-core/src/server.js && echo "server OK"
wc -l mesh-core/src/server.js mesh-core/src/workspace-operations.js mesh-core/src/mesh-state.js
```

Expected: all pass; `server.js` under 2000 lines.

- [ ] **Step 7: Run tests**

```bash
npm test 2>&1 | tail -10
```

- [ ] **Step 8: Commit**

```bash
git add mesh-core/src/mesh-state.js mesh-core/src/workspace-operations.js mesh-core/src/server.js
git commit -m "refactor(mesh-core): extract workspace state + operations to dedicated modules"
```

---

## Task 8: Final Check — All Files Under 2000 Lines

- [ ] **Step 1: Check all source files**

```bash
find . -name "*.js" -o -name "*.cjs" | grep -v node_modules | grep -v ".playwright-cli" | grep -v "output/" | xargs wc -l 2>/dev/null | sort -rn | head -20
```

Expected: no file in the project source (excluding `node_modules`) exceeds 2000 lines.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all tests pass (same count as Task 1 baseline).

- [ ] **Step 3: Smoke-check server starts**

```bash
node --check src/server.js && node --check src/core/index.js && echo "smoke OK"
```

Expected: `smoke OK`

---

## Task 9: Update CODEBASE-MAP.md

- [ ] **Step 1: Update `src/core/` section**

Replace the existing `### Core modules` section with:

```markdown
### Core modules

- `src/core/index.js`
  Purpose: bootstrap orchestrator — imports, runtime constants, mutable workspace state objects, operations store, workspace state serialization, module.exports, and Object.assign(global). Requires and re-exports all five submodules below.
  Works with: `src/core/auth.js`, `src/core/model-providers.js`, `src/core/assistant-runs.js`, `src/core/workspace-infrastructure.js`, `src/core/workspace-context.js`, `src/core/workspace-ops.js`, `src/core/deployments.js`, `secure-db.js`, `mesh-core/src/compression-core.cjs`, `workspace-metadata-store.cjs`.

- `src/core/auth.js`
  Purpose: auth/session/cookie layer — password hashing, session lifecycle, `requireAuth` middleware, BYOK credential normalization, user-store key allowlist.
  Works with: `secure-db.js`, required and destructured by `src/core/index.js`.

- `src/core/model-providers.js`
  Purpose: AI provider call layer — static model registry, Anthropic/OpenAI/Gemini/BYOK call functions, Mesh model codec (encode/decode/inject), string utilities.
  Works with: `@anthropic-ai/sdk`, required and destructured by `src/core/index.js`.

- `src/core/assistant-runs.js`
  Purpose: assistant run orchestration — run record lifecycle, plan/proposal generation, batch execution, diff extraction, run continuation. Uses globals at call time.
  Works with: globals from `src/core/index.js` (set by `src/server.js`).

- `src/core/workspace-infrastructure.js`
  Purpose: workspace infrastructure — tunnel requests, path utilities, workspace-select queue, Azure blob I/O (read/write/copy/delete), local file scanning, blob URL builders, brotli compress/decompress helpers.
  Works with: `@azure/storage-blob`, `mesh-core/src/compression-core.cjs`, globals from `src/core/index.js`.

- `src/core/workspace-context.js`
  Purpose: workspace context layer — worker chunk compression, fallback wrappers (open/recover/search/grep/rename/delete/batch), terminal session management, context/capsule loading and building, response transport.
  Works with: `mesh-core/src/compression-core.cjs`, globals from `src/core/index.js`.

- `src/core/workspace-ops.js`
  Purpose: local workspace I/O — select, open-local, CRUD, search, grep, rename, delete, batch, git status, ingest, query heuristics, scoring/ranking, `localAssistantReply`.
  Works with: `mesh-core/src/compression-core.cjs`, `assistant-core.js`, globals from `src/core/index.js`.

- `src/core/deployments.js`
  Purpose: deployment lifecycle and policy management — queue, settle, create, update, normalize.
  Works with: globals `operationsStore` and `appendOperationLog` from `src/core/index.js`.
```

- [ ] **Step 2: Update `mesh-core/` section**

Add entries for `mesh-state.js` and `workspace-operations.js` alongside the existing `server.js` entry, and update the `server.js` entry:

```markdown
- `mesh-core/src/server.js`
  Purpose: worker Express server — imports, constants, utility functions (blob config, Azure URL builders, local file helpers), route handlers for `/mesh/tunnel` and `/api/chat/mesh`, `app.listen`.
  Works with: `mesh-core/src/mesh-state.js`, `mesh-core/src/workspace-operations.js`, `mesh-core/src/compression-core.cjs`, `assistant-core.js`.

- `mesh-core/src/mesh-state.js`
  Purpose: shared mutable workspace state object for the worker process.
  Works with: `mesh-core/src/server.js`, `mesh-core/src/workspace-operations.js`.

- `mesh-core/src/workspace-operations.js`
  Purpose: workspace indexing, select, file I/O, search, grep, git ops, chat handler — all functions called by route handlers in server.js.
  Works with: `mesh-core/src/mesh-state.js`, `mesh-core/src/compression-core.cjs`, `assistant-core.js`, `workspace-metadata-store.cjs`.

- `mesh-core/src/compression-core.cjs`
  Purpose: main compression/capsule pipeline — tree-sitter parsing, code/config/SQL/markup capsule builders, capsule materialization, workspace file record encoding.
  Works with: `mesh-core/src/compression-utils.cjs`, `mesh-core/src/tree-sitter-worker.cjs`.

- `mesh-core/src/compression-utils.cjs`
  Purpose: self-contained text and span utilities — hashing, token estimation, line analysis, span manager.
  Works with: `mesh-core/src/compression-core.cjs` (required by it).
```

- [ ] **Step 3: Add archive section note**

Update `## Intentionally Omitted Or Not Maintained Here` to mention archive/:

```markdown
- `archive/*` — raw source assets (Animationen, Logos); not part of runtime
```

- [ ] **Step 4: Verify CODEBASE-MAP accuracy**

```bash
# Confirm all new files exist
ls src/core/workspace-infrastructure.js src/core/workspace-context.js \
   src/core/workspace-ops.js src/core/deployments.js \
   mesh-core/src/mesh-state.js mesh-core/src/workspace-operations.js \
   mesh-core/src/compression-utils.cjs archive/ docs/archive/
```

Expected: all paths exist, no errors.

- [ ] **Step 5: Commit**

```bash
git add CODEBASE-MAP.md
git commit -m "docs: update CODEBASE-MAP.md to reflect all refactoring and archive moves"
```

---

## Self-Review

**Spec coverage:**
- ✅ No file over 2000 lines (Tasks 2–7 cover the 3 offenders; Task 8 verifies)
- ✅ All links/requires/imports still work (globals pattern + explicit requires cover all cross-references)
- ✅ Archive folders moved (Task 1: Animationen, Logos, CODEX-PHASE-2-3.md)
- ✅ CODEBASE-MAP.md updated (Task 9)

**Placeholder scan:** No TBD/TODO in code blocks above. Each step has exact commands or exact code.

**Type/name consistency:** Function names in destructuring blocks match exactly the function declarations being moved. The executor must verify these match what's actually in index.js (use `grep -n "^function \|^async function"` to confirm).

**Risk areas for executor:**
1. In Task 3, `workspace-infrastructure.js` references constants (`WORKSPACE_BROTLI_QUALITY`, `MESH_CORE_URL`, etc.) that live in index.js's module scope. These ARE already in `module.exports` of index.js (confirmed at lines 4444-4469), so they ARE in global — bare-name access works.
2. In Task 5, constants like `QUERY_EXTENSION_HINTS`, `SINGLE_FILE_LOOKUP_RE`, `MULTI_FILE_LOOKUP_RE`, `FILE_QUERY_STOP_WORDS`, `BROAD_CHANGE_INTENT_RE` may be `const` declarations (not functions) inside the extracted block. Move them to the top of `workspace-ops.js` before the function definitions and include them in `module.exports`.
3. In Task 7, carefully audit which constants in `server.js` are used by both server.js routes AND the extracted operations — those should go in `mesh-state.js` or be re-declared in both files (they read from `process.env` so re-declaring is safe).
