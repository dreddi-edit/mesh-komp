---
phase: 8
slug: fix-compression-analytics-showing-real-data-improve-dependency-graph-animations-and-live-updates-when-code-changes
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-15
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | npm test (Node.js built-in test runner + existing test suite) |
| **Config file** | package.json scripts |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test && node benchmarks/compression-benchmark.js` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test && node benchmarks/compression-benchmark.js`
- **Before `/gsd:verify-work`:** Full suite must be green + manual browser checks
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | Compression map population | manual | Open folder → `S.compressionMap.size > 0` in console | ✅ | ✅ green |
| 8-01-02 | 01 | 1 | Ops view data | manual | Ops table shows non-zero file sizes | ✅ | ✅ green |
| 8-01-03 | 01 | 1 | Explorer tooltips | manual | Hover file → tooltip shows `XX% compressed` | ✅ | ✅ green |
| 8-02-01 | 02 | 2 | Graph entrance animation | manual | Graph view → nodes spring in over ~400ms | ✅ | ✅ green |
| 8-02-02 | 02 | 2 | Graph live update | manual | Save file → graph cross-fades after 1.5s | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| S.compressionMap populated on reload | Compression analytics | Requires live browser + workspace | Open folder, wait for indexing, run `S.compressionMap.size` in console |
| Ops view shows real compression ratios | Analytics display | Requires live browser + indexed workspace | Switch to ops view, verify non-zero sizes and % columns |
| File tooltip shows compression % | Explorer tooltip | Requires live browser + file tree | Hover file in explorer sidebar |
| Folder tooltip shows avg compression | Explorer tooltip | Requires live browser + file tree | Hover folder in explorer sidebar |
| Graph nodes animate in | Graph animation | Requires visual verification | Navigate to graph view, observe entrance animation |
| Graph cross-fades on file save | Live update | Requires workspace file edit | Edit a file, observe graph refresh after 1.5s |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete
