---
status: complete
plan: 28-07
title: "Settings persistence hardening (SETT-03)"
---

# Summary: 28-07 Settings Persistence Hardening

## What was built

- Added `showSettingsAuthWarning()` function: shows a fixed amber banner "Not signed in — changes won't be saved to your account" when `preloadUserStoreCache` receives a 401 response
- Modified `preloadUserStoreCache` to call `showSettingsAuthWarning()` on 401 instead of silently ignoring the auth failure
- Changed `initAppearance` submit handler from synchronous `saveJSON` (fire-and-forget) to `async persistJSON` with `withButtonBusy` state and catch block that shows an error toast on failure

## key-files
### created
(none)
### modified
- assets/settings.js

## Deviations
None. All DOM construction in showSettingsAuthWarning uses createElement/textContent/appendChild (no innerHTML with user data).
