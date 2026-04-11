'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Not exported yet — will fail until terminal.routes.js exports helpers
const {
  listMaterializableWorkspaceFiles,
  resolveTerminalCwd,
} = require('../src/routes/terminal.routes');

describe('terminal-routes / listMaterializableWorkspaceFiles', () => {
  it('given workspaceMetadataStore is disabled, when called, then returns files from workspace.files map', async () => {
    const workspace = {
      workspaceId: 'ws-1',
      files: new Map([
        ['a/b.js', { path: 'a/b.js', status: 'completed' }],
        ['c/d.js', { path: 'c/d.js', status: 'completed' }],
      ]),
    };
    const deps = { workspaceMetadataStore: { enabled: false } };

    const result = await listMaterializableWorkspaceFiles(workspace, deps);

    assert.equal(result.length, 2);
    assert.ok(result.some((r) => r.path === 'a/b.js'));
  });

  it('given workspaceMetadataStore is enabled, when called, then returns only completed docs from store', async () => {
    const workspace = { workspaceId: 'ws-2', files: new Map() };
    const deps = {
      workspaceMetadataStore: {
        enabled: true,
        listWorkspaceFiles: async (id) => {
          assert.equal(id, 'ws-2');
          return [
            { path: 'x/y.js', status: 'completed' },
            { path: 'z/w.js', status: 'pending' },
          ];
        },
      },
    };

    const result = await listMaterializableWorkspaceFiles(workspace, deps);

    assert.equal(result.length, 1);
    assert.equal(result[0].path, 'x/y.js');
  });
});

describe('terminal-routes / resolveTerminalCwd', () => {
  it('given a local-path workspace, when called, then returns workspace rootPath', async () => {
    const workspace = { sourceKind: 'local-path', rootPath: '/home/user/project' };
    const deps = { localAssistantWorkspace: workspace };

    const result = await resolveTerminalCwd('/fallback', deps);

    assert.equal(result.cwd, '/home/user/project');
  });

  it('given no active workspace, when called, then returns the fallback projectRoot', async () => {
    const deps = { localAssistantWorkspace: {} };

    const result = await resolveTerminalCwd('/fallback', deps);

    assert.equal(result.cwd, '/fallback');
  });
});
