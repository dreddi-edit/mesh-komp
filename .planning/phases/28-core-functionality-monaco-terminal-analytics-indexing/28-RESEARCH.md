# Phase 28 Research: Settings — UI, Navigation & Persistence

**Researched:** 2026-04-17
**Mode:** Implementation (bug investigation + restyle)
**Confidence:** High — all root causes identified from source code analysis

---

## Overview

Phase 28 covers three requirements:

| Req | Title | Root Cause |
|-----|-------|-----------|
| SETT-01 | Style settings to match app design language | Already on same token system — gap is visual fidelity details |
| SETT-02 | Back-navigation without login redirect | `href="app"` (relative, no slash) on topbar-back/logo links — resolves to wrong path before JS override runs |
| SETT-03 | Settings persist across sessions | Persistence works (dual localStorage + DynamoDB), but silent failure paths exist |

---

## SETT-01: Settings UI Design Consistency

### Current State

**Entry points:**
- `views/settings.njk` — combined SPA (correct entry point), 1348 lines
- `views/settings-{account,security,billing,api-keys,appearance,ai}.njk` — standalone pages (legacy/backup)

**CSS architecture:**
- `assets/mesh-settings.css` imports `assets/tokens.css` at line 1 — same token base as `app-workspace.css`
- `mesh-settings.css` defines local aliases (`--bg`, `--panel`, `--text`, `--accent`) that map to `--color-*` tokens
- `app-workspace.css` also defines local aliases (`--bg`, `--bg2`, `--tx`, `--ac`) from the same `--color-*` tokens

**Gap — the aliases are slightly different:**

| Concept | mesh-settings.css | app-workspace.css |
|---------|-------------------|-------------------|
| Primary BG | `--bg: var(--color-bg-primary)` | `--bg: var(--color-bg-primary)` same |
| Surface | `--panel: var(--color-bg-secondary)` | `--bg2: var(--color-bg-secondary)` same value, different name |
| High text | `--text-hi: var(--color-text-secondary)` | `--tx2: var(--color-text-secondary)` same value, different name |
| Accent | `--accent: var(--color-accent-primary)` | `--ac: var(--color-accent-primary)` same value, different name |

Both alias sets resolve to the same `--color-*` token values. **The token foundation is consistent.** Visual discrepancies are in component-level styling rather than the token layer.

**Known visual issues to audit:**
1. `settings.njk` has `data-settings-page="account"` hardcoded on `<body>` — other sections should be hidden via `section[data-settings-section]` — section toggling is via `settings-combined.js`
2. Active nav state: `settings-nav a.active` is class-based; `settings-combined.js` toggles via `showSection()` — correct
3. Font: settings uses `Inter` from Google Fonts; app.njk uses `Inter` too — consistent
4. The standalone settings pages have hardcoded `class="active"` on the current page's nav link — correct for standalone mode

**Files to restyle (if issues found):** `assets/mesh-settings.css`, `views/settings.njk`

---

## SETT-02: Back-Navigation Bug

### Root Cause

**The combined `/settings` SPA** (`views/settings.njk`) has the correct JS architecture:

1. `buildSettingsHref()` in `assets/app-workspace.js:484` builds the URL as `/settings?returnTo={currentAppUrl}#section`
2. `openStandaloneSettings()` at line 494 strips `?login=1` from `currentAppUrl` before setting as `returnTo`
3. `applyStandaloneNavigation()` in `assets/settings.js:241` reads `?returnTo` and updates `.topbar-back` and `.topbar-logo` hrefs

**The actual bug:**

All settings views have hardcoded `href="app"` (relative path, no leading slash):
- `views/settings.njk` line 29: `<a class="topbar-logo" href="app">`
- `views/settings.njk` line 32: `<a class="topbar-back" href="app">← Workspace</a>`
- Same pattern in all 6 standalone settings views

`settings.js` loads with `defer` and runs `async preloadUserStoreCache()` before `applyStandaloneNavigation()` which fixes these hrefs. However:
- If the user is on `/settings` (root-level), `href="app"` resolves to `/app` ✓ (accidental correct resolution)
- If the user is on a standalone page like `/settings-account`, `href="app"` resolves to `/settings-account/app` → 404 → server may redirect → goes through login

**Additional timing issue:** The `defer` + async pattern means `applyStandaloneNavigation()` runs after `preloadUserStoreCache()` resolves. Any click before this resolves uses the raw `href="app"` which may be wrong.

**Fix:** Change `href="app"` → `href="/app"` (absolute path) everywhere. The JS override from `applyStandaloneNavigation()` will still correctly replace this with the `?returnTo` value when it runs, but the fallback path is also correct.

**`?login=1` redirect:** `window.location.assign("/app?login=1")` only fires at `settings.js:742` when the **session revoke API** returns `body.signedOut === true`. This is intentional (signing out). The `/app` page strips `?login=1` at line 2010 of `app-workspace.js` before checking auth — so it doesn't trigger a persistent login loop.

**Files to fix:**
- `views/settings.njk` — 2 occurrences
- `views/settings-account.njk` — 2 occurrences
- `views/settings-ai.njk` — 2 occurrences
- `views/settings-api-keys.njk` — 2 occurrences
- `views/settings-appearance.njk` — 2 occurrences
- `views/settings-billing.njk` — 2 occurrences
- `views/settings-security.njk` — 2 occurrences

---

## SETT-03: Settings Persistence

### Current Architecture

**Save path (settings.js):**
1. `persistJSON(key, value)` — saves to `localStorage` AND calls `PUT /api/user/store/:key` with merge
2. `saveJSON(key, val)` — same but async fire-and-forget (non-blocking, errors silently swallowed)
3. Forms use `persistJSON` on submit via `handleFormSubmit()` — shows toast on success/error
4. Appearance/switches use `saveJSON` on immediate change (no feedback)

