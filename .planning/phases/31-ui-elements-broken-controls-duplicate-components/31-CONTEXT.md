# Phase 31: UI Elements — Broken Controls & Duplicate Components - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Six targeted UI fixes in `views/app.njk`, `assets/app-workspace.js`, and `assets/features/` — all brownfield patches to existing surfaces. No new features, no new routes, no backend changes. Every fix is scoped to one element's behavior or one layout bug.

</domain>

<decisions>
## Implementation Decisions

### UIEL-01: Pause/Stop Button

- **D-01:** No stop button exists at all. The `sendChat` function in `app-workspace.js` has no `AbortController`, and `assets/features/streaming-chat.js` (which overrides it) also has no abort mechanism.
- **D-02:** The send button (`#btnSend`) transforms into a stop button while the AI is streaming — same button, different icon/action. Returns to send icon when streaming ends. This is the VS Code / ChatGPT pattern with no layout shift.
- **D-03:** Abort behavior: call `reader.cancel()` on the fetch `ReadableStream` reader to cut the stream. Whatever text has already streamed stays as the assistant message (partial response kept, not discarded).
- **D-04:** Implementation location: `assets/features/streaming-chat.js` — this is where `streamChat()` lives and where `#btnSend` is already cloned/re-wired. Add `AbortController` inside `streamChat`, expose a module-level `let activeStreamAbort = null`, set `#btnSend` to a stop icon + abort handler during streaming, restore it in `finally`.
- **D-05:** Stop icon: a filled square `■` SVG (stop/halt symbol). Standard across VS Code, ChatGPT, Claude.

### UIEL-02: Agent Chat Close Gap

- **D-06:** Root cause: grid `grid-template-columns` uses `var(--ch-w)` (380px) as the last column. When `toggleChat()` sets `display:none` on `#chatPanel` and `#rsChat`, the column still reserves 380px. This is the gap.
- **D-07:** Fix: when hiding chat, also set `--ch-w: 0` on `:root` (or `#ide`). When showing chat, restore `--ch-w` to its previous value (default 380px or user-resized value). This collapses the grid column, eliminating the gap.
- **D-08:** No animation — snap closed immediately. Consistent with how `#btnToggleSB` / sidebar toggle works.
- **D-09:** The resizer handle `#rsChat` stays visible (user's preference). Its width is controlled by its own CSS, not `--ch-w`, so it naturally hangs at the edge of the editor when chat is hidden.

### UIEL-03: "Open Agent Manager" Button

- **D-10:** Both `#btnOpenAgentMgr` (top-bar) and `#wAgentMgr` (welcome screen sidebar) are never wired in `bind()`. No shell action exists for `agent-manager:open`. No agent manager panel/modal exists in the codebase.
- **D-11:** Both buttons should open a small centered stub modal with "Agent Manager — Coming Soon" messaging. Better UX than a dead click — user knows the button is functional, the feature is just not built yet.
- **D-12:** Implementation: wire both buttons in `bind()` via `registerShellAction('agent-manager:open', openAgentManagerStub)` + `wireShellAction('#btnOpenAgentMgr', 'agent-manager:open')` + `wireShellAction('#wAgentMgr', 'agent-manager:open')`. The stub function shows a simple modal overlay with a title, description, and close button. Use the existing `toast()` pattern for simplicity OR a lightweight inline modal div (no new library).

### UIEL-04: Context Window Indicator

- **D-13:** `context-budget.js` correctly maps models to context window sizes via `MODEL_CONTEXT_WINDOWS` (Claude Sonnet → 200k). The custom pill dropdown (`initCiDrop`) already dispatches a `change` event on the hidden `#chatModel` select when a model is picked (line 623 of `app.njk`). So the event propagation is NOT broken.
- **D-14:** The actual bug: on initial page load, `budgetData.limit = DEFAULT_CONTEXT_WINDOW (128000)` before any model change event fires. The widget shows "0k / 128k" even though the selected model is Claude Sonnet (200k). Fix: in `context-budget.js`'s `init()` function, call `budgetData.limit = getActiveModelLimit()` immediately after the model selector is found (already set on line 87, but only if `modelSel` exists — this should work; investigate if `#chatModel` isn't found on init timing). If timing is the issue, add a `setTimeout(() => { budgetData.limit = getActiveModelLimit(); recalc(); }, 0)` fallback.

### UIEL-05 & UIEL-06: Duplicate Model Selector and Mode Options

