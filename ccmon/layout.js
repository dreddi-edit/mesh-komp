'use strict';

const blessed = require('neo-blessed');

const TITLE_H   = 1;
const METRICS_H = 7;
const CTX_H     = 3;
const MIDDLE_H  = 10;
const ACCUM_H   = 10;
const FOOTER_H  = 1;
// Total fixed rows: 1 + 7 + 3 + 10 + 10 + 1 = 32
// Feed gets: 100% - 32 rows

/**
 * Create the full blessed layout. Returns a map of named box references.
 * All content boxes have tags:true so {color-fg} markup works.
 *
 * @param {blessed.Widgets.Screen} screen
 * @returns {{ titlebar, metrics: Array, contextBar, tokenBreakdown, performance, dailyChart, accumulated, feed, footer }}
 */
function createLayout(screen) {
  // ── Titlebar ───────────────────────────────────────────────────
  const titlebar = blessed.box({
    top: 0, left: 0, width: '100%', height: TITLE_H,
    content: '',
    tags: true,
    style: { bg: 'black', fg: 'white' },
  });

  // ── 6 metric boxes ─────────────────────────────────────────────
  const metricDefs = [
    { label: 'TOKENS IN',   color: 'blue'    },
    { label: 'TOKENS OUT',  color: 'green'   },
    { label: 'CACHE READ',  color: 'magenta' },
    { label: 'CACHE WRITE', color: 'red'     },
    { label: 'COST',        color: 'yellow'  },
    { label: 'SPEED',       color: 'cyan'    },
  ];

  const metrics = metricDefs.map(({ label, color }, i) => {
    // Distribute 6 boxes evenly; last box fills remaining to avoid rounding gaps
    const leftPct = `${Math.floor(i * 100 / 6)}%`;
    const widthPct = i < 5 ? '16%' : '20%';
    return blessed.box({
      top: TITLE_H,
      left: leftPct,
      width: widthPct,
      height: METRICS_H,
      label: ` ${label} `,
      tags: true,
      border: { type: 'line' },
      style: { border: { fg: color }, label: { fg: color } },
    });
  });

  // ── Context bar ────────────────────────────────────────────────
  const ctxTop = TITLE_H + METRICS_H;
  const contextBar = blessed.box({
    top: ctxTop, left: 0, width: '100%', height: CTX_H,
    label: ' CONTEXT WINDOW ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'blue' }, label: { fg: 'blue' } },
  });

  // ── Middle row ─────────────────────────────────────────────────
  const midTop = ctxTop + CTX_H;

  const tokenBreakdown = blessed.box({
    top: midTop, left: 0, width: '33%', height: MIDDLE_H,
    label: ' TOKEN BREAKDOWN ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'white' } },
  });

  const performance = blessed.box({
    top: midTop, left: '33%', width: '34%', height: MIDDLE_H,
    label: ' PERFORMANCE ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'cyan' } },
  });

  const dailyChart = blessed.box({
    top: midTop, left: '67%', width: '33%', height: MIDDLE_H,
    label: ' DAILY COST (7d) ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'yellow' } },
  });

  // ── Accumulated ────────────────────────────────────────────────
  const accumTop = midTop + MIDDLE_H;

  const accumulated = blessed.box({
    top: accumTop, left: 0, width: '100%', height: ACCUM_H,
    label: ' ACCUMULATED — ALL SESSIONS ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'yellow' }, label: { fg: 'yellow' } },
  });

  // ── Feed ────────────────────────────────────────────────────────
  const feedTop = accumTop + ACCUM_H;

  const feed = blessed.box({
    top: feedTop, left: 0, width: '100%',
    height: `100%-${feedTop + FOOTER_H}`,
    label: ' LIVE FEED ',
    tags: true,
    border: { type: 'line' },
    style: { border: { fg: 'green' } },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: { ch: '│', style: { fg: 'grey' } },
  });

  // ── Footer ─────────────────────────────────────────────────────
  const footer = blessed.box({
    bottom: 0, left: 0, width: '100%', height: FOOTER_H,
    content: '',
    tags: true,
    style: { bg: 'black', fg: 'grey' },
  });

  // Append all to screen
  screen.append(titlebar);
  for (const m of metrics) screen.append(m);
  screen.append(contextBar);
  screen.append(tokenBreakdown);
  screen.append(performance);
  screen.append(dailyChart);
  screen.append(accumulated);
  screen.append(feed);
  screen.append(footer);

  return { titlebar, metrics, contextBar, tokenBreakdown, performance, dailyChart, accumulated, feed, footer };
}

module.exports = { createLayout };
