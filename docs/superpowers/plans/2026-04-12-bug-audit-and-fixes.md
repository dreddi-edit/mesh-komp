# Bug Audit & Fix Plan — 2026-04-12

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix all runtime-crashing bugs, misrouted logging, and the stale `gpt-5.4-nano` model default discovered during the post-deployment audit.

**Architecture:** Pure fix pass — no new features. Touches `src/server.js` (CSP), `src/routes/assistant.routes.js` (missing imports + destructuring), `src/routes/app.routes.js` (invalid model), and scattered `console.*` calls that bypass the structured JSON logger.

**Tech Stack:** Node.js 22, Express 4, structured JSON logger (`src/logger.js`)

---

## Severity Legend

| Level | Meaning |
|---|---|
| 🔴 CRITICAL | Runtime crash / security block on production code path |
| 🟠 HIGH | Feature fails silently or returns wrong error |
| 🟡 MEDIUM | Observability degraded (log lines escape the JSON logger) |

---

## Bug Inventory

### 🔴 CRITICAL — `worker-src` missing from Content-Security-Policy

**File:** `src/server.js:37-47`

**Symptom:** Voice chat breaks immediately in every browser. `AudioWorklet.addModule('/assets/features/voice-audio-worklet.js')` is blocked by CSP because no `worker-src` directive is present. The browser falls back to blocking `'none'` for workers.

**Fix:** Add `"worker-src 'self'"` to the CSP array.

---

### 🔴 CRITICAL — `path` and `fs` not imported in `assistant.routes.js`

**File:** `src/routes/assistant.routes.js`

The file has `'use strict'` and only imports `express`. Both `path` and `fs` are used without being required:

- `path` used in git-clone local fallback (line 860): `path.dirname`, `path.resolve`, `path.sep`, `path.basename`
- `fs` used in git-clone local fallback (line 868): `fs.promises.mkdir`
- `path` + `fs` used in extension-install route (lines 1674–1702): `path.resolve`, `fs.existsSync`, `fs.mkdirSync`, `fs.writeFileSync`, `fs.unlinkSync`

**Symptom:** Any call to `POST /api/assistant/git/clone` (local fallback path) or `POST /api/assistant/extensions/install` throws `ReferenceError: path is not defined` / `fs is not defined`.

**Fix:** Add `const path = require('path');` and `const fs = require('fs');` at the top of the file.

---

### 🔴 CRITICAL — Four core symbols not destructured in `createAssistantRouter`

**File:** `src/routes/assistant.routes.js:22-98`

These symbols are exported from `src/core/index.js` but absent from the destructuring block at the top of `createAssistantRouter`:

| Symbol | Used at lines | Affected routes |
|---|---|---|
| `assistantRuns` | 587, 597, 603 | GET/POST `/api/assistant/runs/:runId(/**)` |
| `MESH_DEFAULT_MODEL` | 938, 1206, 1539 | POST `/api/assistant/chat`, `/stream`, `/api/inline-complete` |
| `MESH_MODEL_CODEC_VERSION` | 1098, 1127, 1136, 1187 | POST `/api/assistant/chat` response payload |
| `toAnthropicMessages` | 1306 | POST `/api/assistant/chat/stream` (Anthropic native path) |

**Symptom:** With `'use strict'`, accessing an undeclared variable is a `ReferenceError`. All four routes throw and return 400 on every call.

**Fix:** Add the four names to the destructuring block that starts at line 22.

---

### 🟠 HIGH — `gpt-5.4-nano` invalid model in inline-complete route

**File:** `src/routes/app.routes.js:557`

```js
const deployment = "gpt-5.4-nano";
```

`gpt-5.4-nano` does not exist as an Azure OpenAI deployment. Every request to `POST /api/inline-complete` (the simple app-router version, distinct from `/api/assistant/chat`) returns an Azure 404, which the route surfaces as a 404 to the client.

**Fix:** Change to `"gpt-4.1-mini"` (the valid deployment, same as the voice pipeline fix already shipped).

---

### 🟡 MEDIUM — `console.*` usage bypassing structured JSON logger

**Files and line counts:**

| File | Type | Count |
|---|---|---|
| `src/routes/assistant.routes.js` | `console.error` | 9 |
| `src/routes/app.routes.js` | `console.error` | 5 |
| `src/routes/realtime.routes.js:118` | `console.log` | 1 |
| `src/core/workspace-ops.js:29` | `console.error` | 1 |
| `src/core/auth.js:122` | `console.error` | 1 |
| `src/core/workspace-infrastructure.js` | `console.log` / `console.error` | 4 |

