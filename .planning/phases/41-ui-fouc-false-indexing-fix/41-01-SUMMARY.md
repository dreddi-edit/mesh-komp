---
phase: 41-ui-fouc-false-indexing-fix
plan: "41-01"
subsystem: ui
tags: [nunjucks, theme, localStorage, FOUC, dark-mode]

requires: []
provides:
  - Inline theme script in app.njk head block that prevents flash of wrong theme
affects: [ui, settings, appearance]

tech-stack:
  added: []
  patterns: [inline IIFE in <head> for synchronous pre-CSS theme resolution]

key-files:
  created: []
  modified:
    - views/app.njk

key-decisions:
  - "Placed script as first child of {% block head %} so it executes before any CSS paints"
  - "Reads meshAppearance (primary) with meshSettings.theme fallback to cover both storage paths"

patterns-established:
  - "Synchronous pre-CSS theme resolution: inline IIFE reads localStorage, sets data-theme before first paint"

requirements-completed:
  - UIEL-07

duration: 5min
completed: 2026-04-19
---

# Plan 41-01: Add Inline Flash-Prevention Script to app.njk Summary

**Inline IIFE script in app.njk `{% block head %}` reads localStorage theme and sets `data-theme` synchronously before CSS paints, eliminating white flash on dark-theme page loads**

## Performance

- **Duration:** 5 min
- **Completed:** 2026-04-19
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Inserted synchronous IIFE as first element of `{% block head %}` in `views/app.njk`
- Script reads `meshAppearance.theme` (primary) and `meshSettings.theme` (fallback)
- Resolves `'system'` via `window.matchMedia('(prefers-color-scheme:dark)')`
- Sets `document.documentElement.dataset.theme` before any stylesheet can paint

## Task Commits

1. **Task 41-01-01: Add inline theme script** - `af35412` (feat)

## Files Created/Modified
- `views/app.njk` - Added 1-line inline script as first child of {% block head %}

## Decisions Made
- Reused the same IIFE pattern already present in `views/settings.njk` (reference implementation)
- Catches and suppresses parse errors so broken localStorage never blocks page load

## Deviations from Plan
None — plan executed exactly as written.

## Issues Encountered
None.

## Next Phase Readiness
FOUC eliminated on `/app` route. All other routes already had the script or don't load theme CSS.

---
*Phase: 41-ui-fouc-false-indexing-fix*
*Completed: 2026-04-19*
