'use strict';

const logger = require('../logger');

/**
 * Higher-order middleware that validates request body against a Zod schema.
 * Rejects with 400 if validation fails.
 *
 * @param {import('zod').ZodSchema} schema
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.body);

  if (!result.success) {
    const errors = result.error.errors.map((err) => ({
      path: err.path.join('.'),
      message: err.message,
    }));

    logger.warn('Validation failed', {
      path: req.path,
      errors,
      requestId: req.requestId,
    });

    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      details: errors,
    });
  }

  // Replace body with the parsed/coerced data from Zod
  req.body = result.data;
  next();
};

module.exports = { validate };
