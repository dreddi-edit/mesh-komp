---
phase: 09-performance-in-process-caching-zero-cost-quick-wins
plan: "01"
subsystem: auth
tags: [caching, dynamodb, performance, session]

requires: []
provides:
  - Session cache (30s TTL) — eliminates 2 DynamoDB calls per authenticated request
  - Credential cache (60s TTL) — eliminates 1 DynamoDB GSI query per /api/assistant/chat
  - Cache invalidation on logout, revoke, and credential update
affects: [phase-13-cold-start]

tech-stack:
  added: []
  patterns: [TTL in-process Map cache, fire-and-forget prefetch, explicit cache invalidation on mutation]

key-files:
  created: []
  modified:
    - src/core/auth.js

key-decisions:
  - "30s session TTL balances security (short enough to catch revokes) with perf (eliminates repeat DDB reads)"
  - "60s credential TTL matches expected assistant session duration"
  - "Cache expiry still re-validates on every hit — no stale auth risk"

requirements-completed: []

duration: 15min
completed: 2026-04-16
---

# Phase 09 Plan 01: In-Process Session + Credential Caching

**Added TTL-based in-process caches for session and credential lookups — eliminates 3 DynamoDB calls per authenticated request on warm paths.**

## Accomplishments

- Session cache (30s TTL): `readSession` + `getUserById` DynamoDB calls cached in Map
- Credential cache (60s TTL): `getUserStoreValues` GSI query cached per user
- Invalidation: logout clears by token; revoke-all/others clears by userId; PUT /api/user/store/:key clears credential cache

## Self-Check: PASSED

- Commit `1b9554d` — perf(auth): add TTL in-process caches
