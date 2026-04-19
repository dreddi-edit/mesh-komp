---
plan: 21-02
title: High-Risk DOM Injection Remediation
status: complete
completed: 2026-04-16
commit: a334753
---

## What Was Built

Replaced all HIGH RISK user-content innerHTML injection with safe DOM APIs:

### app-workspace.js
- `toast()` — title/message now via `createElement + textContent` (was `esc()`)
- `addViewTab()` — tab label via textContent (was `esc()`)
- `renderTabs()` — tab path fragments via textContent (was `esc()`)
- breadcrumb in `switchTab()` — path parts via `createTextNode` (was `esc()`)
- `initSearch()` — file path hits via textContent (was `esc()`)

### features/content-search.js
- File path headers rewritten with DOM nodes + `createTextNode` for paths
- Match lines: line number via textContent, highlighted span via `DomUtils.safeHtml()`
- Error display via textContent
- Filename search results rewritten with DOM nodes

### features/problems-panel.js
- Entire render() rewritten with DOM APIs; severity class uses `['error','warning','info']` allowlist

### features/diff-editor.js + capsule-viewer.js
- Tab names for user-provided file paths replaced with textContent

### features/reindex-on-save.js
- File path fragment in indicator replaced with textContent

## Self-Check: PASSED

- All listed sites removed from `grep innerHTML` in high-risk category
- `npm test` — 25 failures (all pre-existing, no regressions)
