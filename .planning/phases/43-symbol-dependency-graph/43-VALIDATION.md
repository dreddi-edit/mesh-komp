---
phase: 43
slug: symbol-dependency-graph
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 43 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node --test`) |
| **Config file** | none — uses `node --test` directly |
| **Quick run command** | `node --test --test-force-exit --test-timeout=30000 tests/compression.test.cjs 2>&1 \| head -20` |
| **Full suite command** | `node --test --test-force-exit --test-timeout=120000 2>&1 \| tail -5` |
| **Estimated runtime** | ~15 seconds (quick), ~60 seconds (full) |

---

## Sampling Rate

- **After every task commit:** Run quick command
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 43-01-01 | 01 | 1 | SYM-01 | unit | `node --test --test-force-exit tests/symbol-index.test.cjs` | ❌ W0 | ⬜ pending |
| 43-01-02 | 01 | 1 | SYM-01 | unit | `node --test --test-force-exit tests/symbol-index.test.cjs` | ❌ W0 | ⬜ pending |
| 43-02-01 | 02 | 2 | SYM-02 | unit | `node --test --test-force-exit tests/call-site-resolution.test.cjs` | ❌ W0 | ⬜ pending |
| 43-02-02 | 02 | 2 | SYM-02 | unit | `node --test --test-force-exit tests/call-site-resolution.test.cjs` | ❌ W0 | ⬜ pending |
| 43-03-01 | 03 | 3 | SYM-03 | unit | `node --test --test-force-exit tests/symbol-context-format.test.cjs` | ❌ W0 | ⬜ pending |
| 43-03-02 | 03 | 3 | SYM-04 | unit | `node --test --test-force-exit tests/symbol-incremental.test.cjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/symbol-index.test.cjs` — stubs for SYM-01 (symbol extraction from file records)
- [ ] `tests/call-site-resolution.test.cjs` — stubs for SYM-02 (cross-file call site resolution)
- [ ] `tests/symbol-context-format.test.cjs` — stubs for SYM-03 (AI context format output)
- [ ] `tests/symbol-incremental.test.cjs` — stubs for SYM-04 (incremental file save update)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Symbol chain appears in chat context | SYM-03 | Requires running server + opening workspace + sending a chat message | Start server, open a workspace, send a chat asking about a function — verify the AI response references specific file:line locations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
