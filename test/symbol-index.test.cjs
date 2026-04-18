'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('symbol extraction — buildWorkspaceFileRecord', () => {
  it('given a JS file with function declarations, when built, then symbols[] is populated', async () => {
    const record = await buildWorkspaceFileRecord('test.js', 'function login(userId) {\n  return userId;\n}\nfunction logout() {}\n');
    assert.ok(Array.isArray(record.symbols), 'symbols should be an array');
    assert.ok(record.symbols.length >= 1, 'should find at least one symbol');
    const login = record.symbols.find(s => s.name === 'login');
    assert.ok(login, 'should find login function');
    assert.strictEqual(typeof login.lineStart, 'number');
    assert.strictEqual(typeof login.lineEnd, 'number');
    assert.ok(login.lineStart >= 1);
    assert.ok(login.lineEnd >= login.lineStart);
  });

  it('given a TS file with class declaration, when built, then symbols[] contains class entry', async () => {
    const record = await buildWorkspaceFileRecord('auth.ts', 'class AuthService {\n  login(id: string) {\n    return id;\n  }\n}\n');
    assert.ok(Array.isArray(record.symbols));
    const cls = record.symbols.find(s => s.name === 'AuthService');
    assert.ok(cls, 'should find AuthService class');
  });

  it('given a file record, then it has callSites as an empty array initially', async () => {
    const record = await buildWorkspaceFileRecord('test.js', 'function foo() {}');
    assert.ok(Array.isArray(record.callSites), 'callSites should be an array');
  });
});
