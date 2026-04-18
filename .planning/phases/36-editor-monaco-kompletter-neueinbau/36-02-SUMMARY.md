---
plan: 36-02
phase: 36-editor-monaco-kompletter-neueinbau
status: complete
completed: 2026-04-18
commit: 52b33c5
---

# Plan 36-02 Summary: Frontend — synchronous loader + data: URL workers + polling-free initMonaco

## What was built

Replaced the CDN Monaco integration with a fully self-hosted, polling-free, CSP-safe implementation across two files.

## Key files

- `views/app.njk:29` — added `<link rel="stylesheet" href="/assets/monaco/vs/editor/editor.main.css">` (required: AMD build does not auto-inject CSS)
- `views/app.njk:504-516` — replaced MonacoEnvironment: CDN base → `/assets/monaco/vs`, Blob workers → `data:text/javascript;charset=utf-8,` + `encodeURIComponent('importScripts(...)')`, default worker fallback `/editor/editor.worker.js` (does not exist) → `/language/typescript/tsWorker.js`
- `views/app.njk:516` — replaced `<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js" defer>` with `<script src="/assets/monaco/vs/loader.js">` (synchronous — no `defer`)
- `assets/app-workspace.js:1138` — replaced 15-line polling `initMonaco()` with 2-line direct call: `require.config({ paths: { vs: '/assets/monaco/vs' } })` + `require(['vs/editor/editor.main'], ...)`

## Decisions made

- Default worker fallback is `/language/typescript/tsWorker.js` — the min build has no `editor.worker.js`
- `data:` URL pattern (not Blob) — CSP-safe: no `blob:` origin needed in Content-Security-Policy
- Loader loaded synchronously (no `defer`) — guarantees `require` is defined before any `defer` script (including app-workspace.js) executes
- `createEditor()` left completely unchanged — only loader/init touched (per CONTEXT.md D-08)

## Verification

All 8 acceptance criteria passed:
- No `cdn.jsdelivr.net/npm/monaco-editor` in app.njk ✓
- `src="/assets/monaco/vs/loader.js"` present without `defer` ✓
- `data:text/javascript` worker pattern present ✓
- Monaco CSS link present ✓
- No `URL.createObjectURL` or `new Blob` ✓
- `initMonaco()` has no `setInterval` or polling ✓
- `require.config` points to `/assets/monaco/vs` ✓

## Issues

None.
