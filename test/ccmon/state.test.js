'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSession, applyEvent, SPARKLINE_WINDOW, MAX_FEED_SIZE } = require('../../ccmon/state.js');

const makeEvent = (overrides = {}) => ({
  timestamp: new Date('2026-04-08T12:05:44.000Z'),
  model: 'claude-sonnet-4-6',
  tokensIn: 2430,
  tokensOut: 380,
  cacheRead: 3200,
  cacheWrite: 800,
  costUSD: 0.04,
  ...overrides,
});

test('createSession returns zero-value session', () => {
  const s = createSession();
  assert.equal(s.requests, 0);
  assert.equal(s.tokensIn, 0);
  assert.equal(s.tokensOut, 0);
  assert.equal(s.costUSD, 0);
  assert.deepEqual(s.feed, []);
  assert.deepEqual(s.sparkIn, []);
});

test('applyEvent accumulates token counts', () => {
  const s0 = createSession();
  const s1 = applyEvent(s0, makeEvent({ tokensIn: 100, tokensOut: 50 }), null);
  const s2 = applyEvent(s1, makeEvent({ tokensIn: 200, tokensOut: 30 }), s1.lastEvent);
  assert.equal(s2.tokensIn, 300);
  assert.equal(s2.tokensOut, 80);
  assert.equal(s2.requests, 2);
});

test('applyEvent accumulates cost', () => {
  const s0 = createSession();
  const s1 = applyEvent(s0, makeEvent({ costUSD: 0.05 }), null);
  const s2 = applyEvent(s1, makeEvent({ costUSD: 0.03 }), s1.lastEvent);
  assert.ok(Math.abs(s2.costUSD - 0.08) < 0.0001);
});

test('applyEvent updates contextTokens to latest input_tokens', () => {
  const s0 = createSession();
  const s1 = applyEvent(s0, makeEvent({ tokensIn: 5000 }), null);
  const s2 = applyEvent(s1, makeEvent({ tokensIn: 8000 }), s1.lastEvent);
  assert.equal(s2.contextTokens, 8000);
});

test('applyEvent pushes to feed and caps at MAX_FEED_SIZE', () => {
  let s = createSession();
  for (let i = 0; i < MAX_FEED_SIZE + 5; i++) {
    s = applyEvent(s, makeEvent(), s.lastEvent);
  }
  assert.equal(s.feed.length, MAX_FEED_SIZE);
});

test('applyEvent maintains sparkline window for tokensIn', () => {
  let s = createSession();
  for (let i = 0; i < SPARKLINE_WINDOW + 4; i++) {
    s = applyEvent(s, makeEvent({ tokensIn: i * 100 }), s.lastEvent);
  }
  assert.equal(s.sparkIn.length, SPARKLINE_WINDOW);
});

test('applyEvent calculates speed from timestamp delta', () => {
  const s0 = createSession();
  const t1 = new Date('2026-04-08T12:00:00.000Z');
  const t2 = new Date('2026-04-08T12:00:01.000Z'); // 1 second later
  const s1 = applyEvent(s0, makeEvent({ timestamp: t1, tokensOut: 0 }), null);
  const s2 = applyEvent(s1, makeEvent({ timestamp: t2, tokensOut: 42 }), s1.lastEvent);
  // 42 tokens / 1 second = 42 t/s
  assert.equal(s2.lastSpeed, 42);
});
