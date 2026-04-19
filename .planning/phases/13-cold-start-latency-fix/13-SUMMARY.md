---
phase: 13-cold-start-latency-fix
plan: "inline"
subsystem: auth
tags: [performance, latency, dynamodb, prefetch]

requires:
  - phase: "09"
    provides: "credential cache (60s TTL) that the prefetch populates"
provides:
  - Background credential prefetch in requireAuth middleware
  - Cold-start DynamoDB serial chain eliminated (session-resolve → credential-fetch now overlap)
affects: []

tech-stack:
  added: []
  patterns: [fire-and-forget background prefetch, non-blocking credential warm-up]

key-files:
  created: []
  modified:
    - src/core/auth.js

key-decisions:
  - "Prefetch is fire-and-forget — never delays the request, result goes into credential cache"
  - "Only fires on cache miss to avoid redundant DDB calls on warm paths"

requirements-completed: []

duration: 10min
completed: 2026-04-16
---

# Phase 13: Cold-Start Latency Fix

**Eliminated the serial session-resolve → credential-fetch latency chain by firing a background credential prefetch immediately after session resolution.**

## Accomplishments

- `requireAuth` middleware: on cold cache miss, fires `getStoredCredentialsForUser()` as background task
- By the time the route handler calls it, the DynamoDB GSI query is already in-flight or complete
- Prefetch populates the 60s credential cache — subsequent calls within TTL are free

## Self-Check: PASSED

- Commit `ac9a985` — perf(auth): phase 13
