# ccmon — Claude Code Terminal Dashboard

**Date:** 2026-04-08  
**Status:** Approved  

---

## Overview

`ccmon` is a standalone Node.js CLI that renders a full-screen terminal dashboard for monitoring Claude Code sessions in real time. It watches Claude Code's local JSONL session files, parses usage data, and displays live stats alongside accumulated historical totals — all in a single `ccmon.js` file using `neo-blessed`.

It is read-only and entirely independent of the `mesh-komp` server. No API calls, no external dependencies beyond `neo-blessed`.

---

## Goals

- Watch token usage, cost, speed, and context window fill in real time while Claude Code is running
- Show accumulated totals across all past sessions (daily / weekly / monthly / all-time)
- Require zero setup: `node ccmon.js` and it works
- Single-file implementation, no build step

---

## Data Source

Claude Code writes one JSONL file per session under:

```
~/.claude/projects/<project-hash>/sessions/<session-id>.jsonl
```

Each line is a JSON object. The relevant fields are:

```json
{
  "type": "assistant",
  "usage": {
    "input_tokens": 2430,
    "output_tokens": 380,
    "cache_read_input_tokens": 3200,
    "cache_creation_input_tokens": 800
  },
  "model": "claude-sonnet-4-6",
  "timestamp": "2026-04-08T12:05:44.000Z",
  "costUSD": 0.04
}
```

**Startup:** Read all existing JSONL files recursively to build accumulated stats.  
**Live:** Use `fs.watch` on `~/.claude/projects/` with recursive mode. On each change, re-read the tail of the modified file and append new events.  
**Fallback:** Poll every 500ms for environments where `fs.watch` recursive mode is unreliable (Linux).

**Session boundary detection:** A new session file = a new session. Sessions are grouped by file path. Gap-based detection (>30 min between events) is used as a secondary heuristic if needed.

---

## Layout

Full-screen `neo-blessed` layout. All boxes use `setContent()` for updates — no full re-render.

```
┌─────────────────────────────────────────────────────────────────┐
│ titlebar: ccmon — mesh-komp / claude-sonnet-4-6          [LIVE] │
├──────────┬──────────┬──────────┬──────────┬──────────┬──────────┤
│ TOKENS   │ TOKENS   │ CACHE    │ CACHE    │ COST     │ SPEED    │
│  IN      │  OUT     │  READ    │  WRITE   │          │          │
│ 124,830  │ 18,420   │ 98,200   │ 24,100   │ $0.84    │ 42 t/s   │
│ sparkline│ sparkline│ sparkline│ sparkline│ sparkline│ sparkline│
├──────────┴──────────┴──────────┴──────────┴──────────┴──────────┤
│ CONTEXT WINDOW ████████████████████████░░░░░░░░  68.1%  64k free│
├──────────────────┬──────────────────┬───────────────────────────┤
│ TOKEN BREAKDOWN  │ PERFORMANCE      │ DAILY COST (7 days)       │
│ input   124,830  │ 42 t/s           │ ▄ ▇ ▂ ▁ ▅ █ ▇            │
│ output   18,420  │ latency  1.2s    │ W T F S S M T             │
│ c.read   98,200  │ peak    61 t/s   │                           │
│ c.write  24,100  │ requests    34   │ 7d avg $2.41/day          │
│ ─────────────── │ requests    34   │                           │
│ total   265,550  │ tool calls 128   │                           │
│ cache eff  79%   │ avg req  4,003   │                           │
├──────────────────┴──────────────────┴───────────────────────────┤
│ ACCUMULATED — ALL SESSIONS                                       │
│ ┌────────────┬───────────┐  Today  12s $3.21  ████████████ 100% │
│ │ $98.40     │ 312 sess  │  Week   43s $14.80 █████████▌  78%   │
│ │ all-time   │ avg $0.32 │  Month  98s $42.30 ███████     55%   │
│ ├────────────┼───────────┤  All   312s $98.40 ████▌       35%   │
│ │ 24.1M tok  │ $31.20    │                                      │
│ │ total      │ cache svd │  Burn: $2.41/day → ~$72/mo projected │
│ └────────────┴───────────┘                                      │
├─────────────────────────────────────────────────────────────────┤
│ LIVE FEED   time    in      out    cache    cost   t/s  latency │
│ ► 12:05:44  +2,430  +380  +3,200✦  $0.04   42     1.1s         │
│   12:04:58  +3,100  +290  +2,800✦  $0.05   38     1.3s         │
│   12:04:22  +1,800  +420  +1,400✦  $0.03   45     0.9s         │
│   ...                                                           │
├─────────────────────────────────────────────────────────────────┤
│ uptime 4m32s · mesh-komp · ~/.claude/…  [q]quit [r]reset [?]help│
└─────────────────────────────────────────────────────────────────┘
```

