'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('capsule resolved-imports section — CAP-03', () => {
  it('given a file importing a workspace file, when built with workspaceFilePaths, then resolved-imports section exists', async () => {
    const record = await buildWorkspaceFileRecord(
      'src/app.js',
      "const auth = require('./auth-service');\nfunction main() { auth.login(); }\n",
      { workspaceFilePaths: ['src/auth-service.js'] }
    );
    const sections = record.capsuleBase?.sections || [];
    const riSection = sections.find(s => s.name === 'resolved-imports');
    assert.ok(riSection, 'resolved-imports section should exist');
    assert.ok(riSection.items.length >= 1, 'should have at least one resolved import');
    assert.ok(riSection.items[0].text.includes('auth-service'), 'entry should reference auth-service');
  });

  it('given a file importing only npm packages, when built, then no resolved-imports section', async () => {
    const record = await buildWorkspaceFileRecord(
      'src/app.js',
      "const express = require('express');\nconst _ = require('lodash');\n",
      { workspaceFilePaths: ['src/auth-service.js'] }
    );
    const sections = record.capsuleBase?.sections || [];
    const riSection = sections.find(s => s.name === 'resolved-imports');
    assert.ok(!riSection || riSection.items.length === 0, 'resolved-imports should be absent for npm-only imports');
  });
});
