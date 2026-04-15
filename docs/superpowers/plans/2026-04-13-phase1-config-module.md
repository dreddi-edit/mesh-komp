# Phase 1: Config Module — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize all `process.env` access into a single config module with schema validation, eliminating 65+ scattered `process.env` references and 3 copies of duplicated utility functions (`parseBooleanFlag`, `parseIntegerInRange`, etc.).

**Architecture:** New `src/config/` directory with two files: `env-utils.js` for shared parsing utilities (eliminating duplication) and `index.js` for the config schema + validated export. All modules import config values from `src/config/index.js` instead of reading `process.env` directly. `startup-checks.js` is absorbed into the config module.

**Tech Stack:** Node.js, built-in `node:test` runner

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `src/config/env-utils.js` | Shared env-parsing utilities (parseBooleanFlag, parseIntegerInRange, etc.) |
| Create | `src/config/index.js` | Schema definition, validation, fail-fast, single config export |
| Create | `test/config.test.js` | Config module tests |
| Modify | `src/core/index.js` | Import config instead of reading process.env directly |
| Modify | `src/core/auth.js` | Import config + env-utils instead of inlining parsers |
| Modify | `src/core/model-providers.js` | Import config for MESH_DEFAULT_MODEL and API keys |
| Modify | `src/core/workspace-infrastructure.js` | Import config + env-utils instead of inlining parsers |
| Modify | `src/routes/terminal.routes.js` | Import config for TERMINAL_UPLOAD_ROOT |
| Modify | `src/routes/realtime.routes.js` | Import config for voice VAD settings |
| Modify | `src/routes/app.routes.js` | Import config for API keys |
| Modify | `src/routes/assistant.routes.js` | Import config for API keys |
| Modify | `src/server.js` | Import config (replaces startup-checks) |
| Modify | `src/logger.js` | Import config for LOG_LEVEL |
| Delete | `src/core/startup-checks.js` | Absorbed into config module |
| Modify | `test/startup-checks.test.js` | Repoint to test config module validation |

---

### Task 1: Create env-utils.js (shared parsing utilities)

**Files:**
- Create: `src/config/env-utils.js`
- Test: `test/config.test.js`

- [ ] **Step 1: Write failing tests for env-utils**

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("parseBooleanFlag returns fallback for empty input", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  assert.equal(parseBooleanFlag(undefined, false), false);
  assert.equal(parseBooleanFlag(null, true), true);
  assert.equal(parseBooleanFlag("", false), false);
});

test("parseBooleanFlag parses truthy strings", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  for (const value of ["1", "true", "yes", "on", "enabled"]) {
    assert.equal(parseBooleanFlag(value, false), true, `expected true for "${value}"`);
  }
});

test("parseBooleanFlag parses falsy strings", () => {
  const { parseBooleanFlag } = require("../src/config/env-utils");
  for (const value of ["0", "false", "no", "off", "disabled"]) {
    assert.equal(parseBooleanFlag(value, true), false, `expected false for "${value}"`);
  }
});

test("parseIntegerInRange clamps to range", () => {
  const { parseIntegerInRange } = require("../src/config/env-utils");
  assert.equal(parseIntegerInRange("50", 10, 1, 100), 50);
  assert.equal(parseIntegerInRange("200", 10, 1, 100), 100);
  assert.equal(parseIntegerInRange("-5", 10, 1, 100), 1);
  assert.equal(parseIntegerInRange(undefined, 10, 1, 100), 10);
  assert.equal(parseIntegerInRange("abc", 10, 1, 100), 10);
});

test("clampBrotliQuality clamps 0-11", () => {
  const { clampBrotliQuality } = require("../src/config/env-utils");
  assert.equal(clampBrotliQuality("7", 5), 7);
  assert.equal(clampBrotliQuality("15", 5), 11);
  assert.equal(clampBrotliQuality("-3", 5), 0);
  assert.equal(clampBrotliQuality(undefined, 5), 5);
});

test("trimTrailingSlashes removes trailing slashes", () => {
  const { trimTrailingSlashes } = require("../src/config/env-utils");
  assert.equal(trimTrailingSlashes("https://example.com///"), "https://example.com");
  assert.equal(trimTrailingSlashes(""), "");
});

test("normalizeSasToken strips leading question marks", () => {
  const { normalizeSasToken } = require("../src/config/env-utils");
  assert.equal(normalizeSasToken("??sv=2021"), "sv=2021");
  assert.equal(normalizeSasToken("sv=2021"), "sv=2021");
  assert.equal(normalizeSasToken(""), "");
});