These lines emit unstructured plain-text to stdout/stderr, bypassing the JSON logger. In production, log aggregation tools (Azure Monitor, etc.) parse each line as a JSON object. Plain-text lines break parsing, get dropped from search, and miss the `requestId` correlation field.

**Fix pattern for each site:**
```js
// Before
console.error('[assistant-routes] Something failed:', error.message);

// After
const logger = require('../logger');
// … then at the call site:
logger.error('Something failed', { scope: 'assistant-routes', error: error.message });
```

---

## Tasks

### Task 1: Add `worker-src` to CSP and fix `gpt-5.4-nano` in app.routes.js

**Files:**
- Modify: `src/server.js:37-47`
- Modify: `src/routes/app.routes.js:557`

- [ ] **Step 1: Edit CSP in server.js**

  In `src/server.js`, find the CSP array:
  ```js
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ]
  ```
  Change it to:
  ```js
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ]
  ```

- [ ] **Step 2: Fix invalid model in app.routes.js**

  In `src/routes/app.routes.js`, line 557:
  ```js
  // Before
  const deployment = "gpt-5.4-nano";
  // After
  const deployment = "gpt-4.1-mini";
  ```

- [ ] **Step 3: Run tests**

  ```bash
  node --test test/startup-checks.test.js test/logger.test.js test/security-integration.test.js
  ```
  Expected: all pass.

- [ ] **Step 4: Commit**

  ```bash
  git add src/server.js src/routes/app.routes.js
  git commit -m "fix(csp,routes): add worker-src for AudioWorklet, fix gpt-5.4-nano invalid model"
  ```

---

### Task 2: Fix missing imports and destructuring in `assistant.routes.js`

**Files:**
- Modify: `src/routes/assistant.routes.js`

- [ ] **Step 1: Add missing module imports at top of file**

  After `'use strict';` and `const express = require('express');`, add:
  ```js
  const path = require('path');
  const fs = require('fs');
  ```

- [ ] **Step 2: Add missing core symbols to destructuring**

  In the `createAssistantRouter(core)` destructuring block (around line 22), find the end of the destructured list:
  ```js
    isMeshWorkerUnavailableError,
    isLocalPathWorkspaceState,
    isArray,
  } = core;
  ```
  Change it to:
  ```js
    isMeshWorkerUnavailableError,
    isLocalPathWorkspaceState,
    isArray,
    assistantRuns,
    MESH_DEFAULT_MODEL,
    MESH_MODEL_CODEC_VERSION,
    toAnthropicMessages,
  } = core;
  ```

- [ ] **Step 3: Run tests**

  ```bash
  node --test test/startup-checks.test.js test/logger.test.js
  ```
  Expected: all pass. (Integration tests require a live server; the unit tests validate imports.)

- [ ] **Step 4: Verify no more ReferenceErrors by loading the module**

  ```bash
  node -e "const {createAssistantRouter} = require('./src/routes/assistant.routes'); console.log('OK');"
  ```
  Expected: prints `OK` with no error.

- [ ] **Step 5: Commit**

  ```bash
  git add src/routes/assistant.routes.js
  git commit -m "fix(routes): add missing path/fs imports and core destructures in assistant.routes.js"
  ```

---

### Task 3: Replace `console.*` with structured logger in all src/ files

**Files:**
- Modify: `src/routes/assistant.routes.js`
- Modify: `src/routes/app.routes.js`
- Modify: `src/routes/realtime.routes.js`
- Modify: `src/core/workspace-ops.js`
- Modify: `src/core/auth.js`
- Modify: `src/core/workspace-infrastructure.js`

The logger is at `src/logger.js` and exports `{ info, warn, error }`. The relative import path from `src/routes/*.js` is `'../logger'`; from `src/core/*.js` it is `'./logger'` or `'../logger'` depending on depth.

- [ ] **Step 1: Add logger import to each route file that lacks it**

  Check which route files already import logger:
  ```bash
  grep -l "require.*logger" src/routes/*.js src/core/*.js
  ```

  For each file listed in the table above that does NOT already import logger, add the import after the existing requires. Use the correct relative path.

