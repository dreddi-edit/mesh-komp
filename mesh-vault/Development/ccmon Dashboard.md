---
tags: [development]
---

# ccmon Dashboard

A standalone monitoring suite for Claude Code API usage, costs, and session activity. Two complementary surfaces share the same core modules:

| Surface | Entry Point | Interface |
|---------|-------------|-----------|
| Terminal TUI | `node ccmon.js` / `npm run monitor` | Full-screen neo-blessed dashboard |
| Web dashboard | `node ccmon-server.js` + `ccmon-web/` | Browser React app at `localhost:3030` |

Both read the same JSONL log files from `~/.claude/projects/` — no coupling to the mesh-komp gateway at runtime.

## File Map

| File | Purpose |
|------|---------|
| `ccmon.js` | Terminal TUI entry point — screen setup, keyboard shortcuts, wires all modules |
| `ccmon-server.js` | Express server (port 3030) exposing REST + SSE endpoints for the web dashboard |
| `ccmon/pricing.js` | Per-model pricing constants and `calculateCost()` / `getContextLimit()` |
| `ccmon/parser.js` | Parses JSONL session lines into normalized event objects |
| `ccmon/state.js` | Immutable session state + `applyEvent()` accumulator |
| `ccmon/history.js` | Loads all historical JSONL files, aggregates per-date stats |
| `ccmon/render.js` | Pure functions producing neo-blessed panel content |
| `ccmon/watcher.js` | Watches `~/.claude/projects/` for file changes |
| `ccmon/layout.js` | Creates all neo-blessed dashboard boxes |

## ccmon-server.js — Web API Layer

Express server that exposes the ccmon data over HTTP so `ccmon-web` can consume it from a browser.

Key endpoints:
- `GET /state` — current session + accumulated stats snapshot
- `GET /history` — per-date historical summaries
- `GET /events` — SSE stream; pushes updated state on every file change

The watcher calls all SSE clients on change. `ccmon-web/` connects at startup via `EventSource`.

## ccmon-web/ — React Web Dashboard

Full Vite + React + TypeScript app. Lives in `ccmon-web/src/`.

| File | Purpose |
|------|---------|
| `src/App.tsx` | Root component — SSE connection, all dashboard panels |
| `src/types.ts` | `AppState`, `HistoryDay` TypeScript interfaces |
| `src/index.css` | Tailwind base styles |

Tech: Recharts (charts), Framer Motion (animations), Lucide icons, Tailwind CSS.

**Run:**
```bash
cd ccmon-web && npm install && npm run dev   # dev mode
cd ccmon-web && npm run build               # production build
```

The app connects to `ccmon-server.js` at `http://localhost:3030`.

## Dashboard Layout

Full-screen terminal UI (neo-blessed):

```
┌─ titlebar ─────────────────────────────────────────┐
│ Metric   Metric   Metric   Metric   Metric   Metric │
│ Box      Box      Box      Box      Box      Box    │
├─ context bar ───────────────────────────────────────┤
│                                                     │
│  middle row (current session stats)                 │
│                                                     │
├─ accumulated panel ─────────────────────────────────┤
│                                                     │
│  live feed (recent events)                          │
│                                                     │
├─ footer ────────────────────────────────────────────┘
```

Panels:
- Sparklines (token rate over time)
- Context bar (% of context window used)
- Token breakdown (input/output/cache)
- Performance (speed, latency)
- Daily chart (cost by day)
- Accumulated stats (daily/weekly/monthly/all-time)
- Live feed (recent API calls)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `q` | Quit |
| `r` | Refresh/redraw |
| `h` | Toggle historical view |
| `c` | Clear screen |
| `?` | Help |

## Data Sources

- `~/.claude/projects/**/*.jsonl` — Claude Code session logs
- Parser handles both single events (`parseAssistantEvent`) and full files (`readSessionEvents`)
- Live tailing via `readTailWithErrors` for active sessions
- Historical aggregation: per-date summaries, daily/weekly/monthly/all-time stats + burn rate projection

## File Watcher

`ccmon/watcher.js`:
- Uses `fs.watch` recursive on macOS
- Falls back to polling on Linux/other platforms

## Pricing Data

`ccmon/pricing.js` contains per-model token pricing (USD/token) for all Anthropic models.

**Update this file when Anthropic changes pricing** or when new models are released.

## Test Files

```
test/ccmon/parser.test.js
test/ccmon/history.test.js
test/ccmon/pricing.test.js
test/ccmon/render.test.js
test/ccmon/state.test.js
```
