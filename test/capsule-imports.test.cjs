'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('capsule resolved-imports section — CAP-03', () => {
  it('given a file importing a workspace file, when built with workspaceFilePaths, then resolved-imports section exists', async () => {
    assert.ok(true, 'stub — implement after 45-02-02');
  });

  it('given a file importing only npm packages, when built, then no resolved-imports section', async () => {
    assert.ok(true, 'stub — implement after 45-02-02');
  });
});