---

## Components (blessed boxes)

| Box | Content | Update trigger |
|---|---|---|
| `titlebar` | Project name, model, LIVE badge | On new session event |
| `metric-{in,out,cread,cwrite,cost,speed}` | Value + ASCII sparkline | Every new JSONL event |
| `context-bar` | Progress bar + segment labels | Every new JSONL event |
| `token-breakdown` | Table + cache efficiency bar | Every new JSONL event |
| `performance` | Speed, latency, peak, req count, tool calls, avg req size | Every new JSONL event |
| `daily-chart` | ASCII bar chart last 7 days | On session boundary / startup |
| `accumulated` | All-time grid + period table + burn projection | On session boundary / startup |
| `feed` | Scrollable log of requests | Every new JSONL event |
| `footer` | Uptime clock, shortcuts | Every second (clock) |

---

## State Shape

```js
const state = {
  // Current session
  session: {
    startedAt: Date,
    requests: Number,
    tokensIn: Number,
    tokensOut: Number,
    cacheRead: Number,
    cacheWrite: Number,
    costUSD: Number,
    model: String,
    speeds: Number[],        // last N t/s values for sparkline
    latencies: Number[],     // last N latency values
    feed: FeedEntry[],       // last 50 requests
    contextTokens: Number,   // latest context size
    contextLimit: Number,    // model's context limit
  },
  // Accumulated
  history: {
    byDate: Map<string, DaySummary>,   // keyed by YYYY-MM-DD
    allTime: AggregateSummary,
  },
};
```

---

## Sparklines

Rendered as Unicode block characters using the input values mapped to 8 buckets:  
`▁ ▂ ▃ ▄ ▅ ▆ ▇ █`

Last 16 values per metric, right-aligned (newest on right).

---

## Cost Calculation

Claude Code writes `costUSD` per event. If missing (older log versions), compute from token counts using the model's published pricing constants:

```js
const PRICING = {
  'claude-sonnet-4-6': {
    input: 3.00 / 1_000_000,
    output: 15.00 / 1_000_000,
    cacheRead: 0.30 / 1_000_000,
    cacheWrite: 3.75 / 1_000_000,
  },
  // extend as needed
};
```

---

## Context Window

`input_tokens` in each API call represents the **full context size** at that point (it includes all prior messages, not a delta). So `contextTokens = latestEvent.usage.input_tokens`. Limit is looked up from a model constant table.

## Speed & Latency

Speed (t/s) and latency are **approximate**, derived from timestamp deltas between consecutive assistant events:
- `latency = timestamp[n] - timestamp[n-1]` (inter-message gap, not true server latency)
- `speed = output_tokens[n] / latency[n]`

TTFT (time-to-first-token) is **not available** from JSONL and is excluded from the UI.

---

## File Structure

```
ccmon.js          # entire implementation (~800–1000 lines)
package.json      # adds "monitor": "node ccmon.js" script
```

`ccmon.js` is self-contained. It does not import from `mesh-komp` source and has no runtime coupling to the server.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `q` / `Ctrl+C` | Quit |
| `r` | Reset current session stats |
| `h` | Toggle history overlay (last 10 sessions) |
| `c` | Clear live feed |
| `?` | Help overlay |

---

## Error Handling

- `~/.claude/` not found: show "Claude Code not installed or not yet run" and poll until it appears
- Malformed JSONL line: skip and log to footer status area
- `fs.watch` not available: fall back to 500ms polling
- Unknown model in pricing table: show `$?` and log warning

---

## Non-Goals

- No writing to Claude Code config or session files
- No authentication, no network requests
- No persistence layer beyond reading what Claude Code already writes
- No Windows support (macOS/Linux only for `fs.watch` recursive)