test("sanitizeBlobContainerName lowercases and strips invalid chars", () => {
  const { sanitizeBlobContainerName } = require("../src/config/env-utils");
  assert.equal(sanitizeBlobContainerName("My_Container!"), "mycontainer");
  assert.equal(sanitizeBlobContainerName("valid-name-123"), "valid-name-123");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config/env-utils'`

- [ ] **Step 3: Implement env-utils.js**

```js
'use strict';

/**
 * Shared environment-variable parsing utilities.
 * Single source of truth — no other module should inline these functions.
 *
 * @module config/env-utils
 */

/**
 * Parse a raw env string as a boolean, returning a fallback for empty/ambiguous values.
 *
 * @param {string | undefined | null} rawValue - The raw environment variable value.
 * @param {boolean} [fallback=false] - Returned when the value is empty or unrecognized.
 * @returns {boolean}
 */
function parseBooleanFlag(rawValue, fallback = false) {
  if (rawValue === undefined || rawValue === null || rawValue === '') return fallback;
  const normalized = String(rawValue).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

/**
 * Parse a raw env string as an integer, clamped to [min, max].
 *
 * @param {string | undefined} rawValue - The raw environment variable value.
 * @param {number} fallback - Used when the value is missing or non-numeric.
 * @param {number} min - Lower bound (inclusive).
 * @param {number} max - Upper bound (inclusive).
 * @returns {number}
 */
function parseIntegerInRange(rawValue, fallback, min, max) {
  const numeric = Number(rawValue);
  const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(max, Math.max(min, selected));
}

/**
 * Clamp a Brotli quality setting to the valid 0–11 range.
 *
 * @param {string | undefined} rawValue - The raw environment variable value.
 * @param {number} fallback - Used when the value is missing or non-numeric.
 * @returns {number}
 */
function clampBrotliQuality(rawValue, fallback) {
  const numeric = Number(rawValue);
  const selected = Number.isFinite(numeric) ? Math.trunc(numeric) : fallback;
  return Math.min(11, Math.max(0, selected));
}

/**
 * Trim trailing slashes from a URL or path string.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
function trimTrailingSlashes(value) {
  return String(value || '').trim().replace(/\/+$/g, '');
}

/**
 * Normalize a SAS token by stripping leading '?' characters.
 *
 * @param {string | undefined} rawToken
 * @returns {string}
 */
function normalizeSasToken(rawToken) {
  return String(rawToken || '').trim().replace(/^\?+/, '');
}

/**
 * Sanitize a blob container name to lowercase alphanumeric + hyphens only.
 *
 * @param {string | undefined} rawValue
 * @returns {string}
 */
function sanitizeBlobContainerName(rawValue) {
  return String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

module.exports = {
  parseBooleanFlag,
  parseIntegerInRange,
  clampBrotliQuality,
  trimTrailingSlashes,
  normalizeSasToken,
  sanitizeBlobContainerName,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/env-utils.js test/config.test.js
git commit -m "feat(config): add shared env-parsing utilities with tests"
```

---

### Task 2: Create config/index.js (centralized config with validation)

**Files:**
- Create: `src/config/index.js`
- Modify: `test/config.test.js`

- [ ] **Step 1: Append failing tests for config module**

Append to `test/config.test.js`:

```js
test("config module exports all expected keys", () => {
  const config = require("../src/config");
  assert.equal(typeof config.NODE_ENV, "string");
  assert.equal(typeof config.IS_PRODUCTION, "boolean");
  assert.equal(typeof config.PORT, "number");
  assert.equal(typeof config.MESH_CORE_URL, "string");
  assert.equal(typeof config.ANTHROPIC_API_KEY, "string");
  assert.equal(typeof config.MESH_DEFAULT_MODEL, "string");
  assert.equal(typeof config.WORKSPACE_BROTLI_QUALITY, "number");
  assert.equal(typeof config.MESH_WORKSPACE_PERF_LOG, "boolean");
});

test("config validation fails in production without encryption key", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "",
    AUTH_SECRET: "",
    MESH_COSMOS_ENDPOINT: "https://example.com",
    MESH_COSMOS_KEY: "key",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_DATA_ENCRYPTION_KEY")));
});

test("config validation passes in production with all required vars", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
    MESH_COSMOS_ENDPOINT: "https://example.com",
    MESH_COSMOS_KEY: "key",
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("config validation warns when ANTHROPIC_API_KEY is missing", () => {
  const { validateConfig } = require("../src/config");
  const result = validateConfig({
    NODE_ENV: "development",
    ANTHROPIC_API_KEY: "",
  });
  assert.ok(result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `node --test test/config.test.js`
Expected: FAIL — `Cannot find module '../src/config'`

- [ ] **Step 3: Implement config/index.js**

```js
'use strict';

/**
 * MESH — Centralized configuration module.
 *
 * Single source of truth for all environment variables. Validates on import.
 * In production, missing critical vars cause an immediate process exit.
 *
 * Usage: `const config = require('./config');`
 * Then:  `config.ANTHROPIC_API_KEY` instead of `process.env.ANTHROPIC_API_KEY`
 *
 * @module config
 */

const {
  parseBooleanFlag,
  parseIntegerInRange,
  clampBrotliQuality,
  trimTrailingSlashes,
  normalizeSasToken,
  sanitizeBlobContainerName,
} = require('./env-utils');

/**
 * Validate a config source (defaults to process.env) and return structured errors/warnings.
 * Exported for testing — the module itself calls this internally on load.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function validateConfig(env = process.env) {
  const errors = [];
  const warnings = [];

  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const isProduction = nodeEnv === 'production';

  if (!nodeEnv) {
    warnings.push('NODE_ENV is not set. Defaulting to development behaviour.');
  }

  const encryptionKey = String(env.MESH_DATA_ENCRYPTION_KEY || env.AUTH_SECRET || '').trim();
  if (isProduction && !encryptionKey) {
    errors.push('MESH_DATA_ENCRYPTION_KEY must be set in production. All encrypted user data depends on this value.');
  }

  const cosmosEndpoint = String(env.MESH_COSMOS_ENDPOINT || '').trim();
  const cosmosKey = String(env.MESH_COSMOS_KEY || '').trim();
  if (isProduction && (!cosmosEndpoint || !cosmosKey)) {
    errors.push('MESH_COSMOS_ENDPOINT and MESH_COSMOS_KEY must both be set in production. Auth and user storage require Cosmos DB.');
  }

  const anthropicKey = String(env.ANTHROPIC_API_KEY || '').trim();
  if (!anthropicKey) {
    warnings.push('ANTHROPIC_API_KEY is not set. Chat and assistant features will be unavailable.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Build the full config object from an env source.
 *
 * @param {Record<string, string | undefined>} [env=process.env]
 * @returns {object}
 */
function buildConfig(env = process.env) {
  const NODE_ENV = String(env.NODE_ENV || 'development').trim().toLowerCase();
  const IS_PRODUCTION = NODE_ENV === 'production';
  const PORT = Number(env.PORT || 8080);

  const RAW_INDEX_PARALLELISM = env.MESH_WORKSPACE_INDEX_PARALLELISM;
  const MESH_WORKSPACE_INDEX_PARALLELISM = parseIntegerInRange(env.MESH_WORKSPACE_INDEX_PARALLELISM, 8, 1, 24);

  return {
    // ── Core ──
    NODE_ENV,
    IS_PRODUCTION,
    PORT,
    LOG_LEVEL: String(env.LOG_LEVEL || 'info').toLowerCase(),

    // ── Encryption & Storage ──
    MESH_DATA_ENCRYPTION_KEY: String(env.MESH_DATA_ENCRYPTION_KEY || env.AUTH_SECRET || '').trim(),
    MESH_SECURE_DB_FILE: String(env.MESH_SECURE_DB_FILE || '').trim(),
    MESH_COSMOS_ENDPOINT: String(env.MESH_COSMOS_ENDPOINT || '').trim(),
    MESH_COSMOS_KEY: String(env.MESH_COSMOS_KEY || '').trim(),
    MESH_COSMOS_DATABASE: String(env.MESH_COSMOS_DATABASE || 'mesh-db').trim(),

    // ── AI Providers ──
    ANTHROPIC_API_KEY: String(env.ANTHROPIC_API_KEY || '').trim(),
    OPENAI_API_KEY: String(env.OPENAI_API_KEY || '').trim(),
    GOOGLE_API_KEY: String(env.GOOGLE_API_KEY || '').trim(),
    AWS_BEARER_TOKEN_BEDROCK: String(env.AWS_BEARER_TOKEN_BEDROCK || '').trim(),
    AZURE_OPENAI_ENDPOINT: String(env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/+$/, ''),
    AZURE_OPENAI_KEY: String(env.AZURE_OPENAI_KEY || '').trim(),
    MESH_DEFAULT_MODEL: String(env.MESH_DEFAULT_MODEL || 'gpt-5.4-mini').trim(),

    // ── Voice ──
    AZURE_OPENAI_VOICE_ENDPOINT: String(env.AZURE_OPENAI_VOICE_ENDPOINT || '').trim(),
    AZURE_OPENAI_VOICE_KEY: String(env.AZURE_OPENAI_VOICE_KEY || '').trim(),
    SPEECH_RMS_THRESHOLD: Number(env.MESH_VOICE_VAD_THRESHOLD || 0.012),
    SPEECH_PREFIX_MS: Number(env.MESH_VOICE_VAD_PREFIX_MS || 240),
    SPEECH_SILENCE_MS: Number(env.MESH_VOICE_VAD_SILENCE_MS || 720),
    MIN_UTTERANCE_MS: Number(env.MESH_VOICE_MIN_UTTERANCE_MS || 280),
    MAX_UTTERANCE_MS: Number(env.MESH_VOICE_MAX_UTTERANCE_MS || 14000),
    AUDIO_DELTA_BYTES: Number(env.MESH_VOICE_AUDIO_DELTA_BYTES || 4096),

    // ── Auth & Cookies ──
    MESH_AUTH_SESSION_TOUCH_INTERVAL_MS: parseIntegerInRange(
      env.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS,
      2 * 60 * 1000,
      0,
      1000 * 60 * 60 * 24 * 14,
    ),
    AUTH_COOKIE_NAME: String(env.MESH_AUTH_COOKIE_NAME || 'mesh_auth').trim() || 'mesh_auth',
    AUTH_COOKIE_PATH: String(env.MESH_AUTH_COOKIE_PATH || '/').trim() || '/',
    AUTH_COOKIE_SAME_SITE: String(env.MESH_AUTH_COOKIE_SAMESITE || 'Strict').trim() || 'Strict',
    AUTH_COOKIE_SECURE: parseBooleanFlag(env.MESH_AUTH_COOKIE_SECURE, IS_PRODUCTION),

    // ── Demo User ──
    DEMO_USER_ENABLED: parseBooleanFlag(env.MESH_DEMO_USER_ENABLED, !IS_PRODUCTION),
    DEMO_USER_EMAIL: String(env.MESH_DEMO_USER_EMAIL || 'edgar@test.com').trim().toLowerCase(),
    DEMO_USER_EMAIL_ALIASES: String(env.MESH_DEMO_USER_EMAIL_ALIASES || '')
      .split(',')
      .map((entry) => String(entry || '').trim().toLowerCase())
      .filter(Boolean),
    DEMO_USER_PASSWORD: String(env.MESH_DEMO_USER_PASSWORD || '12345').trim(),

    // ── Server & Tunnel ──
    MESH_CORE_URL: String(env.MESH_CORE_URL || 'http://localhost:8080/mesh/tunnel').trim(),
    MESH_TERMINAL_UPLOAD_ROOT: String(env.MESH_TERMINAL_UPLOAD_ROOT || '').trim(),

    // ── Workspace Compression ──
    WORKSPACE_BROTLI_QUALITY: clampBrotliQuality(env.MESH_WORKSPACE_BROTLI_QUALITY, 5),
    WORKSPACE_INITIAL_BROTLI_QUALITY: clampBrotliQuality(env.MESH_WORKSPACE_INITIAL_BROTLI_QUALITY, 3),
    MESH_TUNNEL_BROTLI_QUALITY: clampBrotliQuality(env.MESH_TUNNEL_BROTLI_QUALITY, 4),

    // ── Workspace Concurrency ──
    MESH_WORKSPACE_INDEX_PARALLELISM,
    MESH_WORKSPACE_READ_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_READ_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? MESH_WORKSPACE_INDEX_PARALLELISM : 16,
      1,
      64,
    ),
    MESH_WORKSPACE_BUILD_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_BUILD_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? MESH_WORKSPACE_INDEX_PARALLELISM : 6,
      1,
      32,
    ),
    MESH_WORKSPACE_ENRICH_CONCURRENCY: parseIntegerInRange(
      env.MESH_WORKSPACE_ENRICH_CONCURRENCY,
      RAW_INDEX_PARALLELISM !== undefined ? Math.min(MESH_WORKSPACE_INDEX_PARALLELISM, 16) : 4,
      1,
      24,
    ),
    MESH_WORKSPACE_PERF_LOG: parseBooleanFlag(env.MESH_WORKSPACE_PERF_LOG, false),

    // ── Workspace Select Queue ──
    WORKSPACE_SELECT_ASYNC_ENABLED: (() => {
      const asyncMode = String(env.MESH_WORKSPACE_SELECT_ASYNC_MODE || 'off').trim().toLowerCase();
      return parseBooleanFlag(
        env.MESH_WORKSPACE_SELECT_ASYNC_ENABLED,
        ['queue', 'async', 'background', 'on', 'enabled', 'true', '1'].includes(asyncMode),
      );
    })(),
    WORKSPACE_SELECT_JOB_TTL_MS: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_JOB_TTL_MS, 20 * 60 * 1000, 60 * 1000, 24 * 60 * 60 * 1000),
    WORKSPACE_SELECT_MAX_JOB_HISTORY: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_MAX_JOB_HISTORY, 500, 50, 5000),
    WORKSPACE_SELECT_MAX_PENDING: parseIntegerInRange(env.MESH_WORKSPACE_SELECT_MAX_PENDING, 12, 1, 200),

    // ── Azure Blob Offload ──
    MESH_AZURE_OFFLOAD_ENABLED: parseBooleanFlag(env.MESH_AZURE_OFFLOAD_ENABLED, false),
    MESH_AZURE_BLOB_BASE_URL: trimTrailingSlashes(env.MESH_AZURE_BLOB_BASE_URL || ''),
    MESH_AZURE_BLOB_CONTAINER: sanitizeBlobContainerName(env.MESH_AZURE_BLOB_CONTAINER || ''),
    MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN: normalizeSasToken(env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN || env.MESH_AZURE_BLOB_SAS_TOKEN || ''),
    MESH_AZURE_BLOB_INGEST_SAS_TOKEN: normalizeSasToken(
      env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN
      || env.MESH_AZURE_BLOB_SAS_TOKEN
      || env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN
      || '',
    ),
    MESH_AZURE_BLOB_READ_SAS_TOKEN: normalizeSasToken(
      env.MESH_AZURE_BLOB_READ_SAS_TOKEN
      || env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN
      || env.MESH_AZURE_BLOB_SAS_TOKEN
      || env.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN
      || '',
    ),
    MESH_AZURE_BLOB_DELETE_SAS_TOKEN: normalizeSasToken(env.MESH_AZURE_BLOB_DELETE_SAS_TOKEN || ''),
    MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES, 900, 100, 5000),
    MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES, 60_000_000, 5_000_000, 250_000_000),
    MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS, 64, 8, 192),
    MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS: parseIntegerInRange(env.MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS, 4, 1, 12),

    // ── Rate Limiting (Phase 2 will use these) ──
    RATE_LIMIT_API_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_API_MAX, 100, 10, 10000),
    RATE_LIMIT_API_WINDOW_MS: parseIntegerInRange(env.MESH_RATE_LIMIT_API_WINDOW_MS, 60_000, 1000, 600_000),
    RATE_LIMIT_UPLOAD_MAX: parseIntegerInRange(env.MESH_RATE_LIMIT_UPLOAD_MAX, 20, 5, 1000),
  };
}

