# Phase 41: UI — FOUC & False Indexing Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 41-ui-fouc-false-indexing-fix
**Areas discussed:** FOUC fix scope and theme storage key, Indexing indicator fix behavior

---

## FOUC Fix Scope and Theme Storage Key

| Option | Description | Selected |
|--------|-------------|----------|
| meshAppearance | Same key as settings.njk — consistent across pages | ✓ |
| meshSettings (legacy) | Legacy local-only key used by applyTheme() | |

**User's choice:** `meshAppearance` (with `meshSettings.theme` as fallback for legacy users)

---

## FOUC Fallback Theme

| Option | Description | Selected |
|--------|-------------|----------|
| system (OS prefers-color-scheme) | Consistent with Phase 39 decision — all pages default to system | ✓ |
| dark (app default) | CSS already defaults dark — simpler but inconsistent with settings.njk | |

**User's choice:** `system` — match Phase 39

---

## Indexing Indicator False-Positive Scenario

| Option | Description | Selected |
|--------|-------------|----------|
| Fresh load with no folder | Bar shows on page load with no workspace open | |
| After indexing completes, doesn't hide | Bar stays after indexing finishes | |
| Both / not sure exactly | Fix both scenarios | ✓ |

**User's choice:** Both — fix covers fresh-load and stuck-after-completion

---

## Indexing Indicator Fix Approach

| Option | Description | Selected |
|--------|-------------|----------|
| JS — call updateIndexProgressState('idle') on DOMContentLoaded | Explicit idle state at init | ✓ |
| HTML — trust display:none attribute | Trust existing HTML | |

**User's choice:** JS explicit idle call in init()

---

## Claude's Discretion

- Exact placement of inline script in app.njk (inside `{% block head %}` since base.njk owns `<head>`)
- Whether the existing `!S.dirHandle` guard in `updateIndexProgressState` needs strengthening or just the DOMContentLoaded idle call is sufficient

## Deferred Ideas

- Settings sub-pages `||'light'` → `||'system'` update — out of scope for Phase 41
- index.njk marketing page FOUC — not applicable to the `data-theme` system
