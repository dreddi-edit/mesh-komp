# Phase 36: Monaco Neueinbau — Research

## Summary
Monaco 0.52.2 ist bereits via `npm install --no-save` lokal verfügbar. Dateistruktur und Worker-Pfade verifiziert.

## Verified File Structure (node_modules/monaco-editor/min/vs/)

```
vs/
├── loader.js                          ← AMD Loader (synchron laden, kein defer)
├── editor/
│   ├── editor.main.js                 ← Haupteditor (via require(['vs/editor/editor.main']))
│   └── editor.main.css                ← Editor CSS
├── language/
│   ├── json/jsonWorker.js             ← JSON Worker
│   ├── css/cssWorker.js               ← CSS/SCSS/Less Worker
│   ├── html/htmlWorker.js             ← HTML/Handlebars Worker
│   └── typescript/tsWorker.js         ← TypeScript/JavaScript Worker
└── base/, basic-languages/            ← Sprachunterstützung
```

## Correct Worker Paths for data: URL Pattern

```javascript
window.MonacoEnvironment = {
  getWorkerUrl: function(_moduleId, label) {
    var base = '/assets/monaco/vs';
    var workerPath = '/editor/editor.main.js'; // fallback: editor.main nicht editor.worker!
    if (label === 'json') workerPath = '/language/json/jsonWorker.js';
    else if (label === 'css' || label === 'scss' || label === 'less') workerPath = '/language/css/cssWorker.js';
    else if (label === 'html' || label === 'handlebars' || label === 'razor') workerPath = '/language/html/htmlWorker.js';
    else if (label === 'typescript' || label === 'javascript') workerPath = '/language/typescript/tsWorker.js';
    return 'data:text/javascript;charset=utf-8,' + encodeURIComponent('importScripts("' + base + workerPath + '");');
  }
};
```

**CORRECTION from CONTEXT.md:** Default worker path is NOT `/editor/editor.worker.js` — that file doesn't exist in the min build. The correct fallback for the min/AMD build is to use the editor.main.js or simply omit unsupported languages. Only the 4 worker files above exist.

## Express Static Route

```javascript
// In src/server.js — same pattern as animejs (line 246)
app.use('/assets/monaco', express.static(path.join(REPO_ROOT, 'node_modules', 'monaco-editor', 'min'), STATIC_CACHE));
```

This serves `node_modules/monaco-editor/min/` at `/assets/monaco/`. So:
- `/assets/monaco/vs/loader.js` → `node_modules/monaco-editor/min/vs/loader.js`
- `/assets/monaco/vs/editor/editor.main.js` → worker path correct

## Loading Pattern (no polling needed)

```html
<!-- app.njk: BEFORE app-workspace.js, synchronous (no defer) -->
<script src="/assets/monaco/vs/loader.js"></script>
```

```javascript
// app-workspace.js: initMonaco() — no polling, require is immediately available
function initMonaco(cb) {
  require.config({ paths: { vs: '/assets/monaco/vs' } });
  require(['vs/editor/editor.main'], function() {
    S.monacoReady = true;
    cb();
  });
}
```

**Key:** `loader.js` is loaded synchronously → `require` is defined when `initMonaco()` runs. No setInterval needed.

## Monaco CSS

`editor.main.css` must also be served. Add to app.njk:
```html
<link rel="stylesheet" href="/assets/monaco/vs/editor/editor.main.css">
```
The current app.njk has no Monaco CSS link — it was loading styles via CDN JS bundle. Self-hosted needs explicit CSS link.

## package.json Change

```json
"monaco-editor": "0.52.2"
```
Add to `dependencies` (not devDependencies) — served at runtime.

## Validation Architecture

**Test approach:** After implementation, verify in browser DevTools:
1. Network tab — no `cdn.jsdelivr.net/npm/monaco-editor` requests
2. Console — no worker errors, no `require is not defined` errors
3. Editor opens a JS file → syntax highlighting works
4. Editor opens a JSON file → JSON worker loads (no spinner)
