'use strict';

const { doubleCsrf } = require('csrf-csrf');
const config = require('../config');

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.CSRF_SECRET,
  getSessionIdentifier: (req) => req.ip ?? '',
  cookieName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.IS_PRODUCTION,
    path: '/',
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
  size: 64,
  errorConfig: { statusCode: 403, message: 'Invalid CSRF token', code: 'EBADCSRFTOKEN' },
});

module.exports = { csrfProtection: doubleCsrfProtection, generateToken: generateCsrfToken };
