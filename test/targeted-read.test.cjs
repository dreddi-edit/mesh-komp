'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord, buildWorkspaceFileView } = require('../mesh-core/src/compression-core.cjs');

describe('targeted read — view="targeted" — READ-01 / READ-03', () => {
  it('given a file with a named function, when view="targeted" with symbolName="login", then returns only that function\'s lines', async () => {
    const code = 'function helper() { return 1; }\nfunction login(userId) {\n  const token = userId + \'_tok\';\n  return token;\n}\nfunction logout() { return null; }\n';
    const record = await buildWorkspaceFileRecord('auth.js', code);
    const result = await buildWorkspaceFileView(record, 'targeted', { symbolName: 'login', contextLines: 0 });
    assert.strictEqual(result.view, 'targeted', 'view should be "targeted"');
    assert.ok(result.content.includes('function login'), 'content should include login function');
    assert.ok(!result.content.includes('function helper'), 'content should not include helper function');
    assert.ok(!result.content.includes('function logout'), 'content should not include logout function');
  });

  it('given a targeted read result, then lineRange has start and end as integers', async () => {
    const code = 'function alpha() { return 1; }\nfunction beta(x) {\n  return x * 2;\n}\n';
    const record = await buildWorkspaceFileRecord('util.js', code);
    const result = await buildWorkspaceFileView(record, 'targeted', { symbolName: 'beta' });
    assert.strictEqual(result.view, 'targeted');
    assert.ok(typeof result.lineRange === 'object', 'lineRange should be an object');
    assert.ok(Number.isInteger(result.lineRange.start), 'lineRange.start should be integer');
    assert.ok(Number.isInteger(result.lineRange.end), 'lineRange.end should be integer');
    assert.ok(result.lineRange.start >= 1);
    assert.ok(result.lineRange.end >= result.lineRange.start);
  });

  it('given contextLines=2, when targeted read, then range extends ±2 lines around symbol', async () => {
    const code = 'const A = 1;\nconst B = 2;\nfunction target() {\n  return A + B;\n}\nconst C = 3;\nconst D = 4;\n';
    const record = await buildWorkspaceFileRecord('math.js', code);
    const result = await buildWorkspaceFileView(record, 'targeted', { symbolName: 'target', contextLines: 2 });
    assert.strictEqual(result.view, 'targeted');
    assert.ok(result.lineRange.start <= 3, 'start should extend up to 2 lines before symbol (symbol at line 3)');
    assert.ok(result.lineRange.end >= 5, 'end should extend at least to symbol end (symbol ends line 5)');
  });

  it('given symbolName not found in symbols[], when targeted read, then returns fallback with full content', async () => {
    const code = 'function foo() { return 1; }\n';
    const record = await buildWorkspaceFileRecord('foo.js', code);
    const result = await buildWorkspaceFileView(record, 'targeted', { symbolName: 'nonExistent' });
    assert.strictEqual(result.view, 'targeted');
    assert.strictEqual(result.fallback, true, 'fallback should be true when symbol not found');
    assert.ok(result.content.includes('function foo'), 'fallback content should include full file');
  });
});
