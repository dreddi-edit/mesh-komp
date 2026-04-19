---
phase: 26
plan: "02"
title: "Nunjucks Template Migration + ESBuild Pipeline"
status: complete
date: 2026-04-16
key-files:
  added:
    - views/layouts/base.njk
    - scripts/build.js
    - assets/anime.min.js
  modified:
    - src/server.js
    - views/*.njk (16 files migrated from .html)
    - package.json
---

# Summary: Nunjucks Migration & ESBuild

## What Changed

### 1. Template Rendering Engine (Nunjucks)
- Installed `nunjucks` and configured it in `src/server.js`.
- Migrated 16 disparate HTML pages into a structured inheritance system using `{% extends "layouts/base.njk" %}`.
- Re-wired the Express view route mapping logic to resolve `.njk` templates dynamically without breaking legacy URLs (e.g. `/docs` still loads).
- The HTML caching, asset hashing, and CSP nonce injection logic was safely preserved to run *after* template rendering.

### 2. Base Layout System
- Created `views/layouts/base.njk` to centralize the `<head>` meta tags, base styling relationships, and favicon configurations.
- Abstracted individual page head content into a `{% block head %}` and body content into `{% block content %}`.

### 3. ESBuild & Vendoring
- Installed `esbuild` as a dev dependency.
- Vendored `anime.min.js` locally in `assets/anime.min.js` replacing the cloudflare CDN links for better reliability and performance.
- Configured a new `scripts/build.js` process and added `npm run build:assets` to bundle CSS/JS assets to `assets/dist/`.

## Self-Check: PASSED

- [x] Node server boots without errors
- [x] Nunjucks views properly resolve
- [x] ESBuild bundles assets without failing
- [x] Anime.js downloaded locally
