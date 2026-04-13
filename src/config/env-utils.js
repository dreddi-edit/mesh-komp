'use strict';

/**
 * Shared environment-variable parsing utilities.
 * Single source of truth — no other module should inline these functions.
 *
 * @module config/env-utils
 */

/**
 * Parse a raw env string as a boolean, returning a fallback for empty/ambiguous values.
 *
 * @param {string | undefined | null} rawValue
 * @param {boolean} [fallback=false]
 * @returns {boolean}
 */
function parseBooleanFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse a raw env string as an integer, clamped to [min, max].
 *
 * @param {string | undefined} rawValue
 * @param {number} fallback
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function parseIntegerInRange(rawValue, fallback, min, max) {
  const numeric = Number(rawValue);
  const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(max, Math.max(min, selected));
}

/**
 * Clamp a Brotli quality setting to the valid 0-11 range.
 *
 * @param {string | undefined} rawValue
 * @param {number} fallback
 * @returns {number}
 */
function clampBrotliQuality(rawValue, fallback) {
  const numeric = Number(rawValue);
  const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(11, Math.max(0, selected));
}

/**
 * Trim trailing slashes from a URL or path string.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/g, '');
}

/**
 * Normalize a SAS token by stripping leading '?' characters.
 *
 * @param {string | undefined} rawToken
 * @returns {string}
 */
function normalizeSasToken(rawToken) {
  return String(rawToken || '').trim().replace(/^\?+/, '');
}

/**
 * Sanitize a blob container name to lowercase alphanumeric + hyphens only.
 *
 * @param {string | undefined} rawValue
 * @returns {string}
 */
function sanitizeBlobContainerName(rawValue) {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

module.exports = {
  parseBooleanFlag,
  parseIntegerInRange,
  clampBrotliQuality,
  trimTrailingSlashes,
  normalizeSasToken,
  sanitizeBlobContainerName,
};
