---
phase: 33
slug: analytics-graph-real-data-visual-consistency
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-18
---

# Phase 33 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in) |
| **Config file** | package.json scripts.test |
| **Quick run command** | `node --test --test-force-exit --test-timeout=120000` |
| **Full suite command** | `node --test --test-force-exit --test-timeout=120000` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node --test --test-force-exit --test-timeout=120000`
- **After every plan wave:** Run `node --test --test-force-exit --test-timeout=120000`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 33-01-01 | 01 | 1 | ANLY-02 | grep | `grep -c "Operational data store initialized" src/core/index.js` → 0 | ✅ | ⬜ pending |
| 33-01-02 | 01 | 1 | ANLY-01 | grep | `grep "hasOpsData" assets/app-workspace.js` | ✅ | ⬜ pending |
| 33-01-03 | 01 | 1 | ANLY-01 | grep | `grep "Compression Analytics" assets/app-workspace.js` | ✅ | ⬜ pending |
| 33-02-01 | 02 | 1 | GRPH-01 | grep | `grep "'#e8a838'" assets/app-graph.js` → 0 | ✅ | ⬜ pending |
| 33-02-02 | 02 | 1 | GRPH-01 | grep | `grep "stroke-opacity.*0.3" assets/app-graph.js` | ✅ | ⬜ pending |
| 33-02-03 | 02 | 1 | GRPH-01 | grep | `grep "hover-glow" assets/app-graph.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ops section hides when empty | ANLY-01 | Visual DOM behavior | Open app, check that no ops summary cards appear when no real data exists |
| Dynamic title shows correct text | ANLY-01 | Visual text check | Verify title says "Compression Analytics" when no ops data |
| Empty state has icon + styled text | ANLY-01 | Visual styling | Open app with no workspace, verify centered icon + message |
| Graph nodes use muted colors | GRPH-01 | Visual color harmony | Open graph, verify nodes are desaturated and cohesive |
| Graph edges are subtle | GRPH-01 | Visual weight | Verify edges are thin and low-opacity |
| Hover glow appears on node | GRPH-01 | Interactive visual | Hover over a graph node, verify glow ring appears |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