const config = buildConfig();
const validation = validateConfig();

module.exports = config;
module.exports.validateConfig = validateConfig;
module.exports.buildConfig = buildConfig;
module.exports.validation = validation;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/config.test.js`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/index.js test/config.test.js
git commit -m "feat(config): add centralized config module with schema validation"
```

---

### Task 3: Update server.js to use config module (replace startup-checks)

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Read current server.js to confirm import lines**

File: `src/server.js:1-16` — currently imports `startup-checks` and calls `runStartupChecks()`.

- [ ] **Step 2: Replace startup-checks import with config module**

In `src/server.js`, replace lines 8-15:

```js
// Old:
// const { runStartupChecks } = require('./core/startup-checks');
// const startupResult = runStartupChecks();
// startupResult.warnings.forEach((w) => logger.warn(w, { phase: 'startup' }));
// if (!startupResult.ok) {
//   startupResult.errors.forEach((e) => logger.error(e, { phase: 'startup', fatal: true }));
//   process.exit(1);
// }

// New:
const config = require('./config');
const { validation } = require('./config');
validation.warnings.forEach((w) => logger.warn(w, { phase: 'startup' }));
if (!validation.ok) {
  validation.errors.forEach((e) => logger.error(e, { phase: 'startup', fatal: true }));
  process.exit(1);
}
```

