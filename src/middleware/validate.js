'use strict';

const logger = require('../logger');
const { ValidationError } = require('../errors');

/**
 * Converts a Zod error into a flat `{ field: message }` map.
 *
 * @param {import('zod').ZodError} zodError
 * @returns {Record<string, string>}
 */
function formatZodErrors(zodError) {
  const fields = {};
  for (const issue of zodError.issues) {
    const path = issue.path.join('.') || '_root';
    fields[path] = issue.message;
  }
  return fields;
}

/**
 * Returns Express middleware that validates request data against a Zod schema.
 * On success, sets `req.validated` to the parsed data.
 * On failure, throws a `ValidationError` with per-field detail.
 *
 * @param {import('zod').ZodTypeAny} schema  Zod schema to validate against
 * @param {'body' | 'query' | 'params'} [source='body']  Which req property to validate
 * @returns {import('express').RequestHandler}
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const result = schema.safeParse(req[source]);

  if (!result.success) {
    const fields = formatZodErrors(result.error);
    logger.warn('Validation failed', {
      path: req.path,
      fields,
      requestId: req.requestId,
    });
    return next(new ValidationError('Validation failed', fields));
  }

  req.validated = result.data;
  // Keep req.body in sync so downstream code that reads req.body directly still works.
  if (source === 'body') {
    req.body = result.data;
  }
  next();
};

module.exports = { validate };
