'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeEmail,
  hashPassword,
  verifyPassword,
  sanitizeAuthUser,
  parseCookiesFromHeader,
  decodeCookieValue,
  normalizeSameSiteValue,
  createCookieHeader,
  normalizeUserStoreKey,
  normalizeRequestedStoreKeys,
} = require('../src/core/auth');

describe('normalizeEmail', () => {
  it('lowercases and trims email', () => {
    assert.equal(normalizeEmail('  Alice@Example.COM  '), 'alice@example.com');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(normalizeEmail(null), '');
    assert.equal(normalizeEmail(undefined), '');
    assert.equal(normalizeEmail(''), '');
  });
});

describe('hashPassword / verifyPassword', () => {
  it('produces a salt:hash string', () => {
    const result = hashPassword('secret123');
    assert.ok(result.includes(':'));
    const [salt, hash] = result.split(':');
    assert.equal(salt.length, 32);
    assert.equal(hash.length, 128);
  });

  it('verifies a correct password', () => {
    const stored = hashPassword('mypassword');
    assert.equal(verifyPassword('mypassword', stored), true);
  });

  it('rejects an incorrect password', () => {
    const stored = hashPassword('mypassword');
    assert.equal(verifyPassword('wrongpassword', stored), false);
  });

  it('rejects empty or malformed stored hash', () => {
    assert.equal(verifyPassword('anything', ''), false);
    assert.equal(verifyPassword('anything', 'noseparator'), false);
    assert.equal(verifyPassword('anything', ':'), false);
  });

  it('uses provided salt for deterministic output', () => {
    const salt = 'a'.repeat(32);
    const result1 = hashPassword('test', salt);
    const result2 = hashPassword('test', salt);
    assert.equal(result1, result2);
  });
});

describe('sanitizeAuthUser', () => {
  it('extracts and stringifies user fields', () => {
    const user = { id: 42, email: 'test@test.com', name: 'Test', role: 'admin', createdAt: '2024-01-01' };
    const result = sanitizeAuthUser(user);
    assert.deepEqual(result, {
      id: '42',
      email: 'test@test.com',
      name: 'Test',
      role: 'admin',
      createdAt: '2024-01-01',
    });
  });

  it('defaults missing fields to empty strings or "user"', () => {
    const result = sanitizeAuthUser({});
    assert.equal(result.id, '');
    assert.equal(result.role, 'user');
  });

  it('handles null/undefined input', () => {
    const result = sanitizeAuthUser(null);
    assert.equal(result.id, '');
    assert.equal(result.email, '');
  });
});

describe('parseCookiesFromHeader', () => {
  it('parses standard cookie header', () => {
    const result = parseCookiesFromHeader('session=abc123; theme=dark');
    assert.equal(result.session, 'abc123');
    assert.equal(result.theme, 'dark');
  });

  it('returns empty object for empty/null input', () => {
    assert.deepEqual(parseCookiesFromHeader(''), {});
    assert.deepEqual(parseCookiesFromHeader(null), {});
  });

  it('skips malformed entries', () => {
    const result = parseCookiesFromHeader('valid=yes; =nokey; badentry');
    assert.equal(result.valid, 'yes');
    assert.equal(Object.keys(result).length, 1);
  });
});

describe('decodeCookieValue', () => {
  it('decodes URI-encoded values', () => {
    assert.equal(decodeCookieValue('hello%20world'), 'hello world');
  });

  it('returns raw value for invalid encoding', () => {
    assert.equal(decodeCookieValue('%ZZ'), '%ZZ');
  });

  it('returns empty string for falsy input', () => {
    assert.equal(decodeCookieValue(''), '');
    assert.equal(decodeCookieValue(null), '');
  });
});

describe('normalizeSameSiteValue', () => {
  it('normalizes known values', () => {
    assert.equal(normalizeSameSiteValue('strict'), 'Strict');
    assert.equal(normalizeSameSiteValue('NONE'), 'None');
    assert.equal(normalizeSameSiteValue('lax'), 'Lax');
  });

  it('defaults to Lax for unknown values', () => {
    assert.equal(normalizeSameSiteValue(''), 'Lax');
    assert.equal(normalizeSameSiteValue('invalid'), 'Lax');
    assert.equal(normalizeSameSiteValue(null), 'Lax');
  });
});

describe('createCookieHeader', () => {
  it('builds a valid Set-Cookie header', () => {
    const result = createCookieHeader('session', 'abc', { path: '/', maxAge: 3600, sameSite: 'Strict', secure: true });
    assert.ok(result.includes('session=abc'));
    assert.ok(result.includes('Path=/'));
    assert.ok(result.includes('Max-Age=3600'));
    assert.ok(result.includes('SameSite=Strict'));
    assert.ok(result.includes('HttpOnly'));
    assert.ok(result.includes('Secure'));
  });

  it('encodes special characters in value', () => {
    const result = createCookieHeader('token', 'a=b&c');
    assert.ok(result.includes('token=a%3Db%26c'));
  });

  it('omits Secure flag when not set', () => {
    const result = createCookieHeader('token', 'val', { secure: false });
    assert.ok(!result.includes('Secure'));
  });
});

describe('normalizeUserStoreKey', () => {
  it('accepts allowed keys', () => {
    assert.equal(normalizeUserStoreKey('meshAiAnthropic'), 'meshAiAnthropic');
    assert.equal(normalizeUserStoreKey('meshAppearance'), 'meshAppearance');
  });

  it('rejects unknown keys', () => {
    assert.equal(normalizeUserStoreKey('hackerKey'), '');
    assert.equal(normalizeUserStoreKey(''), '');
    assert.equal(normalizeUserStoreKey(null), '');
  });
});

describe('normalizeRequestedStoreKeys', () => {
  it('parses comma-separated keys and deduplicates', () => {
    const result = normalizeRequestedStoreKeys('meshAiAnthropic,meshAppearance,meshAiAnthropic');
    assert.deepEqual(result, ['meshAiAnthropic', 'meshAppearance']);
  });

  it('filters out invalid keys', () => {
    const result = normalizeRequestedStoreKeys('meshAiAnthropic,invalidKey,meshAppearance');
    assert.deepEqual(result, ['meshAiAnthropic', 'meshAppearance']);
  });

  it('returns empty array for empty input', () => {
    assert.deepEqual(normalizeRequestedStoreKeys(''), []);
    assert.deepEqual(normalizeRequestedStoreKeys(null), []);
  });
});
