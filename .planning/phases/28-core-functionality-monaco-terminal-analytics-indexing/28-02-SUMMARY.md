---
status: complete
plan: 28-02
title: "Fix Monaco editor interactivity and CSP blob workers"
---

# Summary: 28-02 Fix Monaco Editor Interactivity and CSP Blob Workers

## What was built
- Added `'unsafe-eval'` to CSP `scriptSrc` — required by Monaco's parser/tokenizer
- Added `childSrc: ["'self'", "blob:"]` as fallback for older browsers
- Added zero-dimension guard in `createEditor()` with `requestAnimationFrame` retry
- Added `min-height: 200px` to `.ed-pane` CSS rule
- Modified `openFile()` to eagerly create Monaco models when `S.monacoReady` is true
- Added truncation warning diagnostic log

## key-files
### created
(none)
### modified
- src/server.js
- assets/app-workspace.js
- assets/app-workspace.css

## Deviations
None — implemented as planned.

## Self-Check: PASSED
- [x] CSP includes unsafe-eval and child-src blob:
- [x] createEditor checks offsetWidth/offsetHeight
- [x] .ed-pane has min-height
- [x] openFile creates model eagerly
