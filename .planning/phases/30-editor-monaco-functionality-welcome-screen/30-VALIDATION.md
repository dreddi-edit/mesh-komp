---
phase: 30
slug: editor-monaco-functionality-welcome-screen
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 30 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` (existing project pattern) |
| **Config file** | none — vanilla Node test runner |
| **Quick run command** | `node --test --test-force-exit --test-timeout=30000 tests/` |
| **Full suite command** | `node --test --test-force-exit --test-timeout=120000` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-force-exit --test-timeout=30000`
- **After every plan wave:** Run `node --test --test-force-exit --test-timeout=120000`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Status |
|---------|------|------|-------------|-----------|-------------------|--------|
| 30-01-01 | 01 | 1 | EDIT-03 | manual | check `updateIndexProgressState` has `S.dirHandle` guard | ⬜ pending |
| 30-02-01 | 02 | 1 | EDIT-01 | manual | check `initMonaco` uses `setInterval` polling | ⬜ pending |
| 30-03-01 | 03 | 2 | EDIT-02 | manual | `grep 'meshRecentWorkspaces' src/core/auth.js` exits 0 | ⬜ pending |
| 30-03-02 | 03 | 2 | EDIT-02 | manual | `grep 'saveRecentWorkspace' assets/app-workspace.js` exits 0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — changes are frontend JS/HTML and a backend allowlist addition. No new test files required for this phase. Validation is via grep + browser smoke test.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Monaco syntax highlighting | EDIT-01 | Requires browser CDN load | Open app → open .js file → confirm colored syntax |
| Recent workspaces display | EDIT-02 | Requires browser session + idb | Open 3 folders → reload → confirm 3 ws-items shown |
| Indexing indicator hidden on load | EDIT-03 | Requires browser session state | Load app with no folder → confirm no idxProgWrap visible |
| Recent workspace click | EDIT-02 | Requires browser permission dialog | Click recent ws → confirm browser permission prompt → folder loads |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