**Load path on `/settings` page:**
1. `preloadUserStoreCache()` — seeds from `localStorage` first, then fetches `/api/user/store?keys={SAFE_KEYS}` to get server values
2. Loads non-sensitive keys only (appearance, switches, behaviour, account profile, workspace config, billing state, integrations, assistant edit flow)
3. **Sensitive keys** (API keys: `meshAiAnthropic`, `meshAiOpenAI`, `meshAiGoogle`, `meshAiByok`, `meshApiKeys`) are loaded separately via `GET /api/user/store/:key` per-form

**Load path on `/app` page:**
1. `loadUserStore()` in `bootstrap()` calls `GET /api/user/store?keys=meshApiKeys,meshAppearance,meshSwitches,meshAiBehaviour,meshWorkspaceConfig,meshAccountProfile`
2. `app-workspace.js:1824-1841` applies: theme, accent, density, motion, font, model, switches, workspace config, account profile

**Server storage:** `secureDb.getUserStoreValue()` / `secureDb.setUserStoreValue()` — backed by DynamoDB (or SQLite in dev). User must be authenticated.

### Persistence Status

The persistence architecture is **functionally complete**. The main gaps:

1. **Silent failure on save:** `saveJSON` swallows errors silently. If session expires mid-use, appearance changes are lost (only in localStorage, not DynamoDB). No user feedback.

2. **`handleFormSubmit` does show errors:** `persistJSON` failures are caught and shown via `showToast`. The form-based saves (AI provider keys, appearance "Save preferences" button) do surface errors correctly.

3. **Model preference flow is working:** `meshAiBehaviour.model` is saved in settings → loaded via `loadUserStore()` → applied to `#chatModel` select. This is the main user-facing persistence path.

4. **Immediate-change saves** (theme toggle, density slider) use `saveJSON` which is fire-and-forget — no confirmation, no error feedback. These are low-criticality.

### Gaps to Fix

- Verify the complete round-trip: Save in settings → navigate away → come back → values are loaded from server (not just localStorage)
- Ensure `preloadUserStoreCache()` failure (401 or network error) shows a meaningful message rather than showing default/stale values silently
- The "Save preferences" button in appearance already uses `persistJSON` with toast feedback — verify it works end-to-end

**Files to audit:** `assets/settings.js` (forms submit handlers, `saveJSON` usage)

---

## Settings Navigation Active State

The combined settings SPA has 6 sections:
- `account` — Profile and workspace identity  
- `security` — Sessions, 2FA and recovery posture  
- `billing` — Plan, invoices and usage  
- `api-keys` — Automation credentials  
- `appearance` — Theme, density and motion  
- `ai` — AI & Models

**Navigation:** `settings-combined.js` handles hash-based routing via `showSection()`. Active state toggled via `classList.toggle('active', ...)`. The CSS `.settings-nav a.active` styles are defined in `mesh-settings.css:283-289`. This works correctly — no bug here.

**Section-to-section link issue:** In standalone pages (`settings-account.njk`, etc.), nav links like `<a href="/settings-appearance">` navigate to standalone pages rather than the combined SPA. `applyStandaloneNavigation()` in `settings.js:246-250` rewrites these to hash-based SPA URLs via `buildSettingsHref()`. Same timing-race risk as the back button.

**Fix:** Update all inter-settings nav links in standalone pages to use `/settings#section` format directly, as `href` fallback.

---

## Validation Architecture

### E2E Tests (Playwright)

- **SETT-01:** Load `/settings`, screenshot each section, verify no broken layout
- **SETT-02:** Navigate from `/settings` with no `?returnTo` → click `← Workspace` → verify URL is `/app` (not `/settings-account/app` or `/app?login=1`)
- **SETT-03:** POST to `/api/user/store/meshAppearance` → reload `/settings` → verify form shows saved values

### Manual Verification

- Hard-refresh `/settings` after saving appearance → verify saved values repopulate
- Open DevTools Network tab → verify `PUT /api/user/store/meshAppearance` fires on Save with correct body
- Verify `GET /api/user/store?keys=...` returns updated values on fresh load

---

## Files to Modify

| File | Change | Req |
|------|--------|-----|
| `views/settings.njk` | Fix `href="app"` → `href="/app"` (topbar-logo + topbar-back) | SETT-02 |
| `views/settings-account.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `views/settings-ai.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `views/settings-api-keys.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `views/settings-appearance.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `views/settings-billing.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `views/settings-security.njk` | Fix `href="app"` → `href="/app"` | SETT-02 |
| `assets/settings.js` | Verify persistence round-trip; improve auth failure UX | SETT-03 |
| `assets/mesh-settings.css` | Audit and align visual gaps vs app components | SETT-01 |

---

## Implementation Approach

### Plan 28-05: Fix back-navigation (SETT-02)
**Scope:** Change `href="app"` → `href="/app"` in all 7 settings views. Simple surgical fix — no JS changes needed. The `applyStandaloneNavigation()` JS override still works; this just fixes the fallback path.

### Plan 28-06: Settings UI visual audit and alignment (SETT-01)
**Scope:** Systematically compare settings pages against the app's visual language. Both share `tokens.css` — focus on component atoms: buttons, inputs, panels, sidebar width, topbar height. Align any deviations in `mesh-settings.css` and `settings.njk`.

### Plan 28-07: Settings persistence verification and hardening (SETT-03)
**Scope:** Audit the settings save flow end-to-end. Verify the `PUT /api/user/store/:key` → reload → `GET /api/user/store?keys=...` cycle. Add meaningful error display when `preloadUserStoreCache` fails. Ensure `saveJSON` silent failures don't lose data on session expiry.
