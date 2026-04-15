'use strict';

const fs   = require('node:fs');
const path = require('node:path');
const os   = require('node:os');

const blessed = require('neo-blessed');

const { createLayout }   = require('./ccmon/layout.js');
const { loadAllHistory, buildHistoryFromEvents, getAccumulatedStats, getBurnRate } = require('./ccmon/history.js');
const { createSession, applyEvent } = require('./ccmon/state.js');
const { readSessionEvents, readTailWithErrors, findJSONLFiles } = require('./ccmon/parser.js');
const { watchProjectsDir } = require('./ccmon/watcher.js');
const { fetchBedrockUsageFromCloudWatch, mergeCloudWatchIntoHistory } = require('./ccmon/cloudwatch.js');
const {
  renderSparkline, renderContextBar, renderDailyChart,
  renderTokenBreakdown, renderPerformance, renderAccumulated,
  renderFeed, formatCost, formatDuration, formatNum,
} = require('./ccmon/render.js');

const CLAUDE_DIR   = path.join(os.homedir(), '.claude');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
const PROJECT_NAME = path.basename(process.cwd());

const CW_REFRESH_INTERVAL_MS = 5 * 60_000;

// ── Screen ───────────────────────────────────────────────────────
const screen = blessed.screen({ smartCSR: true, title: 'ccmon', fullUnicode: true });
const boxes  = createLayout(screen);

// ── State ────────────────────────────────────────────────────────
let session     = createSession();
/** JSONL-derived history from ~/.claude/projects */
let jsonlByDate = new Map();
/** Merged history: JSONL + CloudWatch overlay */
let byDate      = new Map();
let accumulated = { today: { costUSD: 0, requests: 0, tokensIn: 0, tokensOut: 0 }, week: { costUSD: 0, requests: 0 }, month: { costUSD: 0, requests: 0 }, allTime: { costUSD: 0, requests: 0, tokensIn: 0, tokensOut: 0 } };
let burnRate    = { dailyAvg: 0, projectedMonthly: 0, spentThisMonth: 0, daysLeftInMonth: 0 };
let statusMsg   = '';
let cwStatusMsg = '';  // CloudWatch status indicator for footer

// Track byte offsets per file to only read new content on each change
const fileOffsets = new Map();

// ── Internal helpers ─────────────────────────────────────────────

function updateAccumulated() {
  accumulated = getAccumulatedStats(byDate);
  burnRate    = getBurnRate(byDate);
}

