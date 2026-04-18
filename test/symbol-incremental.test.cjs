'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('incremental symbol update logic', () => {
  it('given a file record, its symbols can be added to a symbolMap without full reindex', async () => {
    const record = await buildWorkspaceFileRecord('auth.js', 'function login(u) { return u; }\nfunction logout() {}\n');
    const symbolMap = new Map();
    for (const sym of (record.symbols || [])) {
      const existing = symbolMap.get(sym.name) || [];
      existing.push({ file: 'auth.js', lineStart: sym.lineStart, lineEnd: sym.lineEnd, kind: sym.kind });
      symbolMap.set(sym.name, existing);
    }
    assert.ok(symbolMap.has('login'), 'symbolMap should have login');
    assert.ok(symbolMap.has('logout'), 'symbolMap should have logout');
    const loginEntry = symbolMap.get('login')[0];
    assert.strictEqual(loginEntry.file, 'auth.js');
    assert.ok(loginEntry.lineStart >= 1);
  });
});
