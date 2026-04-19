# Phase 39: Settings — Auth-Fix & Theme-Default — Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Two targeted bug fixes to the settings page:
1. **SETT-04** — `/settings` must require authentication server-side; unauthenticated users redirect to `/app?login=1` before the page loads.
2. **SETT-05** — First-load theme default changes from `'light'` to `'system'` (follows OS `prefers-color-scheme`). No migration for existing localStorage users.

No new capabilities. No changes to settings form logic, section routing, or the user store API.

</domain>

<decisions>
## Implementation Decisions

### SETT-04: Auth Gate

- **D-01:** Add `requireAuth` middleware to the `/settings` route on the **server side** (in `app.routes.js` or `server.js` view route handler).
- **D-02:** On auth failure, redirect to `/app?login=1` — consistent with the logout flow already in the codebase (`assets/settings.js:769`).
- **D-03:** The `showSettingsAuthWarning()` banner in `assets/settings.js` is no longer needed once the server-side gate is in place. Remove it and its call site to avoid dead code.
- **D-04:** The `/settings` URL is served via `VIEW_ROUTE_MAP` in `server.js` — the gate must be added there (the map does not currently apply `requireAuth`).

### SETT-05: Theme Default

- **D-05:** Change the fallback in the inline `<script>` in `views/settings.njk:23` from `'light'` to `'system'`.
- **D-06:** Change `DEFAULT_APPEARANCE.theme` in `assets/settings.js:49` from `"light"` to `"system"`.
- **D-07:** Change `<option value="light" selected>` to `<option value="system" selected>` in the theme `<select>` in `views/settings.njk` (around line 905).
- **D-08:** No migration — existing users with `meshAppearance` in localStorage keep their stored theme. The `'system'` default applies only to users with no saved preference.

### Claude's Discretion

- Whether to add `requireAuth` to individual `app.routes.js` router entries or intercept at the `VIEW_ROUTE_MAP` rendering level in `server.js` — choose whichever is cleaner with the existing pattern.
- Whether to remove `showSettingsAuthWarning()` in the same plan as the server-side gate or leave it as a no-op (removing dead code is preferred).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Auth Gate
- `src/core/auth.js` — `requireAuth` function definition (line 380), `resolveAuthUserFromRequest` (line 309), cookie name/config
- `src/routes/app.routes.js` — existing route definitions; `requireAuth` usage pattern for protected API routes (line 346)
- `src/server.js` — `VIEW_ROUTE_MAP` construction and `sendHtmlWithHashes` dispatcher (lines 130–238); this is where the settings route is currently served without auth

### Settings Frontend
- `assets/settings.js` — `showSettingsAuthWarning()` (line 142), `preloadUserStoreCache()` (line 167), `DEFAULT_APPEARANCE` (line 49), `resolveThemeSetting()` (line 280)
- `views/settings.njk` — inline theme script (line 23), theme `<select>` HTML (line 904–908)

### No external specs — requirements fully captured in decisions above

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `requireAuth` (`src/core/auth.js:380`) — drop-in Express middleware; already used on all `/api/user/store` routes
- `sendHtmlWithHashes(res, templatePath)` (`src/server.js:207`) — the function that serves `.njk` templates; auth gate can wrap this call
- `resolveThemeSetting(theme)` (`assets/settings.js:280`) — already handles `'system'` value via `matchMedia`; the inline script in `settings.njk` independently handles `'system'` the same way

### Established Patterns
- Server-side auth: `requireAuth` returns `401 JSON` for API routes; for page routes, the convention will be to `res.redirect('/app?login=1')` instead of returning JSON
- Theme resolution: both the inline flash-prevention script (settings.njk) and the JS module (settings.js) have parallel `'system'` handling — both must be updated to change the default
- `VIEW_ROUTE_MAP` serves pages without auth — the settings route dispatches through this path at `src/server.js:229–238`

### Integration Points
- The `VIEW_ROUTE_MAP` middleware at `src/server.js:229` dispatches all non-API paths; adding an auth check here for `/settings` specifically (or wrapping `sendHtmlWithHashes`) is the injection point for SETT-04
- `preloadUserStoreCache()` is called at DOMContentLoaded in `settings.njk` — once the server-side gate is in place, a 401 response there indicates a real session problem, not a timing artifact

</code_context>

<specifics>
## Specific Ideas

- Redirect destination confirmed as `/app?login=1` — matches `window.location.assign("/app?login=1")` used in the session revoke flow (assets/settings.js:769)
- `DEFAULT_APPEARANCE.theme` changing from `"light"` to `"system"` affects the `updatePreviews()` fallback display ("System" label exists in `themeMap` at settings.js:1282)

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 39-settings-auth-fix-theme-default*
*Context gathered: 2026-04-19*
