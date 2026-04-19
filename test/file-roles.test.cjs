'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildFilesMd } = require('../mesh-core/src/workspace-operations.js');

describe('file roles in buildFilesMd — CAP-04', () => {
  it('given workspace files with mixed roles, when buildFilesMd called, then output includes File Roles section', () => {
    const files = [
      { path: 'ws/server.js', dependencies: [] },
      { path: 'ws/auth.routes.js', dependencies: [] },
      { path: 'ws/user.service.js', dependencies: [] },
      { path: 'ws/auth.test.cjs', dependencies: [] },
    ];
    const output = buildFilesMd(files, 'ws');
    assert.ok(output.includes('## File Roles'), 'output should include File Roles section');
    assert.ok(output.includes('| Role | Files |'), 'output should include role table header');
    assert.ok(output.includes('entry-point') || output.includes('route-handler'), 'output should have at least one classified role');
  });

  it('given a test file path, when classified, then role is test', () => {
    const files = [{ path: 'ws/auth.test.cjs', dependencies: [] }];
    const output = buildFilesMd(files, 'ws');
    assert.ok(output.includes('test'), 'test role should appear in file roles table');
  });

  it('given a routes file path, when classified, then role is route-handler', () => {
    const files = [{ path: 'ws/auth.routes.js', dependencies: [] }];
    const output = buildFilesMd(files, 'ws');
    assert.ok(output.includes('route-handler'), 'route-handler role should appear in file roles table');
  });
});