- **D-15:** The DOM has only one `#modeDropWrap` and one `#modelDropWrap`. However, the user confirms visual duplicates appear at runtime. The hidden `<select id="chatMode">` and `<select id="chatModel">` elements (both with `style="display:none"`) may be rendered visible in some conditions. 
- **D-16:** Fix path: (1) Add a CSS rule `.chat-in-row select { display: none !important; }` to `app-workspace.css` as a hard fallback. (2) Verify no JS code removes the `display:none` style from these selects. (3) Check if the `initCiDrop` inline script fails silently (e.g., runs before DOMContentLoaded) in a way that leaves the native selects unstyled.
- **D-17:** The `initCiDrop` script already uses `document.addEventListener('DOMContentLoaded', ...)` — timing is correct. The most likely culprit is a CSS specificity conflict or a browser rendering the `style="display:none"` attribute inconsistently inside a flex container. The CSS `!important` fix + a defensive check that the elements are hidden in JS is the right approach.

### Claude's Discretion

- Exact SVG path for the stop button icon (filled square or circle-stop)
- Whether to use a full overlay modal or a small dialog element for the agent manager stub
- Whether `--ch-w` is set on `:root` or `document.documentElement.style` in `toggleChat()`
- Exact CSS selector for hiding the duplicate selects

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary Files to Modify

- `assets/app-workspace.js` — `toggleChat()` at line 2024, `bind()` at line 2076, shell action registration
- `assets/features/streaming-chat.js` — `streamChat()`, `#btnSend` clone/re-wire (lines 210–230)
- `assets/features/context-budget.js` — `init()` at line 63, `getActiveModelLimit()` at line 53
- `assets/app-workspace.css` — `.ci-drop`, `.chat-panel`, CSS var `--ch-w` at line 11
- `views/app.njk` — top-bar (`#btnOpenAgentMgr` at line 147), welcome screen (`#wAgentMgr` at line 248), chat input area (lines 427–468)

### Patterns to Follow

- `assets/app-workspace.js` `registerShellAction`/`wireShellAction` pattern (lines 2070–2095) — how buttons are connected to named actions
- `assets/app-workspace.js` `toast(title, msg)` function — for lightweight user feedback
- `assets/app-workspace.css` `:root` CSS vars block at line 11 — `--ab-w`, `--sb-w`, `--ch-w`, etc.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `registerShellAction` / `wireShellAction` in `app-workspace.js` — the established pattern for wiring buttons to named actions. Use for `agent-manager:open`.
- `toggleChat()` at `app-workspace.js:2024` — already does `display:none` on `#chatPanel` and `#rsChat`. Extend it to also manage `--ch-w`.
- `toast(title, msg)` in `app-workspace.js` — available for lightweight feedback.
- `initCiDrop` inline script in `app.njk` (lines 593–657) — already fires `change` event correctly.
- `context-budget.js` `MODEL_CONTEXT_WINDOWS` map — already correct (Claude Sonnet → 200k).

### Established Patterns

- Grid layout: `--ch-w` CSS variable controls chat panel column width. Setting it to 0 on toggle is the right approach (mirrors how `--sb-w` could hypothetically be zeroed for sidebar hide).
- Feature JS files (`assets/features/*.js`) use `waitForReady()` + `window.MeshBus` for loose coupling. Streaming-chat.js is the correct place for abort logic.
- Shell actions: every button click goes through `registerShellAction` → `wireShellAction`. The agent manager button must follow this pattern.

### Integration Points

- `streaming-chat.js` overrides `#btnSend` by cloning it (line ~220). The stop button transform must happen inside `streamChat()` after the clone, not in `bind()`.
- `context-budget.js` listens on `window.MeshBus` for `'chat:response'` events. The `#chatModel` change event is dispatched from `initCiDrop` — already correct.
- The grid definition in `app-workspace.css:82` controls all column widths. `--ch-w` modification must happen via `document.documentElement.style.setProperty('--ch-w', '0px')`.

</code_context>

<specifics>
## Specific Ideas

- Stop button icon: filled square (■) — SVG `<rect>` element, same size as the existing send arrow (16×16)
- Agent Manager modal: minimal centered overlay, title "Agent Manager", subtitle "Coming in a future update", close button. No external dependencies.
- The `--ch-w` restore value should be saved before zeroing it so the panel reopens at the same width as before.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 31-ui-elements-broken-controls-duplicate-components*
*Context gathered: 2026-04-17*
