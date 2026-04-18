'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildWorkspaceFileRecord } = require('../mesh-core/src/compression-core.cjs');

describe('call site extraction — buildWorkspaceFileRecord', () => {
  it('given a JS file that calls a function, when built, then callSites[] contains the call', async () => {
    const record = await buildWorkspaceFileRecord('caller.js',
      'function main() {\n  login(userId);\n  logout();\n}\n'
    );
    assert.ok(Array.isArray(record.callSites), 'callSites should be array');
    const loginSite = record.callSites.find(s => s.calleeName === 'login');
    assert.ok(loginSite, 'should find login call site');
    assert.strictEqual(loginSite.callerLine, 2);
  });

  it('given a JS file calling obj.method(), when built, then calleeName is the method name', async () => {
    const record = await buildWorkspaceFileRecord('caller.js',
      'authService.login(userId);\n'
    );
    assert.ok(Array.isArray(record.callSites));
    const site = record.callSites.find(s => s.calleeName === 'login');
    assert.ok(site, 'should extract method name "login" from authService.login()');
  });

  it('given a file record before enrichment, then callSites have callerLine and calleeName but no resolvedFile', async () => {
    const record = await buildWorkspaceFileRecord('caller.js', 'foo();\n');
    const site = record.callSites[0];
    if (site) {
      assert.ok('callerLine' in site);
      assert.ok('calleeName' in site);
      assert.ok(!('resolvedFile' in site) || site.resolvedFile === undefined || site.resolvedFile === null);
    }
  });
});
