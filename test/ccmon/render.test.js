'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  renderSparkline,
  renderContextBar,
  renderDailyChart,
  formatNum,
  formatCost,
  formatDuration,
} = require('../../ccmon/render.js');

test('formatNum formats thousands with commas', () => {
  assert.equal(formatNum(1234567), '1,234,567');
  assert.equal(formatNum(0), '0');
  assert.equal(formatNum(999), '999');
});

test('formatNum uses M/k suffix in compact mode', () => {
  assert.equal(formatNum(1_234_567, true), '1.2M');
  assert.equal(formatNum(500_000, true), '500k');
});

test('formatCost formats with dollar sign and 2 decimal places', () => {
  assert.equal(formatCost(0.84), '$0.84');
  assert.equal(formatCost(3.21), '$3.21');
  assert.equal(formatCost(0), '$0.00');
});

test('formatDuration formats milliseconds into human-readable string', () => {
  assert.equal(formatDuration(272000), '4m 32s');
  assert.equal(formatDuration(45000), '45s');
  assert.equal(formatDuration(3660000), '1h 1m');
});

test('renderSparkline returns string using block chars', () => {
  const SPARK_CHARS = '▁▂▃▄▅▆▇█';
  const result = renderSparkline([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(typeof result, 'string');
  for (const ch of result) {
    assert.ok(SPARK_CHARS.includes(ch), `Unexpected char: ${ch}`);
  }
});

test('renderSparkline returns spaces for empty values', () => {
  const result = renderSparkline([]);
  assert.equal(result.trim(), '');
});

test('renderContextBar fills proportionally', () => {
  const result = renderContextBar(50_000, 200_000, 20);
  // 25% filled → 5 filled chars out of 20
  const filledCount = (result.match(/█/g) || []).length;
  assert.equal(filledCount, 5);
  const emptyCount = (result.match(/░/g) || []).length;
  assert.equal(emptyCount, 15);
});

test('renderDailyChart returns a multi-line string', () => {
  const byDate = new Map([
    ['2026-04-02', { costUSD: 1.0 }],
    ['2026-04-03', { costUSD: 3.0 }],
    ['2026-04-04', { costUSD: 2.0 }],
  ]);
  const result = renderDailyChart(byDate, 4, 20);
  assert.ok(result.includes('\n'));
  assert.equal(typeof result, 'string');
});
