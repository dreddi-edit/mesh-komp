# Phase 31: UI Elements — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 31 — UI Elements: Broken Controls & Duplicate Components
**Areas discussed:** Pause/Stop button, Agent chat close gap, Agent Manager button, Context window display

---

## Pause/Stop Button

| Option | Description | Selected |
|--------|-------------|----------|
| Replace Send while streaming | Send button transforms to stop during AI response, returns to send when done. VS Code / ChatGPT pattern. | ✓ |
| Always-visible in chat header | Persistent stop icon next to New/History/More buttons. Always present but grayed when idle. | |
| Inline in streaming message | Small stop button in the in-progress message bubble. | |

**User's choice:** Replace Send while streaming

| Option | Description | Selected |
|--------|-------------|----------|
| Cut stream, keep partial response | Abort fetch, keep streamed text as assistant message. | ✓ |
| Cut stream, discard partial response | Abort and remove partial message entirely. | |
| Soft-stop: finish current sentence | Not feasible with SSE — noted as non-option. | |

**User's choice:** Cut stream, keep partial response

---

## Agent Chat Close Gap

| Option | Description | Selected |
|--------|-------------|----------|
| Snap closed, no animation | Set --ch-w to 0, display:none immediately. Consistent with sidebar toggle. | ✓ |
| Slide closed with CSS transition | Animate --ch-w from 380px to 0 over ~200ms. Smoother but adds timing complexity. | |

**User's choice:** Snap closed, no animation

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — hide resizer too | Resizer vanishes when chat is hidden. | |
| Leave it visible | Resizer stays at edge of editor when chat is hidden. | ✓ |

**User's choice:** Leave resizer visible

---

## Agent Manager Button

| Option | Description | Selected |
|--------|-------------|----------|
| Open a stub modal with 'Coming Soon' | Wire both buttons to a centered modal explaining the feature is coming. | ✓ |
| Show a toast notification | Flash a brief toast: 'Agent Manager — coming soon'. | |
| Build a real minimal panel now | Create a basic panel showing connected agents. More work. | |

**User's choice:** Stub modal with 'Coming Soon'

---

## Context Window Display / Duplicate Dropdowns

| Option | Description | Selected |
|--------|-------------|----------|
| Dispatch synthetic change event | sel.dispatchEvent(new Event('change')) after sel.value assignment. | ✓ (already done in code) |
| Use MeshBus to broadcast model change | Emit custom event on MeshBus. | |

**Notes:** Code investigation revealed initCiDrop already dispatches the change event (line 623 of app.njk). Real bug is initial load showing 128k instead of 200k for Claude Sonnet. Fix: ensure getActiveModelLimit() is called on init before any events fire.

**Duplicate dropdowns:**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, visually duplicated | User confirms seeing two dropdowns in the app | ✓ |
| Already partially fixed | Hidden selects were visible at some point | |
| Hidden selects are showing | Browser rendering issue with display:none in flex | |

**Notes:** DOM has only one set. CSS `!important` fix on hidden selects + defensive JS check identified as fix path.

---

## Claude's Discretion

- Stop button icon (filled square SVG)
- Agent Manager modal DOM structure
- CSS custom property management approach for --ch-w
- Exact selector for hiding duplicate selects

## Deferred Ideas

None
