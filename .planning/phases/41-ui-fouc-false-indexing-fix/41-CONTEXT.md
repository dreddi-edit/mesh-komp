# Phase 41: UI — FOUC & False Indexing Fix - Context

**Gathered:** 2026-04-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix two specific UI bugs on the app page:
1. **FOUC (UIEL-07):** Flash of wrong theme before first paint on `app.njk`. The page currently has no inline flash-prevention script — `applyTheme()` runs after DOMContentLoaded, causing a dark flash before the stored theme is applied.
2. **False indexing indicator (UIEL-08):** The `idxProgWrap` status bar indicator shows when no indexing is active — either on fresh load with no folder open, or failing to hide after indexing completes.

**Out of scope:** `index.njk` (marketing page, separate CSS system, no `data-theme`/`meshAppearance`); `settings.njk` (already fixed in Phase 39); theme switching animation after initial load; any new theme features.

</domain>

<decisions>
## Implementation Decisions

### FOUC Fix (UIEL-07)

- **D-01:** Add an inline `<script>` to `views/app.njk` as the **first child of `<head>`** (before any stylesheets load). Must run synchronously before first paint.
- **D-02:** The script reads from `localStorage.meshAppearance` (same key as `settings.njk` — consistent across all pages). Falls back to `meshSettings.theme` if `meshAppearance` is absent (legacy local-only key for users who have no server-synced preference yet).
- **D-03:** If no stored preference is found in either key, default to **`'system'`** — resolves via `window.matchMedia('(prefers-color-scheme:dark)')`. Consistent with Phase 39 decision.
- **D-04:** Script pattern to use (identical logic to `settings.njk:23`, adapted for `meshAppearance` key):
  ```js
  (function(){try{var a=JSON.parse(localStorage.getItem('meshAppearance')||'{}');var t=String(a.theme||localStorage.getItem('meshSettings-theme-fallback')||'system').trim();if(t==='system')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.dataset.theme=t==='dark'?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();
  ```
  The researcher/planner should verify the exact fallback key format — `meshSettings` is JSON so `.theme` must be extracted from it. The actual fallback should be: parse `meshSettings`, extract `.theme` if it exists.
- **D-05:** Correct script (researcher to verify exact format):
  ```js
  (function(){try{var a=JSON.parse(localStorage.getItem('meshAppearance')||'{}');var m=JSON.parse(localStorage.getItem('meshSettings')||'{}');var t=String(a.theme||m.theme||'system').trim();if(t==='system')t=window.matchMedia&&window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.dataset.theme=t==='dark'?'dark':'light';}catch(e){document.documentElement.dataset.theme='light';}})();
  ```
- **D-06:** Place the script in `views/app.njk` inside the `{% block head %}` section, as the **very first line** (before the `<style>` block for `#page-transition-overlay`). This ensures it fires before any CSS or other scripts.

### False Indexing Indicator Fix (UIEL-08)

- **D-07:** The fix is in **JS** — call `updateIndexProgressState('idle')` explicitly at the end of `DOMContentLoaded` in `assets/app-workspace.js`, before any folder auto-restore logic runs.
- **D-08:** The idle call must be placed AFTER the initial `loadS()` / `bind()` calls but BEFORE any `restoreFolder()` or `openFolder()` calls, so the bar starts in the correct hidden state, and any subsequent indexing can legitimately show it.
- **D-09:** The `idxProgWrap` already has `style="display:none"` in HTML but something in JS can override it before an indexing session begins. The explicit `updateIndexProgressState('idle')` call in `init()` is the authoritative guard.
- **D-10:** Additionally, check if `updateIndexProgressState` at `app-workspace.js:107` has a guard: `if (state !== 'idle' && !S.dirHandle) return;` — this already prevents the bar from showing when no folder is open. The planner should verify whether this guard is being hit in the false-positive scenario.

### Claude's Discretion

- Exact placement of the inline script in app.njk (first line of `{% block head %}` vs very top of `<head>` — if `<head>` is in base.njk, it must be injected differently; researcher should verify)
- Whether to add the idle guard on DOMContentLoaded or to strengthen the existing `!S.dirHandle` guard in `updateIndexProgressState` itself
- Whether settings sub-pages (`settings-account.njk`, `settings-ai.njk`, etc.) also need the updated `||'system'` fallback (they currently use `||'light'` — but that's out of scope for this phase; note as deferred)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Templates (Flash-Prevention Reference)
- `views/settings.njk` line 23 — the correct inline flash-prevention script pattern (written in Phase 39; use as reference implementation for app.njk)
- `views/app.njk` — target template; `{% block head %}` is where the inline script must be inserted
- `views/layouts/base.njk` — verify whether `<head>` is in base or in page template (determines script placement)

### JavaScript
- `assets/app-workspace.js` lines 1984–1992 — `loadS()`, `applyTheme()`, `loadUserStore()` — the current (broken) theme application sequence
- `assets/app-workspace.js` lines 106–132 — `updateIndexProgressState()` function — the existing `!S.dirHandle` guard and display logic
- `assets/app-workspace.js` lines 2323–2368 — `init()` and `bootstrap()` — where DOMContentLoaded fires and folder restoration begins

No external specs — requirements fully captured in decisions above.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `settings.njk:23` inline script — exact template for the app.njk flash-prevention script; change `meshAppearance` key handling to also check `meshSettings.theme` as fallback
- `updateIndexProgressState('idle')` — already exists; just needs to be called explicitly at init time

### Established Patterns
- All settings sub-pages already have an inline flash-prevention script (but using `||'light'` fallback — not yet updated)
- `applyTheme(t)` in app-workspace.js also sets `document.documentElement.dataset.theme` — the inline script and this function must agree; the inline script fires first (before paint), `applyTheme` fires again from `loadUserStore` once server data arrives (fine — same attribute, same value if correct)
- `updateIndexProgressState` already has a safety guard at line 107: `if (state !== 'idle' && !S.dirHandle) return;` — this prevents non-idle states when no folder is open; the bug may be that this guard runs too late (after the indicator is already shown)

### Integration Points
- `app.njk` → `views/layouts/base.njk` (extends relationship; `<head>` lives in base.njk — inline script must be injected via `{% block head %}`)
- `app-workspace.js` `init()` → `DOMContentLoaded` listener at line 2366

</code_context>

<specifics>
## Specific Ideas

- The inline script in `settings.njk` is the canonical reference — copy the pattern, only change: (1) add `meshSettings` fallback read, (2) already uses `||'system'` from Phase 39.
- False indexing: both fresh-load and stuck-after-completion scenarios should be resolved by the `updateIndexProgressState('idle')` call in `init()` — it resets the DOM state to hidden at page load, and the existing `!S.dirHandle` guard already prevents accidental re-shows without an open folder.

</specifics>

<deferred>
## Deferred Ideas

- Settings sub-pages (`settings-account.njk`, `settings-ai.njk`, `settings-api-keys.njk`, `settings-billing.njk`, `settings-security.njk`) still use `||'light'` fallback in their inline scripts. Should be updated to `||'system'` for consistency, but that's out of scope for Phase 41.
- `index.njk` — marketing page, separate CSS system, FOUC not applicable to the `data-theme` system.

</deferred>

---

*Phase: 41-ui-fouc-false-indexing-fix*
*Context gathered: 2026-04-19*