Also update `const PORT` at line 174:

```js
// Old: const PORT = Number(process.env.PORT || 8080);
// New:
const PORT = config.PORT;
```

- [ ] **Step 3: Verify server still boots**

Run: `node src/server.js &` then `curl -s http://localhost:8080/ | head -1` then kill the background process.
Expected: Server starts on port 8080, returns HTML.

- [ ] **Step 4: Run existing tests to verify nothing broke**

Run: `node --test test/startup-checks.test.js`
Expected: PASS (startup-checks still exists until Task 7)

- [ ] **Step 5: Commit**

```bash
git add src/server.js
git commit -m "refactor(server): use centralized config module instead of startup-checks"
```

---

### Task 4: Update logger.js to use config

**Files:**
- Modify: `src/logger.js`

- [ ] **Step 1: Read current logger.js**

File: `src/logger.js:16` — reads `process.env.LOG_LEVEL` directly.

- [ ] **Step 2: Replace process.env access**

In `src/logger.js`, replace the `MIN_LEVEL` line:

```js
// Old: const MIN_LEVEL = LEVEL_VALUES[String(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVEL_VALUES.info;
// New:
const config = require('./config');
const MIN_LEVEL = LEVEL_VALUES[config.LOG_LEVEL] ?? LEVEL_VALUES.info;
```

