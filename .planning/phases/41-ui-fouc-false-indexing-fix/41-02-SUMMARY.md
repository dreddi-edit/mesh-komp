---
phase: 41-ui-fouc-false-indexing-fix
plan: "41-02"
subsystem: ui
tags: [javascript, indexing, status-bar, init, workspace]

requires: []
provides:
  - updateIndexProgressState('idle') call at init() start resets indicator to hidden on every page load
affects: [ui, workspace, status-bar]

tech-stack:
  added: []
  patterns: [defensive initialization — reset state to known baseline at earliest possible moment]

key-files:
  created: []
  modified:
    - assets/app-workspace.js

key-decisions:
  - "Called as absolute first statement in init() before bind()/loadS() to guarantee pre-event-loop reset"

patterns-established:
  - "Defensive initialization: reset ephemeral UI state to idle/hidden at top of init() before any async work begins"

requirements-completed:
  - UIEL-08

duration: 5min
completed: 2026-04-19
---

# Plan 41-02: Explicit Idle State for Indexing Indicator on Init Summary

**`updateIndexProgressState('idle')` as first statement in `init()` guarantees indexing indicator is hidden on every page load, eliminating false-positive "Indexing..." display**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-04-19
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added `updateIndexProgressState('idle')` as absolute first statement in `init()` at line 2324
- Covers both fresh-load-with-no-folder and stuck-after-completion scenarios
- No changes to `updateIndexProgressState` function itself or any other init logic

## Task Commits

1. **Task 41-02-01: Add idle reset at init() start** - `d6b347b` (fix)

## Files Created/Modified
- `assets/app-workspace.js` - Added 1 line at start of `init()` function

## Decisions Made
- Placed before `bind();loadS();renderChat()` so it fires before any event binding or state restoration can race it
- Syntax verified with `node --check` — no side effects

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
Indexing indicator false-positive eliminated. Status bar now correctly shows idle on all fresh loads.

---
*Phase: 41-ui-fouc-false-indexing-fix*
*Completed: 2026-04-19*
