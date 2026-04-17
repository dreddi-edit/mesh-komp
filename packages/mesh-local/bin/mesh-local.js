#!/usr/bin/env node
'use strict';

const { parseArgs } = require('util'); // Node 18+ built-in

const { values: args } = parseArgs({
  options: {
    token:    { type: 'string' },
    server:   { type: 'string', default: 'https://mesh.ai' },
    launch:   { type: 'boolean', default: false },
    register: { type: 'boolean', default: false },
    help:     { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

if (args.help) {
  console.log(`
mesh-local — Connect your local shell to Mesh

Usage:
  npx mesh-local --token=<TOKEN> [--server=<URL>]
  npx mesh-local --launch "mesh://launch-agent?token=<TOKEN>&server=<URL>"
  npx mesh-local --register   Register the mesh:// URL protocol handler

Options:
  --token    Agent token from your Mesh account settings
  --server   Mesh server URL (default: https://mesh.ai)
  --launch   Handle a mesh:// URL (passed by OS on protocol open)
  --register Register the mesh:// URL handler for this machine
  --help     Show this help
`);
  process.exit(0);
}

const { loadConfig, saveConfig } = require('../src/config');
const { registerProtocol } = require('../src/protocol-register');
const { startAgent } = require('../src/agent');

async function main() {
  if (args.register) {
    await registerProtocol();
    console.log('mesh:// protocol handler registered.');
    process.exit(0);
  }

  let token = args.token;
  let server = args.server;

  if (args.launch) {
    const urlArg = process.argv.slice(2).find((a) => a.startsWith('mesh://'));
    if (urlArg) {
      try {
        const u = new URL(urlArg);
        token = token || u.searchParams.get('token');
        server = server || decodeURIComponent(u.searchParams.get('server') || '');
      } catch {
        console.error('Invalid mesh:// URL');
        process.exit(1);
      }
    }
  }

  const cfg = loadConfig();
  token = token || cfg.token;
  server = server || cfg.token_server || 'https://mesh.ai';

  if (!token) {
    console.error('Error: --token is required. Get your token from Mesh > Settings > Terminal.');
    process.exit(1);
  }

  saveConfig({ token, token_server: server });

  if (!cfg.protocol_registered) {
    try {
      await registerProtocol();
      saveConfig({ ...loadConfig(), protocol_registered: true });
    } catch {
      // Non-fatal
    }
  }

  console.log(`Connecting to ${server}...`);
  await startAgent({ token, server });
}

main().catch((err) => {
  console.error('mesh-local error:', err.message);
  process.exit(1);
});