- [ ] **Step 3: Run logger tests**

Run: `node --test test/logger.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/logger.js
git commit -m "refactor(logger): use centralized config for LOG_LEVEL"
```

---

### Task 5: Update auth.js to use config + env-utils

**Files:**
- Modify: `src/core/auth.js`

- [ ] **Step 1: Replace inlined utility functions and process.env reads**

In `src/core/auth.js`:

1. Remove the inlined `parseBooleanFlag` and `parseIntegerInRange` functions (lines 16-28).
2. Add config import at the top (after existing requires):

```js
const config = require('../config');
```

3. Replace all `process.env`-derived constants (lines 34-52) with config references:

```js
// Old constants block (lines 34-52) replaced with:
const AUTH_SESSION_TOUCH_INTERVAL_MS = config.MESH_AUTH_SESSION_TOUCH_INTERVAL_MS;
const AUTH_COOKIE_NAME      = config.AUTH_COOKIE_NAME;
const AUTH_COOKIE_PATH      = config.AUTH_COOKIE_PATH;
const AUTH_COOKIE_SAME_SITE = config.AUTH_COOKIE_SAME_SITE;
const AUTH_COOKIE_SECURE    = config.AUTH_COOKIE_SECURE;

const DEMO_USER_ENABLED      = config.DEMO_USER_ENABLED;
const DEMO_USER_EMAIL        = config.DEMO_USER_EMAIL;
const DEMO_USER_EMAIL_ALIASES = config.DEMO_USER_EMAIL_ALIASES;
const DEMO_USER_PASSWORD     = config.DEMO_USER_PASSWORD;
```

