'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('capsule exports section — CAP-01', () => {
  it('given a JS file with exported function, when built, then capsule has exports section', async () => {
    const record = await buildWorkspaceFileRecord('auth.js', 'export function login(userId) {\n  return userId;\n}\n');
    const sections = record.capsuleBase?.sections || [];
    const exportsSection = sections.find(s => s.name === 'exports');
    assert.ok(exportsSection, 'exports section should exist');
    assert.ok(exportsSection.items.length >= 1, 'should have at least one export entry');
    assert.ok(exportsSection.items[0].text.includes('login'), 'first entry should reference login');
  });

  it('given a JS file with exported function, when built, then symbols entry has isExported true', async () => {
    const record = await buildWorkspaceFileRecord('auth.js', 'export function login(userId) {\n  return userId;\n}\n');
    assert.ok(Array.isArray(record.symbols), 'symbols should be an array');
    const loginSym = record.symbols.find(s => s.name === 'login');
    assert.ok(loginSym, 'login symbol should exist');
    assert.strictEqual(loginSym.isExported, true, 'login should be marked isExported');
  });

  it('given a JS file with only non-exported functions, when built, then no exports section', async () => {
    const record = await buildWorkspaceFileRecord('util.js', 'function helper(x) {\n  return x * 2;\n}\n');
    const sections = record.capsuleBase?.sections || [];
    const exportsSection = sections.find(s => s.name === 'exports');
    assert.ok(!exportsSection, 'exports section should not exist for non-exported file');
  });
});
