# Phase 31: UI Elements — Research

**Date:** 2026-04-17
**Status:** RESEARCH COMPLETE

## Root Cause Analysis

### UIEL-01: Pause/Stop Button — No abort mechanism exists

**Finding:** `assets/features/streaming-chat.js`'s `streamChat()` function (line ~60) uses `fetch()` + `ReadableStream` reader but has no `AbortController`. The `#btnSend` button is cloned and re-wired in this file (lines ~220–235). No stop button exists anywhere in the DOM.

**Implementation path:**
1. Add `let activeStreamAbort = null;` at module scope in `streaming-chat.js`
2. Inside `streamChat()`, create `const ctrl = new AbortController(); activeStreamAbort = ctrl;` before `fetch()`, pass `signal: ctrl.signal` to fetch options
3. Change `reader.read()` to handle `AbortError` gracefully (the reader throws `DOMException` with name `'AbortError'` when aborted)
4. Transform `#btnSend` to stop icon during streaming, restore in `finally`
5. Add module-level stop handler wired to `activeStreamAbort?.abort()`

**Stop icon SVG:** `<rect x="4" y="4" width="16" height="16" rx="2"/>` — filled square, 24×24 viewBox, `fill="currentColor"`

**Send icon SVG (restore):** `<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>` — existing arrow-up in `app.njk:467`

### UIEL-02: Agent Chat Close Gap — CSS grid column persists

**Finding:**
- `app-workspace.css:82`: `.ide { grid-template-columns: var(--ab-w) var(--sb-w) auto 1fr auto var(--ch-w) }` — 6 columns, last is `--ch-w: 380px`
- `toggleChat()` at `app-workspace.js:2024` only sets `display:none` on `#chatPanel` and `#rsChat`, never touches `--ch-w`
- `applyShellSnapshot()` at `app-workspace.js:412` has the same missing `--ch-w` management
- `resizer()` sets `--ch-w` via `document.documentElement.style.setProperty('--ch-w', value+'px')` — this is the correct API

**Fix:** In `toggleChat()` and `applyShellSnapshot()`, when hiding chat: `document.documentElement.style.setProperty('--ch-w', '0px')`. When showing: restore saved width or `document.documentElement.style.removeProperty('--ch-w')` (which falls back to CSS default of 380px). Save the pre-hide width in `S.chatWidth` so it survives toggle cycles.

**Note:** `applyShellSnapshot()` also applies `chatVisible` state on page load — it must also call `document.documentElement.style.setProperty('--ch-w', '0px')` when restoring a hidden-chat snapshot.

### UIEL-03: Agent Manager Button — Never wired, no panel

**Finding:**
- `#btnOpenAgentMgr` at `app.njk:147` (top-bar, right side) — no handler
- `#wAgentMgr` at `app.njk:248` (welcome screen sidebar) — no handler  
- Neither appears in `bind()` or `registerDefaultShellActions()` at `app-workspace.js:2048`
- No agent manager panel/modal exists anywhere in the codebase

**Implementation path:**
1. In `registerDefaultShellActions()`, add `registerShellAction('agent-manager:open', openAgentManagerStub);`
2. In `bind()`, add `wireShellAction('#btnOpenAgentMgr', 'agent-manager:open')` + `wireShellAction('#wAgentMgr', 'agent-manager:open')`
3. Define `function openAgentManagerStub()` — creates a modal overlay with "Agent Manager" title and "Coming in a future update" copy

**Modal implementation:** Lightweight inline approach — create `div.agent-mgr-overlay` + `div.agent-mgr-modal` dynamically, append to `document.body`, wire close button and overlay-click-to-close. No new library needed. Style consistent with existing modals (`bg2`, `bd` border, `tx` text, `ac` accent).

### UIEL-04: Context Window Display — Init timing issue

**Finding:**
- `context-budget.js:87`: `budgetData.limit = getActiveModelLimit()` IS called on init, but only when `modelSel` (the `#chatModel` element) is found
- `context-budget.js:64`: `init()` retries if `!window.MeshState` — good
- BUT: `context-budget.js:73`: widget innerHTML sets `0k / 128k` as the initial label before `recalc()` is called
- The `fetchBudget()` call at line 102 (`setTimeout(fetchBudget, 3000)`) will call `recalc()` after 3 seconds, which updates the label
- **Real issue:** `recalc()` is NOT called immediately after setting `budgetData.limit` in `init()`. The widget shows `0k / 128k` until the 3s `fetchBudget` fires or a chat response arrives.
- **Fix:** In `init()`, after setting `budgetData.limit = getActiveModelLimit()` (line 87), immediately call `recalc()`.

### UIEL-05 & UIEL-06: Duplicate Controls

**Finding:**
- DOM has exactly ONE `#modeDropWrap` and ONE `#modelDropWrap` in `app.njk`
- The hidden `<select id="chatMode">` and `<select id="chatModel">` have `style="display:none"` as inline styles
- `app-workspace.css:69`: `input,select,textarea { font:inherit;color:inherit }` — no display override
- No JavaScript removes the `style="display:none"` attribute
- **Hypothesis:** Some browsers (particularly older Safari or Firefox) may render `<select>` elements with `style="display:none"` differently when inside a flex container. The `display:none` may not apply consistently.
- **Definitive fix:** Add to `app-workspace.css`: `.chat-in-row select { display: none !important; }` — this CSS rule takes priority over any browser quirk or inline style conflict
- **Secondary check:** Verify the `initCiDrop` inline script (`app.njk:591`) isn't removing the `style` attribute — it doesn't: it only reads `sel.value` and adds a `change` listener.

## Implementation Map

| Bug | File(s) | Lines | Approach |
|-----|---------|-------|----------|
| UIEL-01 Stop button | `assets/features/streaming-chat.js` | ~60–230 | AbortController + button transform |
| UIEL-02 Chat gap | `assets/app-workspace.js` | 2024, 412–417 | Set `--ch-w: 0` on toggle+restore |
| UIEL-03 Agent manager | `assets/app-workspace.js` | 2048, 2076 | registerShellAction + stub modal |
| UIEL-04 Context window | `assets/features/context-budget.js` | 63–90 | Call recalc() after init |
| UIEL-05/06 Duplicates | `assets/app-workspace.css` | new rule | `display:none !important` |

## Wave Planning

- **Wave 1:** UIEL-02 (chat gap), UIEL-03 (agent manager), UIEL-04 (context window), UIEL-05/06 (duplicate controls) — all in `app-workspace.js`, `app-workspace.css`, `context-budget.js` — independent changes
- **Wave 2:** UIEL-01 (stop button) — in `streaming-chat.js` — depends on nothing but is the most complex; isolated in its own plan

## Validation Architecture

Test manually by:
1. UIEL-01: Send a message, immediately click stop → partial text remains, send button restores
2. UIEL-02: Click toggle-chat button → no gap in layout
3. UIEL-03: Click "Open Agent Manager" → modal appears
4. UIEL-04: Page load → context budget shows 200k for Claude Sonnet (not 128k)
5. UIEL-05/06: Chat input area shows exactly one mode pill and one model pill