4. Remove the `IS_PRODUCTION` const (line 45) — use `config.IS_PRODUCTION` where needed, or just rely on the config-derived values above.

- [ ] **Step 2: Run existing tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/auth.js
git commit -m "refactor(auth): use centralized config, remove duplicated utility functions"
```

---

### Task 6: Update model-providers.js to use config

**Files:**
- Modify: `src/core/model-providers.js`

- [ ] **Step 1: Replace process.env reads**

In `src/core/model-providers.js`:

1. Add config import after the path require (line 10):

```js
const config = require('../config');
```

2. Replace line 36:

```js
// Old: const MESH_DEFAULT_MODEL = process.env.MESH_DEFAULT_MODEL || "gpt-5.4-mini";
// New:
const MESH_DEFAULT_MODEL = config.MESH_DEFAULT_MODEL;
```

3. In `runModelChat` function (~line 738), replace all `process.env` references:

```js
// Old: let apiKey = String(credentials?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
// New:
let apiKey = String(credentials?.anthropic?.apiKey || config.ANTHROPIC_API_KEY || "").trim();

// Old: const bedrockToken = String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim();
// New:
const bedrockToken = config.AWS_BEARER_TOKEN_BEDROCK;

// Old: const userApiKey = String(credentials?.openai?.apiKey || process.env.OPENAI_API_KEY || "").trim();
// New:
const userApiKey = String(credentials?.openai?.apiKey || config.OPENAI_API_KEY || "").trim();

// Old: const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "").trim().replace(/\/+$/, "");
// New:
const azureEndpoint = config.AZURE_OPENAI_ENDPOINT;

// Old: const azureKey = String(process.env.AZURE_OPENAI_KEY || "").trim();
// New:
const azureKey = config.AZURE_OPENAI_KEY;

// Old: const apiKey = String(credentials?.google?.apiKey || process.env.GOOGLE_API_KEY || "").trim();
// New:
const apiKey = String(credentials?.google?.apiKey || config.GOOGLE_API_KEY || "").trim();
```

- [ ] **Step 2: Run tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/model-providers.js
git commit -m "refactor(model-providers): use centralized config for all env vars"
```

---

### Task 7: Update index.js to use config + env-utils

**Files:**
- Modify: `src/core/index.js`

- [ ] **Step 1: Replace inlined utility functions and process.env reads**

In `src/core/index.js`:

1. Add imports after existing requires (around line 18):

```js
const config = require('../config');
const { parseBooleanFlag, parseIntegerInRange, clampBrotliQuality, trimTrailingSlashes, normalizeSasToken, sanitizeBlobContainerName } = require('../config/env-utils');
```

2. Replace all `process.env`-derived constants (lines 282-306) with config references:

```js
// Old lines 282-306 replaced with:
const MESH_CORE_URL = config.MESH_CORE_URL;
const WORKSPACE_BROTLI_QUALITY = config.WORKSPACE_BROTLI_QUALITY;
const WORKSPACE_INITIAL_BROTLI_QUALITY = config.WORKSPACE_INITIAL_BROTLI_QUALITY;
const MESH_TUNNEL_BROTLI_QUALITY = config.MESH_TUNNEL_BROTLI_QUALITY;
const MESH_WORKSPACE_INDEX_PARALLELISM = config.MESH_WORKSPACE_INDEX_PARALLELISM;
const MESH_WORKSPACE_READ_CONCURRENCY = config.MESH_WORKSPACE_READ_CONCURRENCY;
const MESH_WORKSPACE_BUILD_CONCURRENCY = config.MESH_WORKSPACE_BUILD_CONCURRENCY;
const MESH_WORKSPACE_ENRICH_CONCURRENCY = config.MESH_WORKSPACE_ENRICH_CONCURRENCY;
const MESH_WORKSPACE_PERF_LOG = config.MESH_WORKSPACE_PERF_LOG;
const WORKSPACE_SELECT_ASYNC_ENABLED = config.WORKSPACE_SELECT_ASYNC_ENABLED;
const WORKSPACE_SELECT_JOB_TTL_MS = config.WORKSPACE_SELECT_JOB_TTL_MS;
const WORKSPACE_SELECT_MAX_JOB_HISTORY = config.WORKSPACE_SELECT_MAX_JOB_HISTORY;
const WORKSPACE_SELECT_MAX_PENDING = config.WORKSPACE_SELECT_MAX_PENDING;
```

3. Remove the `RAW_MESH_WORKSPACE_INDEX_PARALLELISM` variable and the `WORKSPACE_SELECT_ASYNC_MODE` variable — their logic is now inside the config module.

4. Keep the inlined utility functions (`clampBrotliQuality`, `parseBooleanFlag`, `parseIntegerInRange`, `trimTrailingSlashes`, `normalizeSasToken`, `sanitizeBlobContainerName`) but change them to re-exports from env-utils. Replace the function bodies (lines 343-376) with:

```js
// These functions are still exported for backward compatibility with other modules
// that import from index.js. The canonical implementations are in config/env-utils.
```

