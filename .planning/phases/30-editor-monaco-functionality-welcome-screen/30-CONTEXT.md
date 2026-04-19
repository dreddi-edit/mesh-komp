# Phase 30: Editor — Monaco Functionality & Welcome Screen - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Three distinct fixes: (1) restore Monaco editor reliability — syntax highlighting, language detection, proper rendering; (2) replace the hardcoded welcome screen workspace list with real recent workspaces that survive browser cache clears; (3) fix the "Indexing..." status bar indicator that shows on startup when no folder is open and glitches during actual indexing.

</domain>

<decisions>
## Implementation Decisions

### EDIT-01: Monaco Editor Rendering

- **D-01:** Root cause is a timing race condition — `initMonaco()` in `assets/app-workspace.js:2143` calls `require.config(...)` but `loader.js` is loaded with `defer` in `app.njk:521`, so `require` may not yet be defined when `init()` fires at DOMContentLoaded. When undefined, `initMonaco()` returns early silently, `S.monacoReady` stays `false`, and `createEditor()` becomes a no-op forever.
- **D-02:** Fix approach: add `onload="window.__monacoLoaderReady=true"` to the loader `<script>` tag, then poll in `initMonaco()` until `window.__monacoLoaderReady` is set before calling `require.config(...)`. This is the most targeted fix with no side effects.
- **D-03:** The symptom is inconsistent — sometimes blank editor, sometimes renders but no syntax colors. Both symptoms share the same root: monacoReady never becomes true prevents `createEditor()` from running; if it does run before Monaco modules fully load, the editor renders in plaintext mode because the language workers haven't initialized.
- **D-04:** Monaco language detection via `langOf()` at `assets/app-workspace.js:81` is correct — 30+ extensions mapped. No changes needed to language detection logic.
- **D-05:** Monaco config in `createEditor()` at `assets/app-workspace.js:1136` is correct — `theme`, `fontFamily`, `minimap`, `wordWrap`, `bracketPairColorization` all properly set. No changes to editor options needed.
- **D-06:** `MonacoEnvironment.getWorkerUrl` at `app.njk:508` returns CDN worker URLs — this is correct. Keep as-is.

### EDIT-02: Welcome Screen Recent Workspaces

- **D-07:** The `.ws-item` list in `app.njk:258-262` is currently hardcoded HTML. Replace with dynamically rendered items from the stored recent workspaces list.
- **D-08:** Storage strategy — dual storage:
  - **IndexedDB (idb-keyval)**: Store up to 3 `FileSystemDirectoryHandle` objects keyed as `recent-folder-0`, `recent-folder-1`, `recent-folder-2` (most-recent-first). Used to re-open without re-picker via `requestPermission('readwrite')`.
  - **Server-side (DynamoDB/SQLite via secure-db.js)**: Store `[{name, path, timestamp}]` per authenticated user. Endpoint: `POST /api/v1/workspaces/recent`. Used to populate the welcome screen even after cache clear when IndexedDB handles are gone.
- **D-09:** Show 3 most recent workspaces maximum.
- **D-10:** Update both stores whenever `openFolder()` succeeds (currently only `idbKeyval.set('last-folder', h)` at line 687 is called — extend this to also push to the recent list and call the server API).
- **D-11:** Welcome screen click behavior: clicking a recent workspace item calls `requestPermission('readwrite')` on the stored IndexedDB handle. If permission is granted, loads the folder automatically (same flow as existing `restoreFolder()` at line 898). If handle is missing (cache cleared), falls back to `showDirectoryPicker()` with a toast explaining why re-selection is needed.
- **D-12:** `idbKeyval.get('last-folder')` at `app.njk:522` (idb-keyval CDN already loaded) — extend the existing idb-keyval integration, do not add new libraries.
- **D-13:** The existing `#wRestore` "Restore Previous Workspace" button should remain for backwards compatibility but becomes secondary — the recent workspaces list replaces its main purpose.

### EDIT-03: Indexing Indicator

- **D-14:** Bug 1 (shows on startup): In `restoreFolder()` at `assets/app-workspace.js:898`, when `interactive: false` and `queryPermission` is not 'granted', the function returns `false` but does NOT call `updateIndexProgressState('idle')`. Fix: add `updateIndexProgressState('idle')` to all early-return paths in `restoreFolder()` before returning `false`.
- **D-15:** Bug 2 (glitches during real indexing): Add `transition: width 0.3s ease` to `#idxProgFill` in `assets/app-workspace.css`. This smooths all rapid `fill.style.width` changes from the progress state updates.
- **D-16:** The `#idxProgWrap` default `display:none` in `app.njk:484` is correct — do not change the HTML default. The fix is purely in the JS early-return paths and CSS transition.
- **D-17:** No changes to the `updateIndexProgressState()` function logic itself — only ensure every code path that can interrupt indexing before completion calls `updateIndexProgressState('idle')`.

