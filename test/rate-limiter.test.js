'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { createRateLimiter, getClientIp } = require('../src/middleware/rate-limiter');

function mockReq(ip, forwardedFor) {
  const req = {
    headers: {},
    socket: { remoteAddress: ip },
  };
  if (forwardedFor) req.headers['x-forwarded-for'] = forwardedFor;
  return req;
}

function mockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(key, value) { res.headers[key] = value; },
    status(code) { res.statusCode = code; return res; },
    json(data) { res.body = data; },
  };
  return res;
}

describe('getClientIp', () => {
  it('returns X-Forwarded-For when present', () => {
    const req = mockReq('127.0.0.1', '203.0.113.50, 70.41.3.18');
    assert.equal(getClientIp(req), '203.0.113.50');
  });

  it('falls back to socket remoteAddress', () => {
    const req = mockReq('192.168.1.1');
    assert.equal(getClientIp(req), '192.168.1.1');
  });
});

describe('createRateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = createRateLimiter({ maxRequests: 3, windowMs: 60_000 });
    const req = mockReq('10.0.0.1');
    const res = mockRes();
    let called = false;

    limiter(req, res, () => { called = true; });
    assert.equal(called, true);
    assert.equal(res.statusCode, 200);
  });

  it('blocks requests over the limit with 429 and Retry-After header', () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 60_000 });
    const req = mockReq('10.0.0.2');

    limiter(req, mockRes(), () => {});
    limiter(req, mockRes(), () => {});

    const res = mockRes();
    let called = false;
    limiter(req, res, () => { called = true; });

    assert.equal(called, false);
    assert.equal(res.statusCode, 429);
    assert.ok(res.body.error.includes('Too many requests'));
    assert.ok(Number(res.headers['Retry-After']) > 0);
  });

  it('uses custom error message', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000, message: 'Custom limit' });
    const req = mockReq('10.0.0.3');

    limiter(req, mockRes(), () => {});

    const res = mockRes();
    limiter(req, res, () => {});

    assert.equal(res.body.error, 'Custom limit');
  });

  it('isolates different IPs', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 60_000 });

    const req1 = mockReq('10.0.0.10');
    const req2 = mockReq('10.0.0.11');

    limiter(req1, mockRes(), () => {});

    let called = false;
    limiter(req2, mockRes(), () => { called = true; });
    assert.equal(called, true);
  });
});