Actually — since `index.js` re-exports everything, we just keep the imports from env-utils and re-export them. The existing function bodies can be deleted and replaced by the require at the top.

- [ ] **Step 2: Run all tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/index.js
git commit -m "refactor(core): use centralized config, remove duplicated env-var parsing"
```

---

### Task 8: Update workspace-infrastructure.js to use config

**Files:**
- Modify: `src/core/workspace-infrastructure.js`

- [ ] **Step 1: Replace inlined utility functions and process.env reads**

In `src/core/workspace-infrastructure.js`:

1. Add config import (after line 18):

```js
const config = require('../config');
const { parseBooleanFlag, parseIntegerInRange, trimTrailingSlashes, normalizeSasToken, sanitizeBlobContainerName } = require('../config/env-utils');
```

2. Remove the 5 inlined utility function definitions (lines 26-51): `parseBooleanFlag`, `parseIntegerInRange`, `trimTrailingSlashes`, `normalizeSasToken`, `sanitizeBlobContainerName`.

3. Replace all `process.env` reads in `createWorkspaceOffloadConfig` (lines 979-988) with config references:

```js
// Old:
// const requested = parseBooleanFlag(process.env.MESH_AZURE_OFFLOAD_ENABLED, false);
// const baseUrl = trimTrailingSlashes(process.env.MESH_AZURE_BLOB_BASE_URL || "");
// etc.

// New:
const requested = config.MESH_AZURE_OFFLOAD_ENABLED;
const baseUrl = config.MESH_AZURE_BLOB_BASE_URL;
const container = config.MESH_AZURE_BLOB_CONTAINER;
const uploadSasToken = config.MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN;
const ingestSasToken = config.MESH_AZURE_BLOB_INGEST_SAS_TOKEN;
const readSasToken = config.MESH_AZURE_BLOB_READ_SAS_TOKEN;
const maxChunkFiles = config.MESH_AZURE_OFFLOAD_MAX_CHUNK_FILES;
const maxChunkBytes = config.MESH_AZURE_OFFLOAD_MAX_CHUNK_BYTES;
const maxParallelReads = config.MESH_AZURE_OFFLOAD_MAX_PARALLEL_READS;
const maxInflightChunks = config.MESH_AZURE_OFFLOAD_MAX_INFLIGHT_CHUNKS;
```

4. Replace the `buildWorkspaceBlobReadUrl` function's process.env read (line 966) with config:

```js
// Old: const readToken = normalizeSasToken(process.env.MESH_AZURE_BLOB_READ_SAS_TOKEN || azureBlob.ingestSasToken || azureBlob.uploadSasToken || "");
// New:
const readToken = config.MESH_AZURE_BLOB_READ_SAS_TOKEN || normalizeSasToken(azureBlob.ingestSasToken || azureBlob.uploadSasToken || "");
```

5. Replace the `deleteWorkspaceBlob` function's process.env read (line 1230) with config:

```js
// Old: const deleteToken = normalizeSasToken(process.env.MESH_AZURE_BLOB_DELETE_SAS_TOKEN || workspaceOffloadConfig.azureBlob.uploadSasToken || "");
// New:
const deleteToken = config.MESH_AZURE_BLOB_DELETE_SAS_TOKEN || normalizeSasToken(workspaceOffloadConfig.azureBlob.uploadSasToken || "");
```

- [ ] **Step 2: Run all tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/workspace-infrastructure.js
git commit -m "refactor(workspace-infra): use centralized config, remove duplicated utilities"
```

---

### Task 9: Update route files to use config

**Files:**
- Modify: `src/routes/terminal.routes.js`
- Modify: `src/routes/realtime.routes.js`
- Modify: `src/routes/app.routes.js`
- Modify: `src/routes/assistant.routes.js`

- [ ] **Step 1: Update terminal.routes.js**

Add import and replace:

```js
const config = require('../config');

// Old: const TERMINAL_UPLOAD_ROOT = process.env.MESH_TERMINAL_UPLOAD_ROOT ...
// New:
const TERMINAL_UPLOAD_ROOT = config.MESH_TERMINAL_UPLOAD_ROOT || require('os').tmpdir();

// Old (line 250): let shell = shellPref || process.env.SHELL || 'bash';
// New:
let shell = shellPref || process.env.SHELL || 'bash';
// NOTE: process.env.SHELL is a system var, not app config — keep as-is
```

- [ ] **Step 2: Update realtime.routes.js**

Add import and replace all 7 voice-related env reads (lines 13-19):

```js
const config = require('../config');

const SPEECH_RMS_THRESHOLD = config.SPEECH_RMS_THRESHOLD;
const SPEECH_PREFIX_MS = config.SPEECH_PREFIX_MS;
const SPEECH_SILENCE_MS = config.SPEECH_SILENCE_MS;
const MIN_UTTERANCE_MS = config.MIN_UTTERANCE_MS;
const MAX_UTTERANCE_MS = config.MAX_UTTERANCE_MS;
const AUDIO_DELTA_BYTES = config.AUDIO_DELTA_BYTES;
const PERF_LOG = config.MESH_WORKSPACE_PERF_LOG;
```

