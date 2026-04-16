'use strict';

const logger = require('../logger');

/**
 * Higher-order middleware that validates request body against a custom schema.
 * Rejects with 400 if validation fails.
 *
 * @param {Object} schema Custom schema object with validate(data) function
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => (req, res, next) => {
  const result = schema.validate(req.body);

  if (!result.success) {
    logger.warn('Validation failed', {
      path: req.path,
      error: result.error,
      requestId: req.requestId,
    });

    return res.status(400).json({
      ok: false,
      error: 'Validation failed',
      details: [{ message: result.error }],
    });
  }

  // Replace body with the parsed/coerced data from the schema
  req.body = result.data;
  next();
};

module.exports = { validate };
