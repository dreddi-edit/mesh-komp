'use strict';

const config = require('../config');

const DEFAULT_STORE_CLEANUP_THRESHOLD = 10_000;

// RFC-1918 and loopback ranges for trusted reverse-proxy detection.
// X-Forwarded-For is only trusted when the direct connection comes from a
// known private-network address (ALB, CloudFront, or local dev proxy).
// An attacker connecting directly from a public IP cannot spoof this header.
const TRUSTED_PROXY_PATTERN = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.)/;

/**
 * Extracts client IP from request.
 * Trusts X-Forwarded-For only when the direct connection originates from a
 * private-network address (reverse proxy / load balancer).
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function getClientIp(req) {
  const remoteAddress = String(req.socket?.remoteAddress || '');
  if (TRUSTED_PROXY_PATTERN.test(remoteAddress)) {
    // Trust the leftmost (client-set) value from X-Forwarded-For only from known proxies.
    const forwarded = String(req.headers['x-forwarded-for'] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)[0];
    if (forwarded) return forwarded;
  }
  return remoteAddress;
}

/**
 * Creates an Express middleware that rate-limits requests per IP.
 * Uses a fixed-window counter with automatic cleanup.
 *
 * @param {{ maxRequests?: number, windowMs?: number, message?: string }} options
 * @returns {import('express').RequestHandler}
 */
function createRateLimiter(options = {}) {
  const maxRequests = options.maxRequests || 100;
  const windowMs = options.windowMs || 60_000;
  const message = options.message || 'Too many requests. Please try again later.';
  const store = new Map();

  return function rateLimiter(req, res, next) {
    const ip = getClientIp(req);
    if (!ip) return next();

    const now = Date.now();
    const record = store.get(ip) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    if (record.count >= maxRequests) {
      const retryAfterSeconds = Math.ceil((record.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
      res.status(429).json({ ok: false, error: message });
      return;
    }

    record.count += 1;
    store.set(ip, record);

    if (store.size > DEFAULT_STORE_CLEANUP_THRESHOLD) {
      for (const [key, val] of store) {
        if (now > val.resetAt) store.delete(key);
      }
    }

    next();
  };
}

const authLimiter = createRateLimiter({
  maxRequests: 15,
  windowMs: 60_000,
  message: 'Too many login attempts. Please try again later.',
});

const apiLimiter = createRateLimiter({
  maxRequests: config.RATE_LIMIT_API_MAX,
  windowMs: config.RATE_LIMIT_API_WINDOW_MS,
  message: 'Too many API requests. Please try again later.',
});

const uploadLimiter = createRateLimiter({
  maxRequests: config.RATE_LIMIT_UPLOAD_MAX,
  windowMs: config.RATE_LIMIT_API_WINDOW_MS,
  message: 'Too many upload requests. Please try again later.',
});

module.exports = {
  getClientIp,
  createRateLimiter,
  authLimiter,
  apiLimiter,
  uploadLimiter,
};
