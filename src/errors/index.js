'use strict';

// ── Typed Error Hierarchy ──────────────────────────────────────────

/**
 * Base application error with machine-readable code and HTTP status.
 * All domain errors extend this class. The `code` field enables
 * downstream CloudWatch metric filters and structured logging.
 *
 * @param {string} code    - Machine-readable error code (e.g. 'VALIDATION_ERROR')
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Human-readable description
 * @param {Error}  [cause] - Original error, if wrapping
 */
class AppError extends Error {
  constructor(code, statusCode, message, cause) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Input failed schema or business-rule validation.
 *
 * @param {string} message          - What went wrong
 * @param {Record<string, string>} [fields] - Per-field error messages
 * @param {Error}  [cause]          - Original error, if wrapping
 */
class ValidationError extends AppError {
  constructor(message, fields, cause) {
    super('VALIDATION_ERROR', 400, message, cause);
    this.name = 'ValidationError';
    this.fields = fields || {};
  }
}

/**
 * Requested resource does not exist.
 *
 * @param {string} resource - Resource type (e.g. 'Workspace', 'User')
 * @param {string} [id]    - Resource identifier, if known
 * @param {Error}  [cause] - Original error, if wrapping
 */
class NotFoundError extends AppError {
  constructor(resource, id, cause) {
    super('NOT_FOUND', 404, `${resource}${id ? ` ${id}` : ''} not found`, cause);
    this.name = 'NotFoundError';
  }
}

/**
 * Authentication required or credentials invalid.
 *
 * @param {string} [message='Authentication required'] - Reason
 * @param {Error}  [cause] - Original error, if wrapping
 */
class AuthError extends AppError {
  constructor(message = 'Authentication required', cause) {
    super('AUTH_ERROR', 401, message, cause);
    this.name = 'AuthError';
  }
}

/**
 * Operation conflicts with current resource state.
 *
 * @param {string} message - What conflicted
 * @param {Error}  [cause] - Original error, if wrapping
 */
class ConflictError extends AppError {
  constructor(message, cause) {
    super('CONFLICT', 409, message, cause);
    this.name = 'ConflictError';
  }
}

module.exports = { AppError, ValidationError, NotFoundError, AuthError, ConflictError };
