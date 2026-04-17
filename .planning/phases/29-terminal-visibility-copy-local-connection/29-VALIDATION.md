---
phase: 29
slug: terminal-visibility-copy-local-connection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-17
---

# Phase 29 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node --test (built-in, no install needed) |
| **Config file** | none — uses existing `npm test` script |
| **Quick run command** | `node --test --test-force-exit --test-timeout=30000 test/terminal*.js 2>/dev/null` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run quick command above
- **After every plan wave:** Run full suite (`npm test`)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 29-01-01 | 01 | 1 | TERM-01 | grep | `grep -n "foreground:'#c8e6f0'" assets/app-workspace.js` | ✅ | ⬜ pending |
| 29-01-02 | 01 | 1 | TERM-01 | grep | `grep -n "cursor:'#00d4ff'" assets/app-workspace.js` | ✅ | ⬜ pending |
| 29-02-01 | 02 | 1 | TERM-02 | grep | `grep -n "attachCustomKeyEventHandler" assets/app-workspace.js` | ✅ | ⬜ pending |
| 29-02-02 | 02 | 1 | TERM-02 | grep | `grep -n "hasSelection" assets/app-workspace.js` | ✅ | ⬜ pending |
| 29-03-01 | 03 | 1 | TERM-01 | grep | `grep -n "ResizeObserver" assets/app-workspace.js` | ✅ | ⬜ pending |
| 29-04-01 | 04 | 2 | TERM-03 | grep | `grep -rn "terminal-agent" src/routes/terminal.routes.js` | ✅ | ⬜ pending |
| 29-04-02 | 04 | 2 | TERM-03 | grep | `grep -n "createAgentToken\|findAgentToken" secure-db.js` | ✅ | ⬜ pending |
| 29-05-01 | 05 | 2 | TERM-03 | file | `test -f packages/mesh-local/package.json && echo PASS` | ❌ W0 | ⬜ pending |
| 29-05-02 | 05 | 2 | TERM-03 | file | `test -f packages/mesh-local/bin/mesh-local.js && echo PASS` | ❌ W0 | ⬜ pending |
| 29-06-01 | 06 | 2 | TERM-03 | grep | `grep -n "agent-token\|agentToken" src/routes/auth.routes.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/mesh-local/` directory created with scaffolded `package.json`
- [ ] `packages/mesh-local/bin/mesh-local.js` stub created (so file-existence checks pass)
- [ ] `packages/mesh-local/src/agent.js` stub created
- [ ] `packages/mesh-local/src/protocol-register.js` stub created

*Wave 0 creates directory/file stubs so later tasks can fill them in without breaking grep-based existence checks.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Terminal text appears in teal color (#c8e6f0) against dark background | TERM-01 | Visual rendering — needs browser | Open workspace, click Terminal, verify text is light teal on dark background |
| Cmd+C with text selected copies to clipboard, not sends SIGINT | TERM-02 | Clipboard interaction — needs browser | Select text in terminal, press Cmd+C, paste elsewhere — should get text not kill process |
| Click-drag selects text | TERM-02 | Mouse interaction — needs browser | Click-drag in terminal, verify text highlights |
| mesh:// link opens local agent on click | TERM-03 | OS protocol handler — needs manual setup | Install mesh-local, click mesh:// link in connect dialog, verify agent starts |
| Terminal shows local hostname after agent connects | TERM-03 | Requires running agent | Run mesh-local, open terminal in Mesh, verify prompt shows local machine hostname |
| Terminal reflows correctly when panel is resized | TERM-01/resize | Visual — needs browser | Resize the terminal panel, verify content reflows without distortion |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
