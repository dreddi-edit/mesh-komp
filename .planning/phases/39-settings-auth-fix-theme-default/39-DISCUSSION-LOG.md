# Phase 39: Settings — Auth-Fix & Theme-Default — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-19
**Phase:** 39-settings-auth-fix-theme-default
**Areas discussed:** SETT-04 fix strategy, SETT-05 default scope

---

## SETT-04 Fix Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Server-side gate | Add requireAuth to /settings route; unauthenticated users redirect before page loads. Eliminates client-side race entirely. | ✓ |
| Client-side only | Check auth before calling preloadUserStoreCache(); redirect if 401. More complex, still susceptible to race conditions. | |
| Remove banner, degrade gracefully | Drop the warning entirely; settings works with localStorage-only when unauthenticated. | |

**User's choice:** Server-side gate

---

## SETT-04 Redirect Target

| Option | Description | Selected |
|--------|-------------|----------|
| /app?login=1 | Consistent with logout flow already in the codebase (settings.js:769) | ✓ |
| /app | Simple redirect, no login modal auto-open | |
| Custom /login page | Only if explicit /login route exists | |

**User's choice:** /app?login=1

---

## SETT-05 Theme Default

| Option | Description | Selected |
|--------|-------------|----------|
| System (follows OS) | Change fallback from 'light' to 'system' in 3 places; resolveThemeSetting() already handles it. | ✓ |
| Keep light as default | Leave SETT-05 unfixed this phase | |

**User's choice:** System (follows OS)

---

## SETT-05 Migration

| Option | Description | Selected |
|--------|-------------|----------|
| No migration | Only change fallback for users with no saved preference. Existing localStorage data unchanged. | ✓ |
| Migrate stored 'light' → 'system' | Upgrade stored light to system on load; risky — can't distinguish default-light from deliberate-light. | |

**User's choice:** No migration

---

## Claude's Discretion

- Whether to intercept at VIEW_ROUTE_MAP level in server.js or add a dedicated route for /settings in app.routes.js
- Whether to remove showSettingsAuthWarning() dead code in the same plan

## Deferred Ideas

None.
