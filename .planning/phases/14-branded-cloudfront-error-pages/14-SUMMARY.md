---
phase: 14-branded-cloudfront-error-pages
plan: "inline"
subsystem: infra
tags: [cloudfront, error-pages, s3, ux]

requires:
  - phase: "13"
    provides: "cold-start latency fix and performance infra"
provides:
  - Branded Mesh HTML error pages for 502/503/504
  - S3-hosted under /_errors/ prefix
  - CloudFront CustomErrorResponses routing to branded pages (TTL 30s)
  - Deploy script: infra/deploy-error-pages.sh
  - GitHub Actions deploy step: upload error pages on every deploy
affects: []

tech-stack:
  added: []
  patterns: [CloudFront CustomErrorResponses, S3 static hosting for error pages]

key-files:
  created:
    - infra/error-pages/502.html
    - infra/error-pages/503.html
    - infra/error-pages/504.html
    - infra/deploy-error-pages.sh
  modified:
    - infra/cloudformation.yml
    - .github/workflows/deploy.yml

key-decisions:
  - "TTL 30s for error pages — short enough to recover quickly after deploys/restarts"
  - "No inline JS — error pages must pass HTML validation and work without JS"
  - "Dark theme matching app.html — consistent Mesh branding in failure state"

requirements-completed: []

duration: 30min
completed: 2026-04-16
---

# Phase 14: Branded CloudFront Error Pages

**Created S3-hosted Mesh-branded HTML error pages for 502/503/504 and wired them into CloudFront so users see a consistent Mesh UI instead of raw browser errors when the origin is down.**

## Accomplishments

- `infra/error-pages/502.html`, `503.html`, `504.html` — Mesh dark theme, human-readable messages, retry button, no inline JS
- CloudFront `CustomErrorResponses`: 502/503/504 → `/_errors/{code}.html`, TTL 30s
- `infra/deploy-error-pages.sh` — uploads error pages to S3 `/_errors/` prefix
- `.github/workflows/deploy.yml` updated — error pages uploaded on every deploy

## Self-Check: PASSED

- Commit `a1ebcb8` — feat(infra): phase 14 — branded CloudFront error pages for 502/503/504
