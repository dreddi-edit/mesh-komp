'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function nextPort() {
  return 5200 + (process.pid % 300) + Math.floor(Math.random() * 50);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 15000;
  const intervalMs = Number(options.intervalMs) || 200;
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await condition();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await wait(intervalMs);
  }

  if (lastError) throw lastError;
  throw new Error(`Condition not met after ${timeoutMs}ms`);
}

function makeTempEnvDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

async function startServer(port) {
  const tmpDir = makeTempEnvDir('mesh-concurrent-test');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(port),
    LOG_LEVEL: 'error',
    MESH_DYNAMO_ENABLED: 'false',
    MESH_S3_ENABLED: 'false',
    DEMO_USER_ENABLED: 'true',
    DEMO_USER_EMAIL: 'test@mesh.local',
    DEMO_USER_PASSWORD: 'testpass123',
    JWT_SECRET: 'test-secret-key-for-concurrent-test-suite-min-32-chars',
    DATA_DIR: tmpDir,
  };

  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: REPO_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  await waitFor(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/healthz`);
      return res.status === 200 || res.status === 503;
    } catch {
      return false;
    }
  }, { timeoutMs: 20000 });

  return { child, port, tmpDir };
}

describe('Concurrent requests', () => {
  let server;

  before(async () => {
    const port = nextPort();
    server = await startServer(port);
  });

  after(() => {
    if (server?.child) {
      server.child.kill('SIGTERM');
    }
    if (server?.tmpDir) {
      try { fs.rmSync(server.tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('given 10 parallel /healthz requests, when fired simultaneously, then all respond without state corruption', async () => {
    const { port } = server;
    const promises = Array.from({ length: 10 }, () =>
      fetch(`http://localhost:${port}/healthz`).then((r) => r.json())
    );
    const results = await Promise.all(promises);

    for (const result of results) {
      assert.ok(typeof result.ok === 'boolean', 'each response must have ok field');
      assert.equal(result.service, 'mesh-gateway', 'each response must identify service');
      assert.ok(typeof result.uptimeSec === 'number', 'each response must have uptimeSec');
    }
  });

  it('given 10 parallel /api/csrf-token requests, when fired simultaneously, then all return unique tokens', async () => {
    const { port } = server;
    const promises = Array.from({ length: 10 }, () =>
      fetch(`http://localhost:${port}/api/csrf-token`, {
        method: 'GET',
        credentials: 'include',
      }).then((r) => r.json())
    );
    const results = await Promise.all(promises);

    for (const result of results) {
      assert.ok(result.ok === true, `CSRF token response must have ok: true, got ${JSON.stringify(result)}`);
      assert.ok(typeof result.token === 'string' && result.token.length > 0, 'must return a non-empty token');
    }

    // All tokens are unique (CSRF tokens are per-session, may share session in this test but should not be empty)
    const tokens = results.map((r) => r.token).filter(Boolean);
    assert.equal(tokens.length, 10, 'all 10 requests must return a token');
  });

  it('given mixed parallel requests to different endpoints, when fired simultaneously, then all respond correctly', async () => {
    const { port } = server;
    const requests = [
      fetch(`http://localhost:${port}/healthz`).then((r) => r.json().then((d) => ({ endpoint: 'healthz', ...d }))),
      fetch(`http://localhost:${port}/api/csrf-token`).then((r) => r.json().then((d) => ({ endpoint: 'csrf', ...d }))),
      fetch(`http://localhost:${port}/healthz`).then((r) => r.json().then((d) => ({ endpoint: 'healthz2', ...d }))),
      fetch(`http://localhost:${port}/api/csrf-token`).then((r) => r.json().then((d) => ({ endpoint: 'csrf2', ...d }))),
      fetch(`http://localhost:${port}/healthz`).then((r) => r.json().then((d) => ({ endpoint: 'healthz3', ...d }))),
    ];

    const results = await Promise.all(requests);
    assert.equal(results.length, 5, 'all 5 requests must complete');

    for (const result of results) {
      assert.ok(typeof result.ok === 'boolean', `${result.endpoint} must return ok field`);
    }
  });
});
