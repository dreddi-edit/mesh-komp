'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('capsule calls section — CAP-02', () => {
  it('given a JS file calling another function, when built, then capsule has calls section', async () => {
    const record = await buildWorkspaceFileRecord('app.js', 'function main() {\n  login();\n  logout();\n}\n');
    const sections = record.capsuleBase?.sections || [];
    const callsSection = sections.find(s => s.name === 'calls');
    assert.ok(callsSection, 'calls section should exist');
    assert.ok(callsSection.items.length >= 1, 'calls section should have entries');
    const texts = callsSection.items.map(i => i.text);
    assert.ok(texts.some(t => t.includes('login') || t.includes('logout')), 'calls should reference login or logout');
  });

  it('given a JS file with no outgoing calls, when built, then no calls section', async () => {
    const record = await buildWorkspaceFileRecord('constants.js', 'const MAX = 100;\nconst PI = 3.14;\n');
    const sections = record.capsuleBase?.sections || [];
    const callsSection = sections.find(s => s.name === 'calls');
    assert.ok(!callsSection || callsSection.items.length === 0, 'calls section should be absent or empty for pure constants');
  });
});
