'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Not exported yet — will fail until realtime.routes.js exports helpers
const {
  listVoiceContextPaths,
  buildVoiceCapsuleContext,
} = require('../src/routes/realtime.routes');

describe('realtime-routes / listVoiceContextPaths', () => {
  it('given preferred paths in context, when called, then returns those paths (up to 6)', async () => {
    const context = {
      activeFilePath: 'src/a.js',
      selectedPaths: ['src/b.js', 'src/c.js'],
    };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: {},
      workspaceMetadataStore: { enabled: false },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.deepEqual(result, ['src/a.js', 'src/b.js', 'src/c.js']);
  });

  it('given no preferred paths and workspaceMetadataStore is enabled, when called, then returns store paths', async () => {
    const context = { activeFilePath: '', selectedPaths: [], workspaceId: 'ws-3' };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { workspaceId: 'ws-3', files: new Map() },
      workspaceMetadataStore: {
        enabled: true,
        listWorkspaceFiles: async () => [
          { path: 'lib/x.js' },
          { path: 'lib/y.js' },
        ],
      },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.ok(result.includes('lib/x.js'));
    assert.ok(result.includes('lib/y.js'));
  });

  it('given no preferred paths and no store, when called, then returns workspace file keys', async () => {
    const context = { activeFilePath: '', selectedPaths: [] };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: {
        files: new Map([['src/foo.js', {}], ['src/bar.js', {}]]),
      },
      workspaceMetadataStore: { enabled: false },
    };

    const result = await listVoiceContextPaths(context, core);

    assert.ok(result.includes('src/foo.js'));
  });
});

describe('realtime-routes / buildVoiceCapsuleContext', () => {
  it('given no workspace paths, when called, then returns empty string', async () => {
    const voiceSession = { getContextSnapshot: () => ({ activeFilePath: '', selectedPaths: [] }) };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { files: new Map() },
      workspaceMetadataStore: { enabled: false },
      loadCapsuleContextEntries: async () => ({ entries: [] }),
      buildCapsuleContextBlock: () => '',
    };

    const result = await buildVoiceCapsuleContext(voiceSession, core);

    assert.equal(result, '');
  });

  it('given workspace paths exist, when called, then returns capsule context block', async () => {
    const voiceSession = {
      getContextSnapshot: () => ({ activeFilePath: 'src/index.js', selectedPaths: [] }),
    };
    const core = {
      dedupePaths: (arr) => [...new Set(arr.filter(Boolean))],
      toSafePath: (p) => String(p || '').trim(),
      localAssistantWorkspace: { files: new Map() },
      workspaceMetadataStore: { enabled: false },
      loadCapsuleContextEntries: async (paths) => ({ entries: [{ path: paths[0], content: 'console.log(1)' }] }),
      buildCapsuleContextBlock: (entries) => `<capsule>${entries[0].path}</capsule>`,
    };

    const result = await buildVoiceCapsuleContext(voiceSession, core);

    assert.equal(result, '<capsule>src/index.js</capsule>');
  });
});
