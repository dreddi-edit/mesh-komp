# Conventions

## Module Pattern

All source files follow this structure:
```javascript
'use strict';

/**
 * JSDoc module header with description.
 */

const dependency = require('./dependency');

// ── Section headers use box-drawing characters ──

function namedFunction() { ... }

module.exports = { namedFunction };
```

Key patterns:
- `'use strict'` at top of every file
- CommonJS `require()` / `module.exports` throughout — no ESM
- Section headers with `// ── Title ──` box-drawing style
- JSDoc on all exported functions with `@param`, `@returns`, `@throws`
- Named function declarations preferred over arrow function assignments for exports

## Naming

| Context | Convention | Examples |
|---------|-----------|----------|
| Functions | camelCase | `readAuthCookieToken`, `localWorkspaceSelect` |
| Constants | SCREAMING_SNAKE | `AUTH_SESSION_TTL_MS`, `WORKSPACE_BROTLI_QUALITY` |
| Config keys | SCREAMING_SNAKE | `MESH_DYNAMO_ENABLED`, `ANTHROPIC_API_KEY` |
| Files | kebab-case | `voice-aws-audio.js`, `assistant-chat.routes.js` |
| Route files | `{domain}.routes.js` | `auth.routes.js`, `terminal.routes.js` |
| Boolean flags | `is`/`has`/`should` prefix | `isLocalPathWorkspaceState()`, `hasCodecContextMarker()` |
| Normalization | `normalize` prefix | `normalizeEmail()`, `normalizeStoredByokProviders()` |
| Validation | `validate` prefix or `ensure` prefix | `validateConfig()`, `ensureWorkspaceOwnedPath()` |

## Error Handling

### Route-Level Pattern
Routes use `safeRouteError()` for consistent error responses:
```javascript
// src/routes/route-utils.js
function safeRouteError(res, statusCode, publicMessage, error) {
  logger.error(publicMessage, { error: String(error?.message || error) });
  res.status(statusCode).json({ ok: false, error: publicMessage });
}
```

Routes wrap async handlers in try/catch and delegate to `safeRouteError`:
```javascript
router.post('/api/...', requireAuth, async (req, res) => {
  try {
    const result = await someOperation();
    res.json(result);
  } catch (error) {
    safeRouteError(res, 400, 'Operation failed', error);
  }
});
```

### Core-Level Pattern
Core functions throw `Error` with descriptive messages. No custom error classes — plain `Error` with string messages throughout.

### Internal Error Logging
`reportAuthStoreError()` in `src/core/auth.js` throttles error logging to 1 per 30s to prevent log flooding.

## Validation

### Schema Validation
Vanilla JS objects with `.validate()` method (no Zod/Joi) in `src/schemas/index.js`:
```javascript
const schema = {
  validate: (data) => {
    if (!data.field) return { success: false, error: 'Field required' };
    return { success: true, data: { field: data.field } };
  }
};
```

Applied via `src/middleware/validate.js`:
```javascript
function validate(schema) {
  return (req, res, next) => {
    const result = schema.validate(req.body);
    if (!result.success) { res.status(400).json({ ok: false, error: result.error }); return; }
    req.body = result.data;
    next();
  };
}
```

### Input Sanitization
- `toSafePath()` — normalizes file paths, strips `..` traversal
- `ensureWorkspaceOwnedPath()` — ensures paths stay within workspace root
- `sanitizeTerminalSegment()` — strips unsafe chars from terminal workspace names
- `EXT_IDENTIFIER_RE` — allowlist for extension publisher/name/version
- `SAFE_GIT_URL_PATTERN` — protocol allowlist for git remote URLs

## Configuration Pattern

Single centralized config module (`src/config/index.js`):
- `buildConfig(env)` — constructs all config from env vars with defaults
- `validateConfig(env)` — returns `{ ok, errors, warnings }`
- Server exits on startup if critical production vars are missing
- All env vars accessed via `config.KEY` — never `process.env.KEY` in business logic
- `env-utils.js` provides typed parsers: `parseBooleanFlag()`, `parseIntegerInRange()`, `clampBrotliQuality()`

## Logging

Structured JSON logger (`src/logger.js`):
- Levels: debug, info, warn, error
- Output: JSON lines to stdout (debug/info) or stderr (warn/error)
- Context: `{ scope, requestId, error, ... }` passed as second argument
- Controlled by `LOG_LEVEL` env var

## Response Format

All API responses follow:
```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": "Human-readable message" }
```

## Global State

`src/core/index.js` acts as a wiring hub: imports all domain modules, assigns shared mutable state to module-level variables, and re-exports everything as a single `core` object that routes receive via dependency injection.

Notable globals: `localAssistantWorkspace`, `workspaceMetadataStore`, `operationsStore`, `workspaceOffloadConfig`.
