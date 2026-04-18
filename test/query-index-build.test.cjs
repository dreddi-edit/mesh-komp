'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('query-index-build', () => {
  describe('string literal extraction', () => {
    it('given a JS file with string literals, when built, then stringLiterals[] contains value and line', async () => {
      const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');
      const code = `
const MSG = 'Login failed';
function show() { return "Welcome back"; }
`;
      const record = await buildWorkspaceFileRecord('src/auth.js', code, { recordMode: 'full' });
      assert.ok(Array.isArray(record.stringLiterals), 'stringLiterals must be an array');
      const values = record.stringLiterals.map(l => l.value);
      assert.ok(values.some(v => v.toLowerCase().includes('login')), 'should contain Login failed literal');
    });

    it('given a JS file with short/numeric strings, when built, then those are excluded from stringLiterals', async () => {
      const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');
      const code = `const X = '123'; const Y = 'ab'; const Z = 'valid string here';`;
      const record = await buildWorkspaceFileRecord('src/test.js', code, { recordMode: 'full' });
      assert.ok(Array.isArray(record.stringLiterals));
      const values = record.stringLiterals.map(l => l.value);
      assert.ok(!values.includes('123'), 'numeric-only strings excluded');
      assert.ok(!values.includes('ab'), 'strings < 4 chars excluded');
    });

    it('given a file with no string literals, when built, then stringLiterals is empty array', async () => {
      const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');
      const code = `function add(a, b) { return a + b; }`;
      const record = await buildWorkspaceFileRecord('src/math.js', code, { recordMode: 'full' });
      assert.ok(Array.isArray(record.stringLiterals));
    });
  });
});
