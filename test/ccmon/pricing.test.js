'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { calculateCost, getContextLimit, PRICING } = require('../../ccmon/pricing.js');

test('PRICING has sonnet-4-6 entry', () => {
  assert.ok(PRICING['claude-sonnet-4-6']);
  assert.equal(typeof PRICING['claude-sonnet-4-6'].input, 'number');
});

test('calculateCost computes input + output + cache correctly', () => {
  // input_tokens includes cache_read and cache_write, so regular input = 1M - 1M - 1M = 0
  // (clamped to 0 — more cache than total input in this pathological test case)
  // Use a realistic split: 4M total input, 1M cache_read, 1M cache_write, 2M regular
  const usage = {
    input_tokens: 4_000_000,
    output_tokens: 1_000_000,
    cache_read_input_tokens: 1_000_000,
    cache_creation_input_tokens: 1_000_000,
  };
  const cost = calculateCost(usage, 'claude-sonnet-4-6');
  // regular: 2M × $3 = $6.00
  // output:  1M × $15 = $15.00
  // cacheRead: 1M × $0.30 = $0.30
  // cacheWrite: 1M × $3.75 = $3.75
  // total = $25.05
  assert.ok(Math.abs(cost - 25.05) < 0.001, `Expected ~25.05, got ${cost}`);
});

test('calculateCost handles zero tokens', () => {
  const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  assert.equal(calculateCost(usage, 'claude-sonnet-4-6'), 0);
});

test('calculateCost handles unknown model by using fallback', () => {
  const usage = { input_tokens: 1_000_000, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const cost = calculateCost(usage, 'unknown-model');
  assert.ok(cost > 0, 'should return non-zero cost using fallback');
});

test('getContextLimit returns known limit for sonnet-4-6', () => {
  assert.equal(getContextLimit('claude-sonnet-4-6'), 200_000);
});

test('getContextLimit returns default 200000 for unknown model', () => {
  assert.equal(getContextLimit('unknown'), 200_000);
});
