"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEMO_EMAIL = "edgar@test.com";
const DEMO_PASSWORD = "12345";

// ── Helpers (adapted from assistant-integration.test.js) ────────────────────

let portCounter = 0;

function nextPort() {
  portCounter += 1;
  return 5800 + (process.pid % 400) + portCounter * 13;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(condition, options = {}) {
  const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
  const intervalMs = Math.max(50, Number(options.intervalMs) || 200);
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
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function makeTempDbFile(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
  return path.join(dir, "test-auth.json");
}

async function startServer(envOverrides = {}) {
  const port = nextPort();
  const dbFile = makeTempDbFile("sec-test");
  const env = {
    PORT: String(port),
    MESH_SECURE_DB_FILE: dbFile,
    MESH_AUTH_COOKIE_NAME: `mesh_auth_${port}`,
    MESH_AUTH_COOKIE_SECURE: "false",
    ...envOverrides,
  };

  const child = spawn(process.execPath, ["server.js"], {
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  const capture = (chunk) => {
    output += String(chunk || "");
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  try {
    await waitFor(() => /"msg":"Server started"/.test(output), { timeoutMs: 25000, intervalMs: 120 });
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`Failed to start server: ${error.message}\n${output}`);
  }

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    cookieName: env.MESH_AUTH_COOKIE_NAME,
    child,
    getOutput() {
      return output;
    },
  };
}

async function stopServer(handle) {
  if (!handle?.child || handle.child.killed) return;
  handle.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => handle.child.once("exit", resolve)),
    wait(5000).then(() => {
      if (!handle.child.killed) handle.child.kill("SIGKILL");
    }),
  ]);
}

/**
 * Extended requestJson that also returns raw response headers.
 */
async function requestJson(baseUrl, pathname, jar, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (jar.cookie) headers.cookie = jar.cookie;

  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body,
    redirect: "manual",
  });

  const setCookie = response.headers.get("set-cookie");
  if (setCookie) {
    jar.cookie = setCookie.split(";")[0];
  }

  const text = await response.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }

  return {
    status: response.status,
    ok: response.ok,
    json,
    headers: Object.fromEntries(response.headers.entries()),
    rawSetCookie: setCookie || "",
  };
}

async function login(baseUrl, jar, cookieName) {
  const response = await requestJson(baseUrl, "/api/auth/login", jar, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD }),
  });
  assert.equal(response.status, 200, `Login failed: ${JSON.stringify(response.json)}`);
  assert.equal(response.json.ok, true);
  return response;
}

// ── Unit test: SameSite cookie default ──────────────────────────────────────

test("given default config, AUTH_COOKIE_SAME_SITE is Strict", () => {
  const { AUTH_COOKIE_SAME_SITE } = require("../src/core/auth");
  assert.equal(AUTH_COOKIE_SAME_SITE, "Strict");
});

// ── Integration tests ───────────────────────────────────────────────────────

test("security integration tests", { timeout: 90000 }, async (t) => {
  let server;
  const jar = {};

  try {
    server = await startServer();

    await t.test("given a response, security headers are present", async () => {
      const res = await requestJson(server.baseUrl, "/healthz", {});
      assert.equal(res.headers["x-content-type-options"], "nosniff");
      assert.equal(res.headers["x-frame-options"], "DENY");
      assert.equal(res.headers["referrer-policy"], "strict-origin-when-cross-origin");
      assert.ok(
        res.headers["content-security-policy"]?.includes("object-src 'none'"),
        "CSP should contain object-src 'none'"
      );
      assert.ok(
        res.headers["content-security-policy"]?.includes("frame-ancestors 'none'"),
        "CSP should contain frame-ancestors 'none'"
      );
    });

    // Login requires DynamoDB. When unavailable, the login returns 503/401.
    // We attempt login and conditionally run cookie/auth-dependent tests.
    let loginAvailable = false;
    try {
      const loginRes = await login(server.baseUrl, jar, server.cookieName);
      loginAvailable = true;

      await t.test("given a login, Set-Cookie contains SameSite=Strict", async () => {
        assert.ok(
          /SameSite=Strict/i.test(loginRes.rawSetCookie),
          `Expected SameSite=Strict in cookie, got: ${loginRes.rawSetCookie}`
        );
      });
    } catch {
      loginAvailable = false;
    }

    await t.test("given a cross-origin POST, CSRF guard returns 403", async () => {
      const res = await requestJson(server.baseUrl, "/api/auth/login", {}, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example.com",
        },
        body: JSON.stringify({ email: "test@test.com", password: "test" }),
      });
      assert.equal(res.status, 403, "Cross-origin mutating request should be rejected");
      assert.ok(res.json.error?.includes("CSRF"), "Error should mention CSRF");
    });

    if (loginAvailable) {
      await t.test("given a same-origin PUT with auth, CSRF guard allows it", async () => {
        const res = await requestJson(server.baseUrl, "/api/user/store/meshAppearance", jar, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Origin: server.baseUrl,
          },
          body: JSON.stringify({ value: { theme: "dark" } }),
        });
        assert.notEqual(res.status, 403, "Same-origin mutating request should not be CSRF-blocked");
      });
    }

    await t.test("given no auth, POST /api/chat returns 401", async () => {
      const res = await requestJson(server.baseUrl, "/api/chat", {}, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: server.baseUrl },
        body: JSON.stringify({ messages: [{ role: "user", content: "hello" }] }),
      });
      assert.equal(res.status, 401);
    });

    await t.test("given 16 rapid login attempts, rate limiter returns 429", async () => {
      const results = [];
      for (let i = 0; i < 16; i++) {
        const res = await requestJson(server.baseUrl, "/api/auth/login", {}, {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: server.baseUrl },
          body: JSON.stringify({ email: "brute@force.test", password: "wrong" }),
        });
        results.push(res.status);
      }

      const rateLimited = results.filter((s) => s === 429);
      assert.ok(rateLimited.length >= 1, `Expected at least one 429, got statuses: ${results.join(",")}`);

      const lastStatus = results[results.length - 1];
      assert.equal(lastStatus, 429, `16th attempt should be rate-limited, got ${lastStatus}`);
    });
  } finally {
    await stopServer(server);
  }
});
