'use strict';

const SPARK_CHARS = '▁▂▃▄▅▆▇█';

/**
 * Format a number with commas. If compact=true, abbreviate large numbers (k, M).
 * @param {number} n
 * @param {boolean} compact
 * @returns {string}
 */
function formatNum(n, compact = false) {
  if (compact) {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000)     return `${Math.round(n / 1_000)}k`;
    return String(n);
  }
  return n.toLocaleString('en-US');
}

/**
 * @param {number} usd
 * @returns {string}
 */
function formatCost(usd) {
  return `$${usd.toFixed(2)}`;
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60)   return rs > 0 ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Render a sparkline string from an array of values using Unicode block chars.
 * @param {number[]} values
 * @param {number} width  max chars (uses last N values)
 * @returns {string}
 */
function renderSparkline(values, width = 16) {
  if (!values.length) return ' '.repeat(width);
  const slice = values.slice(-width);
  const max = Math.max(...slice);
  const min = Math.min(...slice);
  const range = max - min || 1;
  return slice.map(v => {
    const idx = Math.min(7, Math.floor(((v - min) / range) * 8));
    return SPARK_CHARS[idx];
  }).join('');
}

/**
 * Render a horizontal progress bar for the context window.
 * @param {number} used
 * @param {number} limit
 * @param {number} width  number of bar characters
 * @returns {string}
 */
function renderContextBar(used, limit, width) {
  const pct = Math.min(1, used / (limit || 1));
  const filled = Math.round(pct * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

/**
 * Render a vertical ASCII bar chart for daily costs over the last 7 days.
 * @param {Map<string, {costUSD: number}>} byDate
 * @param {number} chartHeight  number of character rows
 * @param {number} totalWidth   available box width
 * @returns {string}
 */
function renderDailyChart(byDate, chartHeight = 5, totalWidth = 30) {
  const today = new Date();
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today - i * 86400000);
    const key = d.toISOString().slice(0, 10);
    const label = i === 0 ? 'TODAY' : ['S', 'M', 'T', 'W', 'T', 'F', 'S'][d.getDay()];
    days.push({ key, label, cost: byDate.get(key)?.costUSD ?? 0 });
  }

  const maxCost = Math.max(...days.map(d => d.cost), 0.01);
  const colWidth = Math.max(3, Math.floor((totalWidth - 1) / 7));

  const rows = [];
  for (let row = chartHeight - 1; row >= 0; row--) {
    const threshold = (row / chartHeight) * maxCost;
    rows.push(days.map(d => (d.cost > threshold ? '▓▓' : '  ').padEnd(colWidth)).join(''));
  }
  rows.push(days.map(d => d.label.slice(0, colWidth).padEnd(colWidth)).join(''));
  rows.push(days.map(d => formatCost(d.cost).slice(0, colWidth).padEnd(colWidth)).join(''));

  return rows.join('\n');
}

/**
 * Render the content string for the token breakdown panel.
 * @param {object} session
 * @returns {string}
 */
function renderTokenBreakdown(session) {
  const maxTok = Math.max(session.tokensIn, 1);
  const barWidth = 8;
  const bar = (n) => '█'.repeat(Math.round((n / maxTok) * barWidth)).padEnd(barWidth, '░');

  const cacheEff = session.tokensIn > 0
    ? Math.round((session.cacheRead / session.tokensIn) * 100)
    : 0;

  return [
    `{blue-fg}IN   {/} ${bar(session.tokensIn)}  ${formatNum(session.tokensIn)}`,
    `{green-fg}OUT  {/} ${bar(session.tokensOut)} ${formatNum(session.tokensOut)}`,
    `{magenta-fg}C.RD {/} ${bar(session.cacheRead)} ${formatNum(session.cacheRead)}`,
    `{red-fg}C.WR {/} ${bar(session.cacheWrite)} ${formatNum(session.cacheWrite)}`,
    `─────────────────────────`,
    `TOTAL  ${formatNum(session.tokensIn + session.tokensOut)}`,
    `CACHE  ${cacheEff}% hit`,
  ].join('\n');
}

