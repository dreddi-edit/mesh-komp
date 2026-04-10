'use strict';

/** Per-token pricing in USD. Prices as of 2026-04 — update when Anthropic changes them. */
const PRICING = {
  'claude-opus-4-6':   { input: 15.00 / 1e6, output: 75.00 / 1e6, cacheRead: 1.50 / 1e6, cacheWrite: 18.75 / 1e6 },
  'claude-sonnet-4-6': { input:  3.00 / 1e6, output: 15.00 / 1e6, cacheRead: 0.30 / 1e6, cacheWrite:  3.75 / 1e6 },
  'claude-haiku-4-5':  { input:  0.80 / 1e6, output:  4.00 / 1e6, cacheRead: 0.08 / 1e6, cacheWrite:  1.00 / 1e6 },
  'claude-opus-4-5':   { input: 15.00 / 1e6, output: 75.00 / 1e6, cacheRead: 1.50 / 1e6, cacheWrite: 18.75 / 1e6 },
  'claude-sonnet-4-5': { input:  3.00 / 1e6, output: 15.00 / 1e6, cacheRead: 0.30 / 1e6, cacheWrite:  3.75 / 1e6 },
};

/** Context window limits in tokens. */
const CONTEXT_LIMITS = {
  'claude-opus-4-6':   200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-haiku-4-5':  200_000,
  'claude-opus-4-5':   200_000,
  'claude-sonnet-4-5': 200_000,
};

const FALLBACK_PRICING = PRICING['claude-sonnet-4-6'];
const DEFAULT_CONTEXT_LIMIT = 200_000;

/**
 * Calculate USD cost for a single API response's usage.
 * @param {{ input_tokens: number, output_tokens: number, cache_read_input_tokens: number, cache_creation_input_tokens: number }} usage
 * @param {string} model
 * @returns {number} cost in USD
 */
function calculateCost(usage, model) {
  const p = PRICING[model] ?? FALLBACK_PRICING;
  const cacheRead  = usage.cache_read_input_tokens  ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  // input_tokens is the total including cache_read and cache_write tokens.
  // Only the remainder is billed at the regular input rate.
  const regularInput = Math.max(0, (usage.input_tokens ?? 0) - cacheRead - cacheWrite);
  return (
    regularInput * p.input +
    (usage.output_tokens ?? 0) * p.output +
    cacheRead  * p.cacheRead +
    cacheWrite * p.cacheWrite
  );
}

/**
 * Get context window token limit for a model.
 * @param {string} model
 * @returns {number}
 */
function getContextLimit(model) {
  return CONTEXT_LIMITS[model] ?? DEFAULT_CONTEXT_LIMIT;
}

module.exports = { PRICING, calculateCost, getContextLimit };
