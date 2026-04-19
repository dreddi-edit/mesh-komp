---
status: complete
plan: 28-01
title: "Fix workspace indexing stall at ~55%"
---

# Summary: 28-01 Fix Workspace Indexing Stall at ~55%

## What was built
- Modified `deepScanAll` to skip directories matching `INDEX_SKIP_DIRS` (node_modules, .git, dist, build, .next, __pycache__) during the indexing scan
- Added abort signal parameter to `deepScanAll` with 30-second timeout safety net in `openFolder()`
- File explorer transparency preserved — `fullScan` still scans all directories

## key-files
### created
(none)
### modified
- assets/app-workspace.js

## Deviations
None — implemented as planned.

## Self-Check: PASSED
- [x] INDEX_SKIP_DIRS check in deepScanAll
- [x] Recursive call guarded by !INDEX_SKIP_DIRS.test
- [x] fullScan NOT modified
- [x] Abort signal parameter added
- [x] 30-second timeout in openFolder
