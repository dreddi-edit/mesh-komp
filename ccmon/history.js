'use strict';

const path = require('node:path');
const { findJSONLFiles, readSessionEvents } = require('./parser.js');

function zeroDaySummary() {
  return { costUSD: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheWrite: 0, requests: 0, sessions: 0 };
}

/**
 * Build a Map<YYYY-MM-DD, DaySummary> from an array of parsed events.
 * @param {Array} events
 * @returns {Map<string, object>}
 */
function buildHistoryFromEvents(events) {
  const byDate = new Map();
  for (const event of events) {
    const key = event.timestamp.toISOString().slice(0, 10);
    if (!byDate.has(key)) byDate.set(key, zeroDaySummary());
    const day = byDate.get(key);
    day.costUSD    += event.costUSD;
    day.tokensIn   += event.tokensIn;
    day.tokensOut  += event.tokensOut;
    day.cacheRead  += event.cacheRead;
    day.cacheWrite += event.cacheWrite;
    day.requests   += 1;
  }
  return byDate;
}

/**
 * Load all historical session events from ~/.claude/projects/.
 * @param {string} claudeDir  e.g. /Users/foo/.claude
 * @returns {Map<string, object>}
 */
function loadAllHistory(claudeDir) {
  const projectsDir = path.join(claudeDir, 'projects');
  const files = findJSONLFiles(projectsDir);
  const allEvents = [];
  for (const file of files) {
    const { events } = readSessionEvents(file);
    allEvents.push(...events);
  }
  return buildHistoryFromEvents(allEvents);
}

/**
 * Compute accumulated stats for today / this week / this month / all-time.
 * @param {Map<string, object>} byDate
 * @returns {{ today: object, week: object, month: object, allTime: object }}
 */
function getAccumulatedStats(byDate) {
  const now = new Date();
  const todayKey  = now.toISOString().slice(0, 10);
  const weekAgo   = new Date(now - 7  * 86400000).toISOString().slice(0, 10);
  const monthAgo  = new Date(now - 30 * 86400000).toISOString().slice(0, 10);

  const today   = zeroDaySummary();
  const week    = zeroDaySummary();
  const month   = zeroDaySummary();
  const allTime = zeroDaySummary();

  const KEYS = ['costUSD', 'tokensIn', 'tokensOut', 'cacheRead', 'cacheWrite', 'requests'];
  const add = (target, day) => { for (const k of KEYS) target[k] += day[k]; };

  for (const [dateKey, day] of byDate) {
    add(allTime, day);
    if (dateKey >= monthAgo) add(month, day);
    if (dateKey >= weekAgo)  add(week, day);
    if (dateKey === todayKey) add(today, day);
  }

  return { today, week, month, allTime };
}

/**
 * Calculate daily average spend and projected monthly cost based on last 7 days.
 * @param {Map<string, object>} byDate
 * @returns {{ dailyAvg: number, projectedMonthly: number, spentThisMonth: number, daysLeftInMonth: number }}
 */
function getBurnRate(byDate) {
  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString().slice(0, 10);

  let sevenDayTotal = 0;
  for (const [dateKey, day] of byDate) {
    if (dateKey >= sevenDaysAgo) sevenDayTotal += day.costUSD;
  }

  const dailyAvg = sevenDayTotal / 7;
  const projectedMonthly = dailyAvg * 30;

  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  let spentThisMonth = 0;
  for (const [dateKey, day] of byDate) {
    if (dateKey >= firstOfMonth) spentThisMonth += day.costUSD;
  }

  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeftInMonth = lastDayOfMonth - now.getDate();

  return { dailyAvg, projectedMonthly, spentThisMonth, daysLeftInMonth };
}

module.exports = { buildHistoryFromEvents, loadAllHistory, getAccumulatedStats, getBurnRate };