/**
 * Render the content string for the performance panel.
 * @param {object} session
 * @returns {string}
 */
function renderPerformance(session) {
  const avgLatency = session.requests > 1
    ? (session.totalLatencyMs / (session.requests - 1) / 1000).toFixed(1)
    : '—';
  const avgReqSize = session.requests > 0
    ? formatNum(Math.round(session.tokensIn / session.requests))
    : '—';

  return [
    `{cyan-fg}${session.lastSpeed} t/s{/}`,
    ``,
    `LATENCY  ${avgLatency}s`,
    `PEAK     ${session.peakSpeed} t/s`,
    `REQ      ${session.requests}`,
    `TOOL USE —`,          // not available in JSONL — Claude Code doesn't log tool call counts
    `AVG SIZE ${avgReqSize}`,
  ].join('\n');
}

/**
 * Render the accumulated stats panel content.
 * @param {{ today: object, week: object, month: object, allTime: object }} accumulated
 * @param {{ dailyAvg: number, projectedMonthly: number, spentThisMonth: number, daysLeftInMonth: number }} burnRate
 * @returns {string}
 */
function renderAccumulated(accumulated, burnRate) {
  const { today, week, month, allTime } = accumulated;
  const BARW = 12;
  const maxRef = Math.max(today.costUSD * 30, allTime.costUSD, 0.01);
  const bar = (cost) => {
    const filled = Math.round((cost / maxRef) * BARW);
    return '█'.repeat(Math.min(filled, BARW)) + '░'.repeat(Math.max(0, BARW - filled));
  };

  return [
    `{yellow-fg}ALL-TIME  ${formatCost(allTime.costUSD).padStart(8)}{/}   SESSIONS ${allTime.requests}`,
    `TOKENS    ${formatNum(allTime.tokensIn + allTime.tokensOut, true).padStart(8)}   AVG/SESS ${formatCost(allTime.requests > 0 ? allTime.costUSD / allTime.requests : 0)}`,
    ``,
    `TODAY  ${bar(today.costUSD)} ${formatCost(today.costUSD).padStart(7)}  ${today.requests} req`,
    `WEEK   ${bar(week.costUSD)}  ${formatCost(week.costUSD).padStart(7)}  ${week.requests} req`,
    `MONTH  ${bar(month.costUSD)} ${formatCost(month.costUSD).padStart(7)}  ${month.requests} req`,
    ``,
    `BURN   ${formatCost(burnRate.dailyAvg)}/day  →  ~${formatCost(burnRate.projectedMonthly)}/mo projected`,
  ].join('\n');
}

/**
 * Render the live request feed panel content.
 * @param {Array} feed  array of FeedEntry (newest last)
 * @returns {string}
 */
function renderFeed(feed) {
  const header = `{grey-fg}TIME      IN        OUT     CACHE     COST    T/S  LAT{/}`;
  const rows = [...feed].reverse().slice(0, 14).map((entry, i) => {
    const time = entry.time.toTimeString().slice(0, 8);
    const prefix = i === 0 ? '{bold}►{/}' : ' ';
    const lat = entry.latencyMs > 0 ? `${(entry.latencyMs / 1000).toFixed(1)}s` : '—';
    return `${prefix} ${time}  ${String(entry.tokensIn).padStart(6)}  ${String(entry.tokensOut).padStart(5)}  ${String(entry.cacheRead).padStart(6)}✦  ${formatCost(entry.costUSD).padStart(6)}  ${String(entry.speed).padStart(3)}  ${lat}`;
  });
  return [header, ...rows].join('\n');
}

module.exports = {
  formatNum,
  formatCost,
  formatDuration,
  renderSparkline,
  renderContextBar,
  renderDailyChart,
  renderTokenBreakdown,
  renderPerformance,
  renderAccumulated,
  renderFeed,
};
