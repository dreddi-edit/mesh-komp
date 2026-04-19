---
plan: 22-01
title: CI Pipeline + Coverage
status: complete
completed: 2026-04-16
---

## What Was Built

- Installed `c8@^11.0.0` as devDependency for V8 coverage
- Added `test:coverage` script (text + lcov reporters, no threshold)
- Added `test:ci` script (text + lcov, --check-coverage --lines 40 threshold)
- Created `.github/workflows/ci.yml` with two jobs:
  - `lint-test`: checkout → Node 20 setup → npm ci → lint → test:ci → upload coverage artifact
  - `security-audit`: checkout → Node 20 setup → npm ci → npm audit --audit-level=high

## Self-Check: PASSED

- `grep "c8" package.json` — matches devDependencies and both test scripts ✓
- `grep "npm run lint" .github/workflows/ci.yml` ✓
- `grep "npm run test:ci" .github/workflows/ci.yml` ✓
- `grep "audit-level=high" .github/workflows/ci.yml` ✓