### Claude's Discretion
- Server API schema for recent workspaces endpoint (field names, response envelope)
- Exact idb-keyval key naming for multiple recent handles
- CSS transition duration (0.2s–0.4s acceptable range)
- Order of polling checks in the Monaco loader race fix
- How `restoreFolder()` is refactored to expose the recent-workspaces flow as a shared utility

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Monaco Editor
- `assets/app-workspace.js` lines 1131–1143 — `initMonaco()`, `createEditor()` — current implementation with the race condition
- `assets/app-workspace.js` line 2143 — `init()` — where `initMonaco(cb)` is called at DOMContentLoaded
- `views/app.njk` lines 507–521 — `MonacoEnvironment.getWorkerUrl` config + `<script defer>` loader tag

### Welcome Screen
- `views/app.njk` lines 235–268 — `#welcomeScr` DOM: `.ws-item` hardcoded list, `#wOpen`, `#wRestore` buttons
- `assets/app-workspace.js` lines 650–690 — `openFolder()` — where handles are saved to idb-keyval; extend this to update recent list
- `assets/app-workspace.js` lines 898–940 — `restoreFolder()` — pattern for permission request + folder loading; recent workspace click reuses this logic
- `assets/app-workspace.js` lines 2162–2168 — Startup idb-keyval check that shows `#wRestore`
- `views/app.njk` line 522 — idb-keyval CDN script tag (already loaded)

### Indexing Indicator
- `views/app.njk` lines 484–487 — `#idxProgWrap`, `#idxProgFill`, `#idxProgText` DOM
- `assets/app-workspace.js` lines 106–131 — `updateIndexProgressState()` function
- `assets/app-workspace.js` lines 898–940 — `restoreFolder()` — early return paths that need `updateIndexProgressState('idle')`
- `assets/app-workspace.css` — `#idxProgFill` selector (needs `transition: width 0.3s ease`)

### Auth / User Storage (for server-side recent workspaces)
- `secure-db.js` — DynamoDB + SQLite dual-backend; recent workspace records stored here per user
- `src/routes/auth.routes.js` — User store CRUD pattern to model the new recent-workspaces endpoint after

### Requirements
- `.planning/REQUIREMENTS.md` — EDIT-01, EDIT-02, EDIT-03

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `restoreFolder()` at `assets/app-workspace.js:898` — already implements the full permission-request + folder-load flow. The recent workspace click handler reuses this function with the appropriate IndexedDB key.
- `idbKeyval` (CDN, globally available) — already used for `last-folder` handle storage. Extend to store `recent-folder-0/1/2`.
- `openFolder()` at `assets/app-workspace.js:650` — already calls `idbKeyval.set('last-folder', h)` after success. Add recent list update here.
- `updateIndexProgressState()` at `assets/app-workspace.js:106` — already handles all states. No logic changes needed — just add `'idle'` calls to early exits.
- `$.ws-item` items in `#welcomeScr` — already have click handlers registered via `$$('.ws-item').forEach(el => el.addEventListener('click', openFolder))` at line 2083. Replace the static items with dynamically rendered ones that each carry their idb-keyval key.

### Established Patterns
- idb-keyval key-value pattern: `await idbKeyval.get(key)` / `await idbKeyval.set(key, value)` — use same pattern for recent handles
- `secure-db.js` user store CRUD: model recent workspaces endpoint after existing user-store pattern in `src/routes/auth.routes.js`
- `loadS()` / `save()` pattern for localStorage settings — keep as-is, recent workspaces use idb-keyval + server, not localStorage

### Integration Points
- `assets/app-workspace.js:openFolder()` — add recent workspace update here (idb-keyval + server API call)
- `assets/app-workspace.js:init()` — add recent workspace list fetch from server on startup to populate `#welcomeScr`
- `views/app.njk:#welcomeScr` — replace hardcoded `.ws-item` with dynamically rendered items
- `src/routes/auth.routes.js` or a new `src/routes/workspace.routes.js` — add `POST /api/v1/workspaces/recent` and `GET /api/v1/workspaces/recent`
- `src/server.js` — mount the new route if added as a separate router file

</code_context>

<specifics>
## Specific Ideas

- The Monaco loader race fix should use the `onload` attribute on the `<script>` tag: `<script src="...loader.js" defer onload="window.__monacoLoaderReady=true">`. Then `initMonaco()` uses a polling interval (`setInterval` with 50ms check, 5s timeout) to wait for this flag before calling `require.config(...)`.
- Recent workspaces should show folder name (large) and path abbreviation (small, like `~/Projects/mesh-komp`) matching the existing `.ws-name` + `.ws-path` class structure already in the HTML.
- The server API for recent workspaces should follow the existing response envelope: `{ data: [{ name, path, timestamp }], error: null }`.
- The `restoreFolder` early-return fix: add `updateIndexProgressState('idle')` immediately before each `return false` inside `restoreFolder()` — there are two such paths (permission denied, handle missing).

</specifics>

<deferred>
## Deferred Ideas

- Monaco IntelliSense / LSP integration — language server protocol support is a separate phase
- Multiple simultaneous folder tabs (multi-root workspace) — out of scope
- Welcome screen "New File" shortcut — belongs in a future editor UX phase
- Monaco extension/plugin API surface — future phase
- Workspace sync across devices (beyond recent list) — future phase

</deferred>

---

*Phase: 30-editor-monaco-functionality-welcome-screen*
*Context gathered: 2026-04-17*
