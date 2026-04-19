# Phase 39: Settings — Auth-Fix & Theme-Default — Research

## RESEARCH COMPLETE

---

## SETT-04: Auth Gate Implementation

### Current Architecture

`/settings` is served by the generic VIEW_ROUTE_MAP middleware in `src/server.js:229-238`:

```js
app.use(async (req, res, next) => {
  if (req.path === '/' || req.path.slice(1).includes('.')) return next();
  const filePath = VIEW_ROUTE_MAP.get(req.path);
  if (filePath) {
    try {
      return await sendHtmlWithHashes(res, filePath);
    } catch (err) { return next(err); }
  }
  next();
});
```

This dispatcher serves all `.njk` views without any auth gate — it's a catch-all for clean-URL template routing.

### Injection Point

The correct fix is to add a **dedicated route for `/settings` that fires before the generic middleware**. Express processes middleware in registration order, so placing an explicit `app.get('/settings', ...)` before the `app.use(...)` VIEW_ROUTE_MAP dispatcher ensures the auth check runs only for `/settings`.

```js
// Add BEFORE the VIEW_ROUTE_MAP app.use(...) middleware
app.get('/settings', async (req, res, next) => {
  const resolved = await resolveAuthUserFromRequest(req);
  if (!resolved) {
    return res.redirect('/app?login=1');
  }
  try {
    await sendHtmlWithHashes(res, 'settings.njk');
  } catch (err) { next(err); }
});
```

### Why Not Modify `requireAuth`

`requireAuth` always returns 401 JSON — it's an API middleware. For a page route, we need a redirect, not JSON. Rather than adding a flag/parameter to `requireAuth`, the inline pattern above is cleaner and doesn't pollute the API auth middleware with page-routing concerns. It uses the already-exported `resolveAuthUserFromRequest` directly.

### `resolveAuthUserFromRequest` Availability

`resolveAuthUserFromRequest` is exported from `src/core/auth.js` and available on `core` via `src/core/index.js`. Check whether it's exposed there or needs direct import from auth.js.

### Dead Code After Gate

Once `/settings` redirects unauthenticated users before the page loads, `showSettingsAuthWarning()` and its call site in `preloadUserStoreCache()` (`assets/settings.js:184`) become dead code. Both should be removed in the same plan to keep the codebase clean.

---

## SETT-05: Theme Default Changes

### Three Touch Points

All three must change together — they are independent code paths that produce the same initial theme value:

1. **`views/settings.njk:23`** — inline flash-prevention script (runs before CSS, prevents dark flash on light mode):
   ```js
   var t=String(a.theme||'light').trim();
   ```
   Change `'light'` → `'system'`.

2. **`assets/settings.js:49`** — `DEFAULT_APPEARANCE` constant used when `loadJSON('meshAppearance', DEFAULT_APPEARANCE)` falls back to defaults:
   ```js
   const DEFAULT_APPEARANCE = { theme: "light", density: "default", ... };
   ```
   Change `"light"` → `"system"`.

3. **`views/settings.njk:905`** — `<option selected>` in the theme `<select>`:
   ```html
   <option value="light" selected>Light</option>
   ```
   Change to `<option value="system" selected>Follow system</option>`.

### No localStorage Migration

The change only affects users with no `meshAppearance` key in localStorage. The `loadJSON` pattern reads localStorage first — if `meshAppearance` exists, the stored value wins. No migration script needed.

### `resolveThemeSetting` Already Handles 'system'

`assets/settings.js:280-286` correctly resolves `'system'` via `matchMedia('(prefers-color-scheme: dark)')`. The inline `settings.njk:23` script independently handles `'system'` the same way. Both already work — only the default value needs updating.

---

## Validation Architecture

### Manual Verification Steps

- **SETT-04:** Visit `/settings` in a logged-out browser tab → expect redirect to `/app?login=1`. Visit `/settings` while logged in → expect settings page loads normally.
- **SETT-05:** Clear localStorage, visit settings in a dark-OS browser → expect dark theme applied. Clear localStorage, visit settings in a light-OS browser → expect light theme applied.
- **SETT-05 persistence:** Set explicit `light` theme in settings, reload → expect `light` overrides OS.

### Grep-Verifiable Criteria

- `views/settings.njk` contains `||'system'` (not `||'light'`) in the inline script
- `assets/settings.js` contains `theme: "system"` in DEFAULT_APPEARANCE
- `views/settings.njk` contains `value="system" selected` in the theme select
- `src/server.js` contains `resolveAuthUserFromRequest` (or auth core import) near the `/settings` route
- `src/server.js` contains `res.redirect('/app?login=1')` in the `/settings` handler
- `assets/settings.js` does NOT contain `showSettingsAuthWarning` (removed)

---

## Files to Modify

| File | Change | Plan |
|------|--------|------|
| `src/server.js` | Add `/settings` auth gate route before VIEW_ROUTE_MAP middleware | 39-01 |
| `assets/settings.js` | Remove `showSettingsAuthWarning()` + call site; change `DEFAULT_APPEARANCE.theme` | 39-01 |
| `views/settings.njk` | Change `||'light'` → `||'system'` in inline script; change `<option selected>` | 39-02 |

Plan 39-01 (backend + JS cleanup) can be autonomous. Plan 39-02 (template changes) requires browser verification of theme flash behavior.
