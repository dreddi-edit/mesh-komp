---
tags: [frontend]
---

# Views Reference

All HTML surfaces live in `views/`. `src/server.js` serves them at clean URLs.

## Main Product Pages

| File | URL | Purpose |
|------|-----|---------|
| `views/index.html` | `/` | Public marketing landing page |
| `views/app.html` | `/app` | **Main IDE workbench** — editor, terminal, voice |
| `views/docs.html` | `/docs` | Product documentation page |
| `views/repo-docs.html` | `/repo-docs` | Live browsable repo docs surface |
| `views/how-it-works.html` | `/how-it-works` | Architecture explainer page |
| `views/marketplace.html` | `/marketplace` | Extension marketplace (embedded in workbench) |
| `views/statistics.html` | `/statistics` | Compression metrics and product stats |
| `views/terminal.html` | `/terminal` | Terminal and workflow story page |

## Settings Pages

| File | URL | Purpose |
|------|-----|---------|
| `views/settings.html` | `/settings` | **Combined SPA settings hub** |
| `views/settings-account.html` | `/settings-account` | Account/profile/workspace/integrations |
| `views/settings-security.html` | `/settings-security` | Sessions and audit |
| `views/settings-billing.html` | `/settings-billing` | Plan, invoices, usage |
| `views/settings-api-keys.html` | `/settings-api-keys` | API key lifecycle |
| `views/settings-appearance.html` | `/settings-appearance` | Theme/density/motion |
| `views/settings-ai.html` | `/settings-ai` | Provider keys, BYOK, AI behavior |

## Repo Docs Surface (`/repo-docs`)

A docsify-style documentation surface for the `mesh-komp` repo itself:
- Searchable sidebar
- Rendered Markdown
- Browsable repo file tree

Files: `assets/repo-docs.js`, `assets/repo-docs.css`
APIs: `/api/docs/index`, `/api/docs/file`

## Static Assets

All assets (JS, CSS, SVG, JSON) are served from the repo root as static files.
The repo root itself is the static root — assets are referenced by their relative paths.
