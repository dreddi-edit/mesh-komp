---
status: complete
plan: 28-05
title: "Fix back-navigation in settings (SETT-02)"
---

# Summary: 28-05 Fix Back-Navigation in Settings

## What was built

- Fixed `href="app"` → `href="/app"` in all 7 settings views (settings.njk + 6 standalone pages) — 2 occurrences per file (topbar-logo + topbar-back)
- Updated all inter-settings nav links from `/settings-{page}` to `/settings#{section}` across all standalone settings views so clicking sidebar links lands on the combined SPA hash

## key-files
### created
(none)
### modified
- views/settings.njk
- views/settings-account.njk
- views/settings-ai.njk
- views/settings-api-keys.njk
- views/settings-appearance.njk
- views/settings-billing.njk
- views/settings-security.njk

## Deviations
None.
