---
plan: 36-01
phase: 36-editor-monaco-kompletter-neueinbau
status: complete
completed: 2026-04-18
commit: 4486426
---

# Plan 36-01 Summary: npm install + Express static route

## What was built

Added `monaco-editor: 0.52.2` to `package.json` dependencies and mounted an Express static route at `/assets/monaco/` serving `node_modules/monaco-editor/min/`.

## Key files

- `package.json` — added `"monaco-editor": "0.52.2"` in alphabetical order in dependencies
- `package-lock.json` — updated by `npm install`
- `src/server.js:247` — new route: `app.use('/assets/monaco', express.static(path.join(REPO_ROOT, 'node_modules', 'monaco-editor', 'min'), STATIC_CACHE))`

## Decisions made

- Used `STATIC_CACHE` (1-day, `max-age=86400`) not `IMMUTABLE_CACHE` — Monaco version may change between deploys
- Route added immediately after animejs route (line 246) following established pattern

## Verification

- All required files confirmed present: `vs/loader.js`, `vs/editor/editor.main.js`, `vs/editor/editor.main.css`, `vs/language/json/jsonWorker.js`, `vs/language/typescript/tsWorker.js`
- Express route grep: `app.use('/assets/monaco', express.static(...)` found at line 247

## Issues

None.