function refreshBoxes() {
  const model     = session.model !== 'unknown' ? session.model : '—';
  const uptimeMs  = Date.now() - session.startedAt.getTime();
  const reqCount  = session.requests;

  // Titlebar
  boxes.titlebar.setContent(
    ` {bold}{blue-fg}ccmon{/}  ${PROJECT_NAME}  {grey-fg}│{/}  ${model}` +
    `  {grey-fg}│{/}  ${reqCount} req  {grey-fg}│{/}  ${formatDuration(uptimeMs)}` +
    `{|}  {green-fg}● LIVE{/} `
  );

  // Metric boxes: [in, out, cread, cwrite, cost, speed]
  const lastEv = session.lastEvent;
  const metricData = [
    { val: formatNum(session.tokensIn),   sub: lastEv ? `+${formatNum(lastEv.tokensIn)} last`         : '—', spark: session.sparkIn    },
    { val: formatNum(session.tokensOut),  sub: lastEv ? `+${formatNum(lastEv.tokensOut)} last`        : '—', spark: session.sparkOut   },
    { val: formatNum(session.cacheRead),  sub: `~${formatCost(session.cacheRead * 0.30 / 1e6)} saved`, spark: session.sparkIn.map(v => v * 0.5) },
    { val: formatNum(session.cacheWrite), sub: `${session.requests} writes`,                           spark: session.sparkCost  },
    { val: formatCost(session.costUSD),   sub: `today ${formatCost(accumulated.today?.costUSD ?? 0)}`, spark: session.sparkCost  },
    { val: `${session.lastSpeed} t/s`,    sub: `peak ${session.peakSpeed} t/s`,                        spark: session.sparkSpeed },
  ];

  metricData.forEach(({ val, sub, spark }, i) => {
    const sparkStr = renderSparkline(spark, Math.max(4, (boxes.metrics[i].width ?? 18) - 4));
    boxes.metrics[i].setContent(`\n {bold}${val}{/}\n ${sub}\n\n ${sparkStr}`);
  });

  // Context bar
  const ctxPct    = session.contextLimit > 0
    ? Math.round((session.contextTokens / session.contextLimit) * 1000) / 10
    : 0;
  const barWidth  = Math.max(10, (boxes.contextBar.width ?? 82) - 4);
  const bar       = renderContextBar(session.contextTokens, session.contextLimit, barWidth);
  const ctxColor  = ctxPct > 90 ? 'red' : ctxPct > 75 ? 'yellow' : 'blue';
  const ctxWarn   = ctxPct > 75 ? `  {yellow-fg}⚠ consider /compact{/}` : '';
  boxes.contextBar.setContent(
    ` {${ctxColor}-fg}${bar}{/}\n` +
    ` used {bold}${formatNum(session.contextTokens)}{/}  free ${formatNum(session.contextLimit - session.contextTokens)}  limit ${formatNum(session.contextLimit)}  {bold}${ctxPct}%{/}${ctxWarn}`
  );

  // Middle panels
  boxes.tokenBreakdown.setContent('\n' + renderTokenBreakdown(session));
  boxes.performance.setContent('\n' + renderPerformance(session));
  boxes.dailyChart.setContent('\n' + renderDailyChart(byDate, 5, (boxes.dailyChart.width ?? 32) - 4));

  // Accumulated
  boxes.accumulated.setContent('\n' + renderAccumulated(accumulated, burnRate));

  // Feed
  boxes.feed.setContent('\n' + renderFeed(session.feed));

  // Footer — show CloudWatch status alongside project path
  const status  = statusMsg   ? `  {yellow-fg}⚠ ${statusMsg}{/}` : '';
  const cwBadge = cwStatusMsg ? `  ${cwStatusMsg}` : '  {grey-fg}CW —{/}';
  boxes.footer.setContent(
    ` {grey-fg}${PROJECT_NAME} · ${PROJECTS_DIR}${status}${cwBadge}{/}` +
    `{|}  [q] quit  [r] reset  [h] history  [c] clear feed  [w] cw-refresh  [?] help {/}`
  );

  screen.render();
}

// ── CloudWatch refresh ────────────────────────────────────────────

async function refreshCloudWatch(silent = false) {
  if (!silent) {
    cwStatusMsg = '{cyan-fg}CW ↻{/}';
    refreshBoxes();
  }

  const result = await fetchBedrockUsageFromCloudWatch({ lookbackDays: 30 });

  if (result.ok) {
    cwStatusMsg = `{green-fg}CW ✔ ${result.cwByDate.size}d{/}`;
    byDate = mergeCloudWatchIntoHistory(jsonlByDate, result.cwByDate);
  } else {
    cwStatusMsg = `{red-fg}CW ✗{/}`;
    byDate = new Map(jsonlByDate);
    if (!silent) {
      statusMsg = `CW: ${String(result.error || 'unavailable').slice(0, 60)}`;
      setTimeout(() => { statusMsg = ''; refreshBoxes(); }, 5000);
    }
  }

  updateAccumulated();
  refreshBoxes();
}

// ── File event handler ────────────────────────────────────────────

function handleFileChange(filePath) {
  const offset = fileOffsets.get(filePath) ?? 0;
  const { events, newByte, skipped } = readTailWithErrors(filePath, offset);

  if (!events.length && !skipped) return;

  fileOffsets.set(filePath, newByte);

  if (skipped > 0) {
    statusMsg = `${skipped} line(s) skipped`;
    setTimeout(() => { statusMsg = ''; }, 3000);
  }

  for (const event of events) {
    session = applyEvent(session, event, session.lastEvent);

    const dateKey = event.timestamp.toISOString().slice(0, 10);
    if (!jsonlByDate.has(dateKey)) {
      jsonlByDate.set(dateKey, { costUSD: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, requests: 0, sessions: 0 });
    }
    const day = jsonlByDate.get(dateKey);
    day.costUSD    += event.costUSD;
    day.tokensIn   += event.tokensIn;
    day.tokensOut  += event.tokensOut;
    day.cacheRead  += event.cacheRead;
    day.cacheWrite += event.cacheWrite;
    day.requests   += 1;
  }

  // Rebuild merged view: re-apply CW overlay if it was loaded, else use JSONL directly.
  byDate = new Map(jsonlByDate);

  updateAccumulated();
  refreshBoxes();
}

