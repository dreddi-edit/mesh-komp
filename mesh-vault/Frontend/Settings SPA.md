---
tags: [frontend]
---

# Settings SPA

## Architecture

Settings are a standalone page flow, not a tab inside the app. The canonical route is `/settings`.

The settings page is a hash-based SPA — one HTML file that routes via `#account`, `#security`, etc.

## Files

| File | Role |
|------|------|
| `views/settings.html` | Combined SPA with all six sections |
| `assets/settings.js` | Shared runtime: forms, switches, API keys, billing, appearance, theme |
| `assets/settings-combined.js` | SPA router — hash routing, section show/hide, init re-running |
| `assets/mesh-settings.css` | Shared styling for all settings pages |

### Standalone Pages (Legacy)

These remain for direct-URL access and backwards compatibility:

- `views/settings-account.html` — account/profile/workspace/integrations
- `views/settings-security.html` — sessions and audit
- `views/settings-billing.html` — plan, contact, invoices, usage
- `views/settings-api-keys.html` — API key lifecycle
- `views/settings-appearance.html` — theme/density/motion
- `views/settings-ai.html` — provider keys, BYOK, default models

## Sections

| Hash | Section |
|------|---------|
| `#account` | Account/profile/workspace/integrations |
| `#security` | Sessions, session revocation |
| `#billing` | Plan, invoices, usage |
| `#api-keys` | API key lifecycle |
| `#appearance` | Theme, density, motion |
| `#ai` | Provider keys, BYOK validation, AI behavior |

## Data Model — User Store Keys

All settings are persisted to the user store via `/api/user/store`.

| Key | Contains |
|-----|---------|
| `meshAiAnthropic` | Anthropic API key config |
| `meshAiOpenAI` | OpenAI API key config |
| `meshAiGoogle` | Google API key config |
| `meshAiByok` | BYOK credentials |
| `meshAiBehaviour` | AI behavior settings |
| `meshByokModelRegistry` | Custom model registry for BYOK |
| `meshApiKeys` | User-generated API keys |
| `meshAppearance` | Theme, density, motion preferences |
| `meshSwitches` | Feature flag toggles |
| `meshAccountProfile` | Name, email, profile data |
| `meshWorkspaceConfig` | Workspace behavior config |
| `meshSecurityBaseline` | Security settings |
| `meshBillingContact` | Billing contact info |
| `meshBillingState` | Plan/subscription state |
| `meshIntegrations` | Third-party integrations |

## Hydration Sequence

1. Load local cache (localStorage) first — UI renders immediately
2. Fetch safe values from `/api/user/store`
3. Persist updates to both localStorage and user store
4. Backend failure is non-fatal in most places — UI still works offline

## Return Navigation

Settings preserve a `returnTo` route (usually `/app`). After saving, the user returns to the correct shell state.

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/user/store` | Fetch all user store values |
| `PUT /api/user/store/:key` | Write a specific store value |
| `GET /api/app/billing/summary` | Billing plan and usage |
| `GET /api/app/billing/invoices/:id/download` | Invoice download |
| `GET /api/auth/sessions` | List active sessions |
| `POST /api/auth/sessions/revoke` | Revoke a session |
| `POST /api/byok/validate` | Validate a BYOK key |
