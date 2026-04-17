'use strict';

const os = require('os');
const WebSocket = require('ws');

const RECONNECT_DELAY_MS = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

/**
 * Starts the local terminal agent.
 * Connects to the Mesh server's /terminal-agent WebSocket endpoint,
 * spawns a local shell via node-pty, and proxies I/O between them.
 *
 * @param {{ token: string, server: string }} opts
 * @returns {Promise<void>} Resolves when agent exits
 */
async function startAgent({ token, server }) {
  let nodePty;
  try {
    nodePty = require('node-pty');
  } catch {
    console.error('Error: node-pty is not installed. Run: npm install -g node-pty');
    process.exit(1);
  }

  const wsUrl = buildAgentUrl(server, token);
  let attempts = 0;

  return new Promise((resolve) => {
    function connect() {
      attempts++;
      const ws = new WebSocket(wsUrl);
      let proc = null;

      ws.on('open', () => {
        attempts = 0;
        console.log('Connected to Mesh server. Waiting for browser to open terminal...');
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);

          if (msg.type === 'spawn') {
            if (proc) {
              try { proc.kill(); } catch {}
            }
            const shell = process.env.SHELL || (os.platform() === 'win32' ? 'cmd.exe' : '/bin/bash');
            proc = nodePty.spawn(shell, [], {
              name: 'xterm-color',
              cols: msg.cols || 120,
              rows: msg.rows || 36,
              cwd: os.homedir(),
              env: process.env,
            });

            proc.onData((data) => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'output', data }));
              }
            });

            proc.onExit(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'exit' }));
              }
            });

            ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[36m● Local shell on ${os.hostname()}\x1b[0m\r\n` }));
          }

          if (msg.type === 'input' && proc) {
            proc.write(msg.data);
          }

          if (msg.type === 'resize' && proc) {
            try { proc.resize(msg.cols, msg.rows); } catch {}
          }

          if (msg.type === 'browser-disconnected') {
            if (proc) {
              try { proc.kill(); } catch {}
              proc = null;
            }
          }
        } catch {
          // Malformed message — ignore
        }
      });

      ws.on('close', () => {
        if (proc) {
          try { proc.kill(); } catch {}
          proc = null;
        }
        if (attempts < MAX_RECONNECT_ATTEMPTS) {
          console.log(`Disconnected. Reconnecting in ${RECONNECT_DELAY_MS / 1000}s...`);
          setTimeout(connect, RECONNECT_DELAY_MS);
        } else {
          console.error('Max reconnect attempts reached. Exiting.');
          resolve();
        }
      });

      ws.on('error', (err) => {
        console.error('Connection error:', err.message);
      });
    }

    connect();
  });
}

/**
 * Builds the WebSocket URL for the agent endpoint.
 * @param {string} server - e.g. "https://mesh.ai"
 * @param {string} token
 * @returns {string}
 */
function buildAgentUrl(server, token) {
  const base = server.replace(/^http/, 'ws').replace(/\/$/, '');
  return `${base}/terminal-agent?token=${encodeURIComponent(token)}`;
}

module.exports = { startAgent };