// ── Keyboard shortcuts ─────────────────────────────────────────────

screen.key(['q', 'C-c'], () => {
  screen.destroy();
  process.exit(0);
});

screen.key('r', () => {
  session = createSession();
  statusMsg = 'Session reset';
  refreshBoxes();
  setTimeout(() => { statusMsg = ''; refreshBoxes(); }, 2000);
});

screen.key('c', () => {
  session = { ...session, feed: [] };
  refreshBoxes();
});

screen.key('?', () => {
  const help = blessed.box({
    top: 'center', left: 'center', width: '50%', height: 12,
    label: ' HELP ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'white' }, bg: 'black' },
    content: [
      '',
      '  {bold}q / Ctrl+C{/}   Quit',
      '  {bold}r{/}           Reset current session stats',
      '  {bold}h{/}           History overlay (last 10 days)',
      '  {bold}c{/}           Clear live feed',
      '  {bold}?{/}           This help screen',
      '',
      '  {grey-fg}Press any key to close{/}',
    ].join('\n'),
  });
  screen.append(help);
  screen.render();
  screen.once('keypress', () => { screen.remove(help); screen.render(); });
});

screen.key('w', () => {
  refreshCloudWatch(false);
});

screen.key('h', () => {
  const lines = [' ', ' {bold}{yellow-fg}LAST 10 DAYS{/}', ' '];
  const sorted = [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10);
  for (const [date, day] of sorted) {
    lines.push(
      `  ${date}   ${formatNum(day.tokensIn + day.tokensOut, true).padStart(7)} tok` +
      `   ${formatCost(day.costUSD).padStart(7)}   ${day.requests} req`
    );
  }
  if (sorted.length === 0) lines.push('  {grey-fg}No history yet{/}');
  lines.push('', ' {grey-fg}Press any key to close{/}');

  const overlay = blessed.box({
    top: 'center', left: 'center', width: '60%',
    height: Math.min(lines.length + 2, 20),
    label: ' SESSION HISTORY ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'yellow' }, bg: 'black' },
    content: lines.join('\n'),
  });
  screen.append(overlay);
  screen.render();
  screen.once('keypress', () => { screen.remove(overlay); screen.render(); });
});

// ── Startup ────────────────────────────────────────────────────────

function startup() {
  if (!fs.existsSync(PROJECTS_DIR)) {
    const msg = blessed.box({
      top: 'center', left: 'center', width: '60%', height: 5,
      label: ' ccmon ',
      content: '\n {center}{red-fg}~/.claude/projects not found.{/}\n Run Claude Code at least once, then restart ccmon.{/center}',
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: 'red' } },
    });
    screen.append(msg);
    screen.render();
    return;
  }

  // Load historical data from all existing JSONL files
  jsonlByDate = loadAllHistory(CLAUDE_DIR);
  byDate = new Map(jsonlByDate);
  updateAccumulated();

  // Seed byte offsets to current EOF — we watch for NEW events only
  for (const f of findJSONLFiles(PROJECTS_DIR)) {
    try { fileOffsets.set(f, fs.statSync(f).size); } catch { /* skip */ }
  }

  // Start watching for live changes
  const { stop } = watchProjectsDir(PROJECTS_DIR, handleFileChange);

  // Initial render (JSONL data only — CW arrives asynchronously)
  cwStatusMsg = '{grey-fg}CW …{/}';
  refreshBoxes();

  // Kick off CloudWatch initial fetch (silent = true so no status flicker)
  refreshCloudWatch(true);

  // Periodic CW refresh
  const cwInterval = setInterval(() => refreshCloudWatch(true), CW_REFRESH_INTERVAL_MS);

  // Uptime clock — refreshes titlebar even when no events are coming in
  const clockInterval = setInterval(() => {
    const uptimeMs = Date.now() - session.startedAt.getTime();
    const model = session.model !== 'unknown' ? session.model : '—';
    boxes.titlebar.setContent(
      ` {bold}{blue-fg}ccmon{/}  ${PROJECT_NAME}  {grey-fg}│{/}  ${model}` +
      `  {grey-fg}│{/}  ${session.requests} req  {grey-fg}│{/}  ${formatDuration(uptimeMs)}` +
      `{|}  {green-fg}● LIVE{/} `
    );
    screen.render();
  }, 1000);

  screen.on('destroy', () => {
    stop();
    clearInterval(clockInterval);
    clearInterval(cwInterval);
  });
}

startup();
