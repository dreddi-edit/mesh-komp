---
phase: 44
slug: semantic-query-index
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 44 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none — uses `node --test` |
| **Quick run command** | `node --test --test-force-exit test/query-index-*.test.cjs` |
| **Full suite command** | `node --test --test-force-exit --test-timeout=120000` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-force-exit test/query-index-*.test.cjs`
- **After every plan wave:** Run `node --test --test-force-exit --test-timeout=120000`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 44-01-01 | 01 | 1 | IDX-01 | unit | `node --test --test-force-exit test/query-index-build.test.cjs` | ❌ W0 | ⬜ pending |
| 44-01-02 | 01 | 1 | IDX-01 | unit | `node --test --test-force-exit test/query-index-build.test.cjs` | ❌ W0 | ⬜ pending |
| 44-02-01 | 02 | 2 | IDX-02, IDX-03 | unit | `node --test --test-force-exit test/query-index-search.test.cjs` | ❌ W0 | ⬜ pending |
| 44-03-01 | 03 | 3 | IDX-04 | unit | `node --test --test-force-exit test/query-index-incremental.test.cjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/query-index-build.test.cjs` — stubs for IDX-01 (index build from symbols + string literals)
- [ ] `test/query-index-search.test.cjs` — stubs for IDX-02, IDX-03 (query resolution, type boosts, top-N)
- [ ] `test/query-index-incremental.test.cjs` — stubs for IDX-04 (incremental update on file save)

*Existing infrastructure covers the test runner. Only test file stubs need creation.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `searchWorkspace()` response shape in live worker | IDX-02 | Requires running mesh worker process | Start server, trigger workspace search, inspect response for snippets[] field |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
