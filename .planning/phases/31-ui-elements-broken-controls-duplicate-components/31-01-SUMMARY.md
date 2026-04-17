---
phase: "31"
plan: "31-01"
subsystem: frontend-ui
tags: [ui-fix, css, chat-panel, agent-manager, context-budget]
requires: []
provides: [chat-panel-gap-fix, agent-manager-modal, context-budget-init, chat-in-row-selects-hidden]
affects: [assets/app-workspace.js, assets/app-workspace.css, assets/features/context-budget.js]
tech-stack:
  added: []
  patterns: [css-custom-property-layout, shell-action-registry, dom-creation-no-innerhtml]
key-files:
  created: []
  modified:
    - assets/app-workspace.js
    - assets/app-workspace.css
    - assets/features/context-budget.js
key-decisions:
  - Use --ch-w CSS var (set to 0px) instead of toggling display:none on the grid column — cleaner reflow, no JavaScript knowledge of adjacent elements required
  - openAgentManagerStub uses DOM creation methods (no innerHTML) to avoid XSS surface area
requirements-completed: [UIEL-02, UIEL-03, UIEL-04, UIEL-05, UIEL-06]
duration: "2 min"
completed: "2026-04-17"
---

# Phase 31 Plan 01: Layout, Agent Manager, Context Display, Duplicate Controls Summary

Fixed five UI bugs via 4 targeted changes: chat panel close now collapses the CSS grid column via `--ch-w: 0px`, Agent Manager buttons open a functional stub modal, context budget label correctly shows the active model's context window on load, and native `<select>` elements are hidden in `.chat-in-row`.

**Duration:** 2 min | **Tasks:** 4 | **Files:** 3

## Tasks Completed

| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | Fix Chat Panel Close Gap (UIEL-02) | ✓ | eacfb1a |
| 2 | Wire Agent Manager Buttons and Add Stub Modal (UIEL-03) | ✓ | 6709355 |
| 3 | Fix Context Window Display on Init (UIEL-04) | ✓ | b1f2fa7 |
| 4 | Fix Duplicate Mode/Model Selects (UIEL-05/06) | ✓ | b353c3c |

## What Was Built

- **toggleChat**: Saves `--ch-w` before hiding, restores on show. The CSS grid column width collapses to 0px rather than leaving a gap.
- **applyShellSnapshot**: When restoring hidden chat state from snapshot, ensures `--ch-w` is set to 0px.
- **ensureChatVisible**: Restores `--ch-w` from `S._savedChatWidth` when force-showing the panel.
- **openAgentManagerStub**: Overlay modal created via DOM methods (no innerHTML). Closes on backdrop click or Close button. Registered as `agent-manager:open` shell action; wired to `#btnOpenAgentMgr` and `#wAgentMgr`.
- **context-budget.js init**: `recalc()` called immediately after `getActiveModelLimit()` so the status bar widget shows the correct `0k / 200k` label without waiting for the 10s poll.
- **CSS**: `.chat-in-row select{display:none!important}` eliminates native select elements behind the custom pill dropdowns.

## Deviations from Plan

None - plan executed exactly as written.

## Next

Ready for Plan 31-02: Stop Button for Streaming Chat.

## Self-Check: PASSED
