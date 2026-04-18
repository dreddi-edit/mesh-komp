# Phase 36: Editor — Monaco Kompletter Neueinbau - Context

**Gathered:** 2026-04-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Monaco Editor vollständig neu integrieren: self-hosted aus node_modules statt CDN, AMD loader synchron ohne defer, Worker via data: URL Pattern. Kein Polling, keine Race Conditions. Nur Monaco anfassen — xterm.js, d3, marked, dompurify bleiben CDN.

</domain>

<decisions>
## Implementation Decisions

### Editor Technology
- **D-01:** Monaco Editor bleibt — kein Wechsel zu CodeMirror. VS Code Look & Feel ist Kern des IDE-Produkts.

### Hosting
- **D-02:** `monaco-editor` per `npm install` zu `package.json` hinzufügen.
- **D-03:** Express Static Route mounten: `app.use('/assets/monaco', express.static(path.join(REPO_ROOT, 'node_modules/monaco-editor/min'), STATIC_CACHE))` — gleicher Pattern wie animejs bereits in `src/server.js:246`.
- **D-04:** In `app.njk` den CDN-Script-Tag `<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min/vs/loader.js" defer>` ersetzen durch `<script src="/assets/monaco/vs/loader.js">` — **kein `defer`**, synchron laden.

### Loader / Init
- **D-05:** `initMonaco()` in `assets/app-workspace.js` komplett ersetzen. Kein Polling (`setInterval`) mehr. Da `loader.js` synchron geladen ist, ist `require` sofort verfügbar. Direkt aufrufen:
  ```js
  function initMonaco(cb) {
    require.config({ paths: { vs: '/assets/monaco/vs' } });
    require(['vs/editor/editor.main'], () => { S.monacoReady = true; cb(); });
  }
  ```

### Workers
- **D-06:** `MonacoEnvironment.getWorkerUrl` in `app.njk` auf `data:` URL Pattern umstellen (CSP-safe, kein Blob):
  ```js
  window.MonacoEnvironment = {
    getWorkerUrl: function(_moduleId, label) {
      var base = '/assets/monaco/vs';
      var workerPath = '/editor/editor.worker.js';
      if (label === 'json') workerPath = '/language/json/jsonWorker.js';
      else if (label === 'css' || label === 'scss' || label === 'less') workerPath = '/language/css/cssWorker.js';
      else if (label === 'html' || label === 'handlebars' || label === 'razor') workerPath = '/language/html/htmlWorker.js';
      else if (label === 'typescript' || label === 'javascript') workerPath = '/language/typescript/tsWorker.js';
      return 'data:text/javascript;charset=utf-8,' + encodeURIComponent('importScripts("' + base + workerPath + '");');
    }
  };
  ```

### Scope
- **D-07:** Nur Monaco wird geändert. xterm.js, marked, dompurify, d3, idb-keyval bleiben CDN — die funktionieren bereits.
- **D-08:** `createEditor()` Funktion und alle Monaco-API-Aufrufe (`monaco.editor.create`, `monaco.editor.createModel`, etc.) bleiben unverändert — nur Loader und Worker-Config ändern sich.

### Claude's Discretion
- Cache-Headers für `/assets/monaco/` Route (STATIC_CACHE bereits definiert in server.js)
- Monaco-Version (aktuell 0.52.2 im CDN — gleiche Version per npm installieren für Konsistenz)
- Reihenfolge der Script-Tags in app.njk optimieren falls nötig

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Server — Static Asset Routing Pattern
- `src/server.js` lines 243-246 — Express static routes für `/assets/`, `/node_modules/animejs`. Monaco-Route folgt exakt demselben Pattern.

### Monaco Integration — Current Broken State
- `views/app.njk` lines 504-517 — MonacoEnvironment config + CDN loader script (wird ersetzt)
- `assets/app-workspace.js` lines 1138-1161 — `initMonaco()` polling + `createEditor()` (initMonaco wird ersetzt, createEditor bleibt)

### Requirements
- `.planning/REQUIREMENTS.md` — EDIT-04, EDIT-05, EDIT-06, EDIT-07

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server.js:246`: `app.use('/node_modules/animejs', express.static(...))` — exakt dieser Pattern für Monaco wiederholen
- `STATIC_CACHE` Konstante bereits in server.js definiert — für Monaco-Route nutzen

### Established Patterns
- Alle Static Assets werden via `express.static` aus dem Repo-Root serviert
- Asset-Hash-Map in `buildAssetHashMap()` läuft nur über `assets/` — Monaco unter `/assets/monaco/` wird automatisch erfasst

### Integration Points
- `views/app.njk`: Script-Tag für loader.js (synchron, neue URL)
- `views/app.njk`: MonacoEnvironment Block (data: URL Worker-Config)
- `assets/app-workspace.js`: `initMonaco()` Funktion (komplett ersetzen)
- `src/server.js`: Neue static route hinzufügen

</code_context>

<specifics>
## Specific Ideas

- Monaco Version 0.52.2 per npm installieren (gleiche Version wie bisheriger CDN-Tag — keine API-Breaks)
- `package.json` erhält `"monaco-editor": "0.52.2"` als reguläre dependency (nicht devDependency — wird zur Laufzeit serviert)

</specifics>

<deferred>
## Deferred Ideas

- xterm.js, marked, dompurify, d3, idb-keyval self-hosten — explizit out of scope für diese Phase
- Monaco Language Server Protocol (LSP) für IntelliSense — eigene Phase
- Monaco Diff-Editor für Git-Diffs — eigene Phase

</deferred>

---

*Phase: 36-editor-monaco-kompletter-neueinbau*
*Context gathered: 2026-04-18*
