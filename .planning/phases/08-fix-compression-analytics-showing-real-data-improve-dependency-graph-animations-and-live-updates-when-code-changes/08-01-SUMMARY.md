---
plan: "08-01"
title: "Fix compression analytics data pipeline"
status: complete
completed: 2026-04-15
---

# Summary: Plan 08-01

## What Was Built

Three targeted insertions into `assets/app-workspace.js` to ensure `S.compressionMap`
is populated with real server-side compression data in all folder-open scenarios.

## Changes Made

### key-files.created: []

### key-files.modified:
- assets/app-workspace.js — 3 changes

### Task Results

| Task | Status | Notes |
|------|--------|-------|
| 08-01-01 | ✓ | Added `mesh-indexing-initial-ready` handler after `mesh-indexing-complete` listener |
| 08-01-02 | ✓ | Added `loadCompressionMap()` call in `openFolder` deepScanAll callback after background index |
| 08-01-03 | ✓ | Added `loadCompressionMap()` call in `restoreFolder` deepScanAll callback after background index |

## Decisions

- Placed the `mesh-indexing-initial-ready` handler immediately after `mesh-indexing-complete`
  for symmetry and discoverability
- `loadCompressionMap` is idempotent (only overwrites entries where `incomingRaw > existing.rawBytes`),
  so calling it from both the event handler AND the explicit callback in openFolder/restoreFolder
  is safe — no double-counting risk

## Self-Check: PASSED