- [ ] **Step 2: Replace every `console.error` / `console.log` in route files**

  **`src/routes/assistant.routes.js`** — `safeRouteError` helper (line 14):
  ```js
  // Before
  function safeRouteError(res, statusCode, fallbackMessage, error) {
    console.error(`[assistant-routes] ${fallbackMessage}:`, String(error?.message || error || 'unknown'));
    res.status(statusCode).json({ ok: false, error: fallbackMessage });
  }
  // After
  function safeRouteError(res, statusCode, fallbackMessage, error) {
    logger.error(fallbackMessage, { scope: 'assistant-routes', error: String(error?.message || error || 'unknown') });
    res.status(statusCode).json({ ok: false, error: fallbackMessage });
  }
  ```

  For the inline `console.error` in workspace select (line 158), Anthropic streaming error (line 1330), stream catch (line 1424), provider error (line 1458), completion catch (line 1573), extension install catch (line 1703) — apply the same pattern: replace with `logger.error(message, { scope: 'assistant-routes', ... })`.

  **`src/routes/app.routes.js`** — lines 297, 335, 542, 578, 585:
  ```js
  // Before
  console.error('[app-routes] Failed to build repo docs index:', String(error?.message || error || 'unknown'));
  // After
  logger.error('Failed to build repo docs index', { scope: 'app-routes', error: String(error?.message || error || 'unknown') });
  ```
  Apply the same pattern to lines 335, 542, 578, 585.

  **`src/routes/realtime.routes.js`** — line 118:
  ```js
  // Before
  console.log(`[voice][perf] ${label}`, meta);
  // After
  logger.info(label, { scope: 'voice-perf', ...meta });
  ```

- [ ] **Step 3: Replace `console.*` in core files**

  **`src/core/workspace-ops.js:29`:**
  ```js
  // Before
  console.error("[mesh] local enrichment failed:", error?.message || error);
  // After
  logger.error('Local enrichment failed', { scope: 'workspace-ops', error: String(error?.message || error) });
  ```

  **`src/core/auth.js:122`** (`reportAuthStoreError`):
  ```js
  // Before
  console.error(`[auth-store] ${scope}: ${message}`);
  // After
  logger.error(message, { scope: `auth-store.${scope}` });
  ```

  **`src/core/workspace-infrastructure.js`** — lines 68, 433, 456, 459:
  ```js
  // Before (line 68)
  console.log(`[mesh-perf] ${scope} total=${totalMs}ms meta=${JSON.stringify({ ...meta, ...extra })}${detail ? ` steps=${detail}` : ""}`);
  // After
  logger.info(`Perf: ${scope}`, { scope: 'mesh-perf', totalMs, ...meta, ...extra, steps: detail || undefined });

  // Before (line 433)
  console.log(`[mesh] Provisioned local metadata to ${meshDir}`);
  // After
  logger.info('Provisioned local metadata', { scope: 'workspace-infra', meshDir });

  // Before (line 456)
  console.log(`[mesh] Provisioned virtual metadata for cloud workspace ${workspaceId}`);
  // After
  logger.info('Provisioned virtual metadata', { scope: 'workspace-infra', workspaceId });

  // Before (line 459)
  console.error(`[mesh] Failed to provision metadata: ${error.message}`);
  // After
  logger.error('Failed to provision metadata', { scope: 'workspace-infra', error: error.message });
  ```

- [ ] **Step 4: Run full fast test suite**

  ```bash
  node --test test/startup-checks.test.js test/logger.test.js test/compression-core.test.js test/terminal-routes.test.js test/realtime-routes.test.js
  ```
  Expected: all pass.

- [ ] **Step 5: Smoke-test module loading**

  ```bash
  node -e "require('./src/server.js')" &
  sleep 3 && kill %1
  ```
  Expected: JSON log line `{"ts":"...","level":"info","msg":"Server started",...}` — no plain-text log lines.

- [ ] **Step 6: Commit**

  ```bash
  git add src/routes/assistant.routes.js src/routes/app.routes.js src/routes/realtime.routes.js src/core/workspace-ops.js src/core/auth.js src/core/workspace-infrastructure.js
  git commit -m "refactor(logging): replace console.* with structured logger across all src/ files"
  ```

---

## Verification

After all three tasks are committed:

```bash
# 1. No console.* left in src/
grep -rn "console\.\(log\|error\|warn\)" src/ && echo "FAIL" || echo "PASS"

# 2. Module loads without ReferenceError
node -e "const {createAssistantRouter}=require('./src/routes/assistant.routes');console.log('OK')"

# 3. CSP includes worker-src
node -e "require('./src/server.js')" & sleep 2 && curl -sI http://localhost:8080/healthz | grep -i content-security-policy | grep worker-src && echo "CSP OK" ; kill %1

# 4. Full test suite
node --test test/startup-checks.test.js test/logger.test.js test/compression-core.test.js test/security-integration.test.js test/terminal-routes.test.js test/realtime-routes.test.js
```
