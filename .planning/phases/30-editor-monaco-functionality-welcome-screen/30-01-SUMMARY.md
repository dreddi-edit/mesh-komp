## PLAN COMPLETE

**Plan:** 30-01 — EDIT-03: Fix False Indexing Indicator
**Status:** Complete
**Commit:** b8815e8

## What Was Built

Added a one-line guard `if (state !== 'idle' && !S.dirHandle) return;` as the first statement inside `updateIndexProgressState()` in `assets/app-workspace.js`. This prevents the indexing progress bar from appearing in the status bar when no folder is open.

## Key Files

- `assets/app-workspace.js` — `updateIndexProgressState` at line 106

## Self-Check: PASSED

- Guard present at correct location: ✓
- `S.dirHandle` guard allows idle state to always pass: ✓
- Legitimate indexing still works (S.dirHandle set before scan calls): ✓
