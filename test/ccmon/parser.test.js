'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAssistantEvent, findJSONLFiles } = require('../../ccmon/parser.js');

const SAMPLE_ASSISTANT_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-04-08T12:05:44.000Z',
  model: 'claude-sonnet-4-6',
  message: {
    usage: {
      input_tokens: 2430,
      output_tokens: 380,
      cache_read_input_tokens: 3200,
      cache_creation_input_tokens: 800,
    },
  },
});

const SAMPLE_USER_LINE = JSON.stringify({
  type: 'user',
  timestamp: '2026-04-08T12:05:43.000Z',
  message: { role: 'user', content: [] },
});

const SAMPLE_ZERO_LINE = JSON.stringify({
  type: 'assistant',
  timestamp: '2026-04-08T12:05:44.000Z',
  model: 'claude-sonnet-4-6',
  message: { usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } },
});

test('parseAssistantEvent returns event for valid assistant line', () => {
  const result = parseAssistantEvent(SAMPLE_ASSISTANT_LINE);
  assert.ok(result);
  assert.equal(result.model, 'claude-sonnet-4-6');
  assert.equal(result.tokensIn, 2430);
  assert.equal(result.tokensOut, 380);
  assert.equal(result.cacheRead, 3200);
  assert.equal(result.cacheWrite, 800);
  assert.ok(result.timestamp instanceof Date);
  assert.ok(typeof result.costUSD === 'number');
  assert.ok(result.costUSD > 0);
});

test('parseAssistantEvent returns null for user lines', () => {
  assert.equal(parseAssistantEvent(SAMPLE_USER_LINE), null);
});

test('parseAssistantEvent returns null for zero-usage assistant lines', () => {
  assert.equal(parseAssistantEvent(SAMPLE_ZERO_LINE), null);
});

test('parseAssistantEvent returns null for malformed JSON', () => {
  assert.equal(parseAssistantEvent('{bad json'), null);
});

test('parseAssistantEvent returns null for empty line', () => {
  assert.equal(parseAssistantEvent(''), null);
  assert.equal(parseAssistantEvent('  '), null);
});
