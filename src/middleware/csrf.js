'use strict';

const { doubleCsrf } = require('csrf-csrf');
const config = require('../config');

const { generateToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => config.CSRF_SECRET,
  cookieName: '_csrf',
  cookieOptions: {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.IS_PRODUCTION,
    path: '/',
  },
  getTokenFromRequest: (req) => req.headers['x-csrf-token'],
  size: 64,
});

module.exports = { csrfProtection: doubleCsrfProtection, generateToken };
