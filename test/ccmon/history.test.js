'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildHistoryFromEvents, getAccumulatedStats, getBurnRate } = require('../../ccmon/history.js');

const makeEvent = (dateStr, costUSD = 0.10, tokensIn = 1000, tokensOut = 100) => ({
  timestamp: new Date(dateStr),
  model: 'claude-sonnet-4-6',
  tokensIn,
  tokensOut,
  cacheRead: 500,
  cacheWrite: 100,
  costUSD,
});

test('buildHistoryFromEvents groups events by date', () => {
  const events = [
    makeEvent('2026-04-06T10:00:00Z', 0.10),
    makeEvent('2026-04-06T11:00:00Z', 0.20),
    makeEvent('2026-04-07T09:00:00Z', 0.15),
  ];
  const byDate = buildHistoryFromEvents(events);
  assert.ok(byDate.has('2026-04-06'));
  assert.ok(byDate.has('2026-04-07'));
  assert.ok(Math.abs(byDate.get('2026-04-06').costUSD - 0.30) < 0.0001);
  assert.equal(byDate.get('2026-04-06').requests, 2);
  assert.equal(byDate.get('2026-04-07').requests, 1);
});

test('getAccumulatedStats returns today/week/month/allTime buckets', () => {
  const today = new Date().toISOString().slice(0, 10);
  const events = [makeEvent(`${today}T10:00:00Z`, 1.00)];
  const byDate = buildHistoryFromEvents(events);
  const acc = getAccumulatedStats(byDate);
  assert.ok(Math.abs(acc.today.costUSD - 1.00) < 0.0001);
  assert.ok(Math.abs(acc.week.costUSD - 1.00) < 0.0001);
  assert.ok(acc.allTime.costUSD >= 1.00);
});

test('getBurnRate calculates 7-day average and monthly projection', () => {
  const byDate = new Map();
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    byDate.set(d, { costUSD: 1.00, tokensIn: 1000, tokensOut: 100, cacheRead: 0, cacheWrite: 0, requests: 1, sessions: 1 });
  }
  const burn = getBurnRate(byDate);
  assert.ok(Math.abs(burn.dailyAvg - 1.00) < 0.01);
  assert.ok(burn.projectedMonthly > 25 && burn.projectedMonthly < 35);
});
