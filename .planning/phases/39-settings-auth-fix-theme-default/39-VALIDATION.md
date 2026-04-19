---
phase: 39
slug: settings-auth-fix-theme-default
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-19
---

# Phase 39 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in test runner (`node --test`) |
| **Config file** | none — tests run directly |
| **Quick run command** | `node --test --test-force-exit --test-timeout=30000 tests/` |
| **Full suite command** | `node --test --test-force-exit --test-timeout=120000` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-force-exit --test-timeout=30000 tests/`
- **After every plan wave:** Run full suite
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 39-01-01 | 01 | 1 | SETT-04 | manual | grep `res.redirect('/app?login=1')` src/server.js | ✅ | ⬜ pending |
| 39-01-02 | 01 | 1 | SETT-04 | manual | grep `showSettingsAuthWarning` assets/settings.js → 0 matches | ✅ | ⬜ pending |
| 39-01-03 | 01 | 1 | SETT-05 | manual | grep `theme: "system"` assets/settings.js | ✅ | ⬜ pending |
| 39-02-01 | 02 | 2 | SETT-05 | manual | grep `\|\|'system'` views/settings.njk | ✅ | ⬜ pending |
| 39-02-02 | 02 | 2 | SETT-05 | manual | grep `value="system" selected` views/settings.njk | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — no new test files needed. These are targeted bug fixes verifiable by grep and manual browser test.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Unauthenticated `/settings` redirects to `/app?login=1` | SETT-04 | Requires running server + browser | Clear cookies, visit /settings, confirm redirect URL |
| Authenticated `/settings` loads normally | SETT-04 | Requires active session | Log in, visit /settings, confirm settings page loads |
| Dark OS → dark theme on first load | SETT-05 | Requires OS dark mode toggle | Clear localStorage, enable OS dark mode, visit /settings, confirm `data-theme="dark"` on `<html>` |
| Light OS → light theme on first load | SETT-05 | Requires OS light mode toggle | Clear localStorage, enable OS light mode, visit /settings, confirm `data-theme="light"` |
| Saved theme overrides OS preference | SETT-05 | Requires localStorage state | Save `theme: "light"` in settings, switch OS to dark, reload, confirm light stays |

---

## Validation Sign-Off

- [ ] All tasks have grep-verifiable acceptance criteria
- [ ] Manual browser verification covers auth redirect and theme flash
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set in frontmatter when all checks pass

**Approval:** pending
