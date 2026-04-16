'use strict';

const { AppError, ValidationError } = require('../errors');
const logger = require('../logger');

/**
 * Centralized Express error-handling middleware.
 * Maps AppError subclasses to structured JSON responses matching
 * the existing `{ ok, error }` envelope format.
 *
 * Must be mounted AFTER all routes as the last `app.use()`.
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} _next
 */
function errorHandler(err, req, res, _next) {
  const isAppError = err instanceof AppError;
  // http-errors (used by csrf-csrf, etc.) uses err.status; prefer that over the
  // default 500 when it carries a 4xx code so CSRF rejections return 403.
  const httpStatus = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : null;
  const statusCode = isAppError ? err.statusCode : (httpStatus ?? 500);
  const code = isAppError ? err.code : (err.code ?? 'INTERNAL_ERROR');

  logger.error('Request error', {
    requestId: req.requestId,
    statusCode,
    code,
    error: err.message,
    stack: err.stack,
  });

  const body = { ok: false, error: err.message };

  if (err instanceof ValidationError && Object.keys(err.fields).length > 0) {
    body.fields = err.fields;
  }

  if (!isAppError) {
    // Pass through the message for known client errors (4xx) from trusted middleware
    // (e.g. csrf-csrf throws http-errors 403); mask everything else as opaque 500.
    body.error = httpStatus ? err.message : 'Internal server error';
  }

  res.status(statusCode).json(body);
}

module.exports = { errorHandler };
