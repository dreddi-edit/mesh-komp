---
plan: 22-02
title: Core Module Unit Tests
status: complete
completed: 2026-04-16
---

## What Was Built

Created 5 dedicated test files covering pure/standalone-safe functions in 6 core modules:

### test/workspace-ops.test.js (expanded: 85 → 210 lines)
- `resolveAdaptiveCompressedContextBudget` — 7 tests covering all 4 modes + edge cases
- `extractQueryExtensionHints` — 5 tests
- `selectReferenceMatchLimit` — 4 tests
- `extractSearchTokens` — 5 tests + FILE_QUERY_STOP_WORDS validation
- `compactAlphaNumeric` — 3 tests
- `rankWorkspacePathsForQuery` — 2 tests (others use toSafePath/basename globals)
- `findMatchesInText` — 9 tests including CRLF, case sensitivity, multi-match
- Regex constants: BROAD_CHANGE_INTENT_RE, SINGLE_FILE_LOOKUP_RE, MULTI_FILE_LOOKUP_RE

### test/workspace-infrastructure.test.js (new: 230 lines)
- `toSafePath` — 7 tests covering traversal, backslash, empty input
- `basename` — 4 tests
- `ensureWorkspaceOwnedPath` — 5 tests
- `toWorkspacePath` — 3 tests
- `normalizeAbsoluteRootPath` — 2 tests
- `mapWithConcurrency` — 6 tests including order preservation
- `createWorkspacePerfTracker` — 2 tests (flush omitted: uses MESH_WORKSPACE_PERF_LOG global)
- `normalizeGitError` — 3 tests
- `normalizeWorkspaceBlobStorage` — 2 tests
- `createWorkspaceOffloadConfig` — 1 test
- `workspaceOffloadClientConfig` — 1 test
- `estimateWorkspaceSelectPayload` — 2 tests

### test/deployments.test.js (new: 160 lines)
All pure normalizer functions — no globals needed:
- `normalizeDeploymentRisk` — 4 tests
- `normalizePolicyMode` — 3 tests
- `normalizePolicyStatus` — 3 tests
- `normalizePolicyRegion` — 3 tests
- `parsePolicyScopeFromPayload` — 7 tests
- `stringifyPolicyScope` — 4 tests

### test/workspace-context.test.js (new: 200 lines)
- `sanitizeTerminalChunk` — 9 tests covering ANSI stripping, OSC, CRLF
- `normalizeContextExcerptText` — 5 tests
- `normalizeExcerptFocusTerms` — 4 tests (string-tokenize path omitted: uses extractSearchTokens global)
- `mergeCharRanges` — 7 tests
- `collectFocusedCharRanges` — 5 tests
- `buildExcerptFromCharRanges` — 5 tests

### test/assistant-runs.test.js (new: 185 lines)
- `cloneJsonValue` — 4 tests
- `extractExplicitCommandFromPrompt` — 4 tests
- `hasSearchIntent` — 2 tests
- `hasReadIntent` — 2 tests
- `hasOpsIntent` — 2 tests
- `normalizeDiffText` — 4 tests
- `computeProposalLineDelta` — 5 tests
- `extractFirstFencedCodeBlock` — 5 tests
- `extractDirectProposalContent` — 5 tests

### test/voice-agent.test.js (new: 120 lines)
- `DEFAULT_VOICE_AUTONOMY_MODE` — 1 test
- `voiceToolDefinitions` — 5 tests including schema shape validation
- `voiceChatToolDefinitions` — 3 tests
- `buildVoiceInstructions` — 7 tests

## Global Injection Note
Several exported functions (normalizeRunActionState, extractExplicitPathReferences,
hasEditIntent, ensureRunWorkspacePath, isWorkspaceIndexablePath, scorePathForQuery,
workspaceSelectScopeKey, snapshotWorkspaceSelectJob) reference globals populated by
core/index.js at server boot (toIsoNow, toSafePath, normalizeRunMode,
LOCAL_WORKSPACE_SKIP_DIRS, workspaceSelectJobOrder, etc). These cannot be unit-tested
standalone and are documented with comments in the test files.

## Self-Check: PASSED

- `npm test` — 23 failures (all pre-existing GSD framework tests, 0 regressions) ✓
- All 6 new test files exist ✓
- `test/workspace-ops.test.js` exceeds 200 lines ✓
