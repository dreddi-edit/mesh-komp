---
phase: 19
plan: "04"
title: "LRU Cache Replacements"
status: complete
started: 2026-04-16T21:55:00Z
completed: 2026-04-16T22:05:00Z
---

# Summary: 19-04 LRU Cache Replacements

## What was built
Replaced all 6 unbounded `new Map()` stores with `lru-cache` instances. Each cache has configurable max size via config module. Removed 3 manual prune functions that are now handled by LRU eviction.

## Key files
- `src/config/index.js` — added 6 LRU cache size config values
- `src/middleware/rate-limiter.js` — rate limiter store → LRU (5K max, TTL-based)
- `src/core/index.js` — workspace files, assistant runs, terminal sessions, select jobs/chains → LRU
- `src/core/auth.js` — session cache + credential cache → LRU with TTL
- `src/core/model-providers.js` — codec session state → LRU, removed pruneCodecSessionStateIfNeeded
- `src/core/workspace-ops.js` — infer files cache → LRU with 30s TTL, removed pruneInferFilesCache

## Decisions
- Used LRUCache's built-in TTL for session/credential/rate-limit caches
- Kept manual `ts` field on auth cache entries as defense-in-depth
- Left temporary local Maps (restoreLocalWorkspaceState, workspace enrichment) as plain Maps — not caches
- Removed 3 manual prune functions (42 lines total)

## Self-Check: PASSED
- No `new Map()` remaining in rate-limiter.js
- All caches bounded with configurable max sizes
- npm test: 129 pass, 0 fail
