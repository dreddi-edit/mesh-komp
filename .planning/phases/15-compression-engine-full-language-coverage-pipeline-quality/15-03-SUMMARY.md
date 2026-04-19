---
phase: 15-compression-engine-full-language-coverage-pipeline-quality
plan: "03"
subsystem: compression
tags: [heuristic, fallback, symbol-extraction, regex]

requires:
  - phase: "15-01"
    provides: "dependency foundation"
  - phase: "15-02"
    provides: "tree-sitter registered grammars (fallback bypassed for those)"
provides:
  - buildTextFallbackCapsule with regex symbol extraction for unknown languages
  - SYMBOL_PATTERNS covering Rust, Elixir, Ruby, C-style, JS/TS function, class/struct/trait
  - Sections named "symbols" and "outline" produced (was only "outline")
  - fallbackReason distinguishes symbol extraction vs plain text
affects: [15-04-tests]

tech-stack:
  added: []
  patterns: [regex pattern array with nameGroup metadata, deduped-by-text symbols, 12-line text fallback within fallback]

key-files:
  created: []
  modified:
    - mesh-core/src/compression-core.cjs

key-decisions:
  - "buildTextFallbackCapsule is the catch-all for family values outside code/config/sql/markup/docs — unknown extensions map to docs/text and go through buildDocsCapsule first"
  - "7 regex patterns chosen to cover major language families without conflicting — stop at first match per line"
  - "Inner fallback: if no symbols found, show first 12 non-empty lines (was 20 in original)"

patterns-established:
  - "Regex symbol extraction: pattern array with re/nameGroup/kind, seenNames dedup, spanManager.addLineSpan"

requirements-completed: []

duration: 15min
completed: 2026-04-16
---

# Phase 15 Plan 03: Heuristic Fallback Improvement

**Replaced the plain-text line-dump fallback with a 7-pattern regex symbol extractor — unknown language files now produce named symbols instead of raw text lines.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-04-16T13:25:00Z
- **Completed:** 2026-04-16T13:40:00Z
- **Tasks:** 1 completed
- **Files modified:** 1

## Accomplishments

### Task 03-01: Replace buildTextFallbackCapsule
- Replaced 20-line plain-text dump with regex-based SYMBOL_PATTERNS array
- 7 patterns: Rust fn, Python def, Elixir def/defp, C++ method, generic function, JS export function, class/struct/trait/protocol
- Produces `symbols` section (P0) when patterns match, `outline` section (P1) when they don't
- `fallbackReason` now distinguishes symbol extraction vs pure text fallback

## Self-Check: PASSED

- SYMBOL_PATTERNS present in compression-core.cjs
- "heuristic symbol extraction" string present  
- Module loads cleanly
