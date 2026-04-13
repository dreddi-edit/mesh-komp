'use strict';

/**
 * Minimal structured JSON logger for the Mesh gateway.
 *
 * Outputs newline-delimited JSON to stdout (debug/info) or stderr (warn/error).
 * Controlled by LOG_LEVEL env var: debug | info | warn | error (default: info).
 *
 * Usage:
 *   const logger = require('./logger');
 *   logger.info('Server started', { port: 8080 });
 *   logger.error('Unhandled exception', { err: error.message, requestId });
 */

const config = require('./config');

const LEVEL_VALUES = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL = LEVEL_VALUES[config.LOG_LEVEL] ?? LEVEL_VALUES.info;

/**
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} msg
 * @param {Record<string, unknown>} [ctx]
 */
function write(level, msg, ctx = {}) {
  if ((LEVEL_VALUES[level] ?? 0) < MIN_LEVEL) return;
  const entry = { ts: new Date().toISOString(), level, msg, ...ctx };
  const line = JSON.stringify(entry) + '\n';
  if (level === 'warn' || level === 'error') {
    process.stderr.write(line);
  } else {
    process.stdout.write(line);
  }
}

module.exports = {
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  debug: (msg, ctx) => write('debug', msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  info:  (msg, ctx) => write('info',  msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  warn:  (msg, ctx) => write('warn',  msg, ctx),
  /** @param {string} msg @param {Record<string, unknown>} [ctx] */
  error: (msg, ctx) => write('error', msg, ctx),
};