- [ ] **Step 3: Update app.routes.js**

Add import and replace (lines 524, 550-551):

```js
const config = require('../config');

// Old: const apiKey = process.env.ANTHROPIC_API_KEY;
// New:
const apiKey = config.ANTHROPIC_API_KEY;

// Old: const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "")...
// New:
const azureEndpoint = config.AZURE_OPENAI_ENDPOINT;
const azureKey = config.AZURE_OPENAI_KEY;
```

- [ ] **Step 4: Update assistant.routes.js**

Add import and replace (lines 1297-1298, 1386-1388):

```js
const config = require('../config');

// Old: let apiKey = String(resolvedCredentials?.anthropic?.apiKey || process.env.ANTHROPIC_API_KEY || "").trim();
// New:
let apiKey = String(resolvedCredentials?.anthropic?.apiKey || config.ANTHROPIC_API_KEY || "").trim();

// Old: const bedrockToken = String(process.env.AWS_BEARER_TOKEN_BEDROCK || "").trim();
// New:
const bedrockToken = config.AWS_BEARER_TOKEN_BEDROCK;

// Old: const userApiKey = String(resolvedCredentials?.openai?.apiKey || process.env.OPENAI_API_KEY || "").trim();
// New:
const userApiKey = String(resolvedCredentials?.openai?.apiKey || config.OPENAI_API_KEY || "").trim();

// Old: const azureEndpoint = String(process.env.AZURE_OPENAI_ENDPOINT || "")...
// New:
const azureEndpoint = config.AZURE_OPENAI_ENDPOINT;
const azureKey = config.AZURE_OPENAI_KEY;
```

- [ ] **Step 5: Run all tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/routes/terminal.routes.js src/routes/realtime.routes.js src/routes/app.routes.js src/routes/assistant.routes.js
git commit -m "refactor(routes): use centralized config for all env-var access"
```

---

### Task 10: Delete startup-checks.js and update its test

**Files:**
- Delete: `src/core/startup-checks.js`
- Modify: `test/startup-checks.test.js`

- [ ] **Step 1: Update startup-checks test to test config validation instead**

Replace `test/startup-checks.test.js` contents:

```js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { validateConfig } = require("../src/config");

test("given development env with no vars set, returns ok=true with warnings", () => {
  const result = validateConfig({});
  assert.equal(result.ok, true, "should be ok in dev even without vars");
  assert.equal(result.errors.length, 0);
  assert.ok(result.warnings.length >= 1, "should have at least one warning");
});

test("given production env without encryption key, returns ok=false", () => {
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_COSMOS_ENDPOINT: "https://example.documents.azure.com",
    MESH_COSMOS_KEY: "some-key",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_DATA_ENCRYPTION_KEY")));
});

test("given production env without Cosmos DB config, returns ok=false", () => {
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
  });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes("MESH_COSMOS_ENDPOINT")));
});

test("given production env with all required vars, returns ok=true", () => {
  const result = validateConfig({
    NODE_ENV: "production",
    MESH_DATA_ENCRYPTION_KEY: "a-real-secret-key-here-32chars!!",
    MESH_COSMOS_ENDPOINT: "https://example.documents.azure.com",
    MESH_COSMOS_KEY: "some-key",
  });
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

test("given no ANTHROPIC_API_KEY, includes a warning", () => {
  const result = validateConfig({});
  assert.ok(result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});

test("given ANTHROPIC_API_KEY set, no warning about it", () => {
  const result = validateConfig({ ANTHROPIC_API_KEY: "sk-ant-test-key" });
  assert.ok(!result.warnings.some((w) => w.includes("ANTHROPIC_API_KEY")));
});
```

- [ ] **Step 2: Delete startup-checks.js**

```bash
rm src/core/startup-checks.js
```

- [ ] **Step 3: Run all tests**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add -u src/core/startup-checks.js
git add test/startup-checks.test.js
git commit -m "refactor(config): absorb startup-checks into config module, delete old file"
```

---

### Task 11: Final verification — zero remaining process.env in business code

- [ ] **Step 1: Grep for remaining process.env in src/**

Run: `grep -rn 'process\.env\.' src/ --include='*.js' | grep -v 'node_modules' | grep -v 'process.env.SHELL' | grep -v 'process.env.HOME' | grep -v 'process.platform'`

Expected: Zero results (only system-level vars like `SHELL`, `HOME`, `platform` are acceptable).

If any results remain: fix them by adding the missing key to `src/config/index.js` and replacing the `process.env` read.

- [ ] **Step 2: Run full test suite**

Run: `node --test`
Expected: All tests PASS

- [ ] **Step 3: Verify server boots**

Run: `timeout 5 node src/server.js 2>&1 || true`
Expected: "Server started" log message, no crashes.

- [ ] **Step 4: Commit any remaining fixes**

```bash
git add -A
git commit -m "refactor(config): final cleanup — zero process.env in business code"
```
