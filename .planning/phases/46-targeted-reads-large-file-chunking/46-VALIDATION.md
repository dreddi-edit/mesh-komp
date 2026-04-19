---
phase: 46
slug: targeted-reads-large-file-chunking
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 46 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | none — node:test requires no config |
| **Quick run command** | `node --test --test-force-exit test/targeted-read.test.cjs test/file-chunking.test.cjs` |
| **Full suite command** | `node --test --test-force-exit test/targeted-read.test.cjs test/file-chunking.test.cjs test/symbol-index.test.cjs test/call-site-resolution.test.cjs test/symbol-context-format.test.cjs test/symbol-incremental.test.cjs test/query-index-build.test.cjs test/query-index-search.test.cjs test/query-index-incremental.test.cjs test/capsule-exports.test.cjs test/capsule-calls.test.cjs test/capsule-imports.test.cjs test/file-roles.test.cjs` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-force-exit test/targeted-read.test.cjs test/file-chunking.test.cjs`
- **After every plan wave:** Run full suite command above
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 46-01-W0 | 01 | W0 | READ-01, READ-03 | stub | `node --test --test-force-exit test/targeted-read.test.cjs` | ❌ W0 | ⬜ pending |
| 46-01-01 | 01 | 1 | READ-01 | unit | `node --test --test-force-exit test/targeted-read.test.cjs` | ✅ | ⬜ pending |
| 46-01-02 | 01 | 1 | READ-03 | unit | `node --test --test-force-exit test/targeted-read.test.cjs` | ✅ | ⬜ pending |
| 46-02-W0 | 02 | W0 | READ-02, READ-04 | stub | `node --test --test-force-exit test/file-chunking.test.cjs` | ❌ W0 | ⬜ pending |
| 46-02-01 | 02 | 1 | READ-02 | unit | `node --test --test-force-exit test/file-chunking.test.cjs` | ✅ | ⬜ pending |
| 46-02-02 | 02 | 1 | READ-04 | unit | `node --test --test-force-exit test/file-chunking.test.cjs` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/targeted-read.test.cjs` — stubs for READ-01, READ-03
- [ ] `test/file-chunking.test.cjs` — stubs for READ-02, READ-04

*Both test files created in Wave 0 before implementation tasks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Route passes symbolName/chunkIndex from query params | All READ | Route wiring, no unit test | `curl "localhost:PORT/api/assistant/workspace/file?path=server.js&symbolName=startServer"` and verify `lineRange` in response |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
