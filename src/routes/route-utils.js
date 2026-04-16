'use strict';

const logger = require('../logger');

/**
 * Logs the full error server-side and sends only the generic fallback to the client.
 * Prevents leaking internal paths, stack traces, or third-party error details.
 *
 * @param {import('express').Response} res
 * @param {number} statusCode
 * @param {string} fallbackMessage
 * @param {unknown} error
 */
function safeRouteError(res, statusCode, fallbackMessage, error) {
  logger.error(fallbackMessage, {
    scope: 'assistant-routes',
    error: String(error?.message || error || 'unknown'),
  });
  res.status(statusCode).json({ ok: false, error: fallbackMessage });
}

/**
 * Returns middleware that sets a Cache-Control header on the response.
 *
 * @param {number} maxAge - Cache duration in seconds
 * @returns {import('express').RequestHandler}
 */
function cacheControl(maxAge) {
  return (req, res, next) => {
    res.set('Cache-Control', `public, max-age=${maxAge}`);
    next();
  };
}

module.exports = { safeRouteError, cacheControl };
