'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { formatSymbolChain } = require('../mesh-core/src/compression-core.cjs');

describe('symbol context format', () => {
  it('given call sites with resolved files, formatSymbolChain returns readable chain', () => {
    const callSites = [
      { callerLine: 24, calleeName: 'login', resolvedFile: 'src/auth.js', resolvedLine: 58 },
      { callerLine: 30, calleeName: 'logout', resolvedFile: 'src/auth.js', resolvedLine: 72 },
    ];
    const symbolMap = new Map([['login', [{ file: 'src/auth.js', lineStart: 58, lineEnd: 70 }]]]);
    const result = formatSymbolChain('src/login-form.js', callSites, symbolMap);
    assert.ok(Array.isArray(result));
    assert.ok(result.length >= 1);
    assert.ok(result[0].includes('login()'), `Expected chain to mention "login()", got: ${result[0]}`);
    assert.ok(result[0].includes('src/auth.js'), `Expected chain to mention "src/auth.js", got: ${result[0]}`);
    assert.ok(result[0].includes('L58'), `Expected chain to mention "L58", got: ${result[0]}`);
  });

  it('given unresolved call sites, formatSymbolChain returns empty array', () => {
    const callSites = [
      { callerLine: 24, calleeName: 'unknownFn' },
    ];
    const result = formatSymbolChain('src/app.js', callSites, new Map());
    assert.deepStrictEqual(result, []);
  });
});
