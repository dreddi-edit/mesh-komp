'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord, buildWorkspaceFileView } = require('../mesh-core/src/compression-core.cjs');

function makeLines(n) {
  return Array.from({ length: n }, (_, i) => `const line${i + 1} = ${i + 1};`).join('\n') + '\n';
}

describe('large file chunking — view="original" — READ-02 / READ-04', () => {
  it('given a file with <= 300 lines, when view="original", then returns unchunked full content', async () => {
    const code = makeLines(50);
    const record = await buildWorkspaceFileRecord('small.js', code);
    const result = await buildWorkspaceFileView(record, 'original');
    assert.strictEqual(result.view, 'original');
    assert.ok(!result.chunked, 'chunked should be falsy for small files');
    assert.ok(result.content.includes('line1'), 'content should include all lines');
    assert.ok(result.content.includes('line50'), 'content should include last line');
  });

  it('given a file with > 300 lines, when view="original", then auto-chunks and returns chunk 0 with metadata', async () => {
    const code = makeLines(400);
    const record = await buildWorkspaceFileRecord('large.js', code);
    const result = await buildWorkspaceFileView(record, 'original');
    assert.strictEqual(result.view, 'original');
    assert.strictEqual(result.chunked, true, 'chunked should be true');
    assert.strictEqual(result.chunkIndex, 0, 'chunkIndex should be 0 by default');
    assert.ok(Number.isInteger(result.totalChunks) && result.totalChunks > 1, 'totalChunks should be > 1');
    assert.ok(typeof result.lineRange === 'object', 'lineRange should be present');
    assert.ok(Number.isInteger(result.lineRange.start));
    assert.ok(Number.isInteger(result.lineRange.end));
  });

  it('given a large file, when chunkIndex=1 requested, then returns second chunk lines', async () => {
    const code = makeLines(400);
    const record = await buildWorkspaceFileRecord('large.js', code);
    const chunk0 = await buildWorkspaceFileView(record, 'original', { chunkIndex: 0 });
    const chunk1 = await buildWorkspaceFileView(record, 'original', { chunkIndex: 1 });
    assert.strictEqual(chunk1.chunkIndex, 1, 'chunkIndex should be 1');
    assert.ok(chunk1.lineRange.start > chunk0.lineRange.end, 'chunk1 starts after chunk0 ends');
  });

  it('given chunk 0 of a large file, then content starts with chunk header "## large.js lines X-Y (chunk 1/N)"', async () => {
    const code = makeLines(400);
    const record = await buildWorkspaceFileRecord('large.js', code);
    const result = await buildWorkspaceFileView(record, 'original');
    assert.ok(result.content.startsWith('## large.js lines '), 'content should start with chunk header');
    assert.ok(/chunk 1\/\d+/.test(result.content), 'header should contain "chunk 1/N"');
  });
});
