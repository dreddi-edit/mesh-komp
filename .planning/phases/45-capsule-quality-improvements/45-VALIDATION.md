---
phase: 45
slug: capsule-quality-improvements
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node:test`) |
| **Config file** | none — uses `node --test` directly |
| **Quick run command** | `node --test --test-force-exit test/capsule-exports.test.cjs` |
| **Full suite command** | `node --test --test-force-exit test/capsule-exports.test.cjs test/capsule-calls.test.cjs test/capsule-imports.test.cjs test/file-roles.test.cjs` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick run command for the plan being executed
- **After every plan wave:** Run full suite command
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 45-01-W0 | 01 | W0 | CAP-01 | stub | `node --test --test-force-exit test/capsule-exports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-01-01 | 01 | 1 | CAP-01 | unit | `node --test --test-force-exit test/capsule-exports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-01-02 | 01 | 1 | CAP-01 | unit | `node --test --test-force-exit test/capsule-exports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-01-03 | 01 | 1 | CAP-01 | unit | `node --test --test-force-exit test/capsule-exports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-02-W0 | 02 | W0 | CAP-02, CAP-03 | stub | `node --test --test-force-exit test/capsule-calls.test.cjs test/capsule-imports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-02-01 | 02 | 1 | CAP-02 | unit | `node --test --test-force-exit test/capsule-calls.test.cjs` | ❌ W0 | ⬜ pending |
| 45-02-02 | 02 | 1 | CAP-03 | unit | `node --test --test-force-exit test/capsule-imports.test.cjs` | ❌ W0 | ⬜ pending |
| 45-03-W0 | 03 | W0 | CAP-04 | stub | `node --test --test-force-exit test/file-roles.test.cjs` | ❌ W0 | ⬜ pending |
| 45-03-01 | 03 | 2 | CAP-04 | unit | `node --test --test-force-exit test/file-roles.test.cjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/capsule-exports.test.cjs` — stubs for CAP-01 (exports section, isExported)
- [ ] `test/capsule-calls.test.cjs` — stubs for CAP-02 (calls section)
- [ ] `test/capsule-imports.test.cjs` — stubs for CAP-03 (resolved-imports section)
- [ ] `test/file-roles.test.cjs` — stubs for CAP-04 (file role classification)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Capsule renders correctly in Mesh IDE chat | CAP-01..03 | Requires running workspace and browser | Open a JS file with exports; inspect capsule in chat context |
| .mesh/files.md includes File Roles table | CAP-04 | Requires provisionMeshFolder | Run workspace sync, check .mesh/files.md |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
