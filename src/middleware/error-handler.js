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
  const statusCode = isAppError ? err.statusCode : 500;
  const code = isAppError ? err.code : 'INTERNAL_ERROR';

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
    body.error = 'Internal server error';
  }

  res.status(statusCode).json(body);
}

module.exports = { errorHandler };
