---
plan: 22-03
title: E2E + Frontend Smoke Tests
status: deferred
completed: null
---

## Status

Deferred by user — E2E Playwright tests to be written and verified when a local
server with test data is available. The `autonomous: false` checkpoint (task 3)
requires a running server which is not currently set up.

## Pending Work

- Install `@playwright/test` + chromium browsers
- Create `playwright.config.js`
- Add `test:e2e` script to `package.json`
- Create `test/e2e/login.spec.js`, `workspace.spec.js`, `chat.spec.js`,
  `terminal.spec.js`, `smoke.spec.js`
- Human checkpoint: run and verify suite against live server
