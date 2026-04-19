---
plan: 21-01
title: XSS Audit + DOMPurify Setup
status: complete
completed: 2026-04-16
commit: a334753
---

## What Was Built

Audited all frontend JS files for unsafe DOM injection. Created `assets/dom-utils.js` with three helpers:
- `sanitizeHtml(html)` — DOMPurify wrapper with Mesh allowlist (safe tags + attrs)
- `safeHtml(el, html)` — sanitized innerHTML setter
- `safeEl(tag, text, className)` — pure textContent element factory

Added `<script src="/assets/dom-utils.js">` to `views/app.njk` (after DOMPurify) and `views/settings.njk` (which previously had no DOMPurify at all).

## Self-Check: PASSED

- `grep "DOMPurify" assets/dom-utils.js` ✓
- `grep "textContent" assets/dom-utils.js` ✓
- `grep "dom-utils.js" views/app.njk` ✓
- `grep "dom-utils.js" views/settings.njk` ✓
- `grep "dompurify" views/settings.njk` ✓
