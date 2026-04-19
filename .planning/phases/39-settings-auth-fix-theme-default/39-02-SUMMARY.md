---
phase: "39"
plan: "39-02"
subsystem: settings
tags: [frontend, theme, settings.njk]
requires:
  - 39-01
provides:
  - settings.njk inline script defaults to 'system' theme
  - Theme select defaults to Follow system
affects:
  - views/settings.njk
tech-stack:
  added: []
  patterns:
    - Inline flash-prevention script with OS prefers-color-scheme fallback
key-files:
  created: []
  modified:
    - views/settings.njk
key-decisions:
  - catch block retains 'light' as absolute last fallback (DOM error branch) for resilience
  - No localStorage migration — only new users (no stored preference) affected
requirements-completed:
  - SETT-05
duration: "2 min"
completed: "2026-04-19"
---

# Phase 39 Plan 02: settings.njk Theme Default Summary

Changed flash-prevention inline script fallback from `'light'` to `'system'` and moved `selected` attribute from `<option value="light">` to `<option value="system">` in the theme select. New users with no saved preference now follow OS `prefers-color-scheme`.

**Duration:** ~2 min | **Completed:** 2026-04-19
**Tasks:** 2 | **Files:** 1 modified

## What Was Built

- **Inline script (line 23)** — `a.theme||'light'` → `a.theme||'system'`. When no preference is stored, the system theme resolves via `window.matchMedia('(prefers-color-scheme:dark)')` before the page paints.
- **Theme select (line 905)** — `<option value="light" selected>` → `<option value="system" selected>Follow system</option>`. First-time users see "Follow system" as the pre-selected default.

## Task Commits

- Tasks 39-02-01/02: `17d923a` — feat(39-02): change theme default from 'light' to 'system' in settings.njk

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

None.

## Self-Check: PASSED

- `grep "||'system'" views/settings.njk` → 1 match ✓
- `grep "||'light'" views/settings.njk` → 0 matches ✓
- `grep 'value="system" selected' views/settings.njk` → 1 match ✓
- `grep 'value="light" selected' views/settings.njk` → 0 matches ✓

## Human Verification

Checkpoint approved — browser tests confirmed: auth gate redirects, OS dark mode → dark theme, OS light mode → light theme, saved preference overrides OS.
