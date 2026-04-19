# Testing

## Framework

- **Node.js built-in test runner** (`node --test`)
- No Jest, Vitest, or Mocha — uses `node:test` and `node:assert`
- Test command: `node --test --test-force-exit --test-timeout=120000`
- Targeted: `node --test test/workspace-ops.test.js`

## Test Files

| File | Lines | Scope |
|------|-------|-------|
| `test/compression-core.test.js` | 711 | Compression pipeline (build, view, decode, recovery) |
| `test/assistant-integration.test.js` | 572 | Assistant feature integration tests |
| `test/security-integration.test.js` | 256 | Security headers, CSRF, rate limiting, auth |
| `test/model-providers.test.js` | 247 | AI model provider routing, codec |
| `test/auth.test.js` | 188 | Auth functions (hash, verify, cookies, session) |
| `test/assistant-core.test.js` | 120 | Assistant-core shared utilities |
| `test/config.test.js` | 111 | Config validation and parsing |
| `test/realtime-routes.test.js` | 102 | Voice WebSocket session management |
| `test/rate-limiter.test.js` | 93 | Rate limiter behavior |
| `test/logger.test.js` | 84 | Logger output format and levels |
| `test/workspace-ops.test.js` | 84 | Workspace file operations |
| `test/terminal-routes.test.js` | 68 | Terminal WebSocket routing |
| `test/compression-benchmark.test.js` | 29 | Benchmark harness smoke test |
| **Total** | **2,665** | |

## Test Patterns

### Structure
Tests use `describe`/`it` from `node:test` with `assert` for assertions:
```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

describe('ModuleName', () => {
  it('should do X when Y', () => {
    const result = functionUnderTest(input);
    assert.strictEqual(result, expected);
  });
});
```

### Mocking
- **No mock framework** — manual stubs and in-memory fakes
- Auth tests create isolated instances by calling `buildConfig()` with test env vars
- Integration tests exercise real code paths (no dependency mocking)
- Puppeteer (`devDependencies`) available for E2E but no visible E2E test files

### What's Tested
- Core auth functions (password hashing, cookie parsing, session resolution)
- Config validation (startup error/warning detection)
- Rate limiter (window reset, IP extraction, threshold behavior)
- Security (CSP headers, CSRF guard, session enforcement)
- Compression pipeline (build/view/decode/recovery of workspace records)
- Model provider routing and codec encoding/decoding
- Logger output format

### Coverage Gaps

**Not covered or minimally covered:**
- `src/core/workspace-ops.js` (1,723 lines) — only 84 test lines
- `src/core/workspace-infrastructure.js` (1,191 lines) — no dedicated test file
- `src/core/workspace-context.js` (1,146 lines) — no dedicated test file
- `src/core/assistant-runs.js` (1,130 lines) — covered via integration test
- `src/core/voice-agent.js` (851 lines) — no dedicated test file
- `src/core/deployments.js` (210 lines) — no dedicated test file
- `src/routes/app.routes.js` (604 lines) — no dedicated test file
- `src/routes/assistant-workspace.routes.js` (478 lines) — no dedicated test file
- Frontend JS (assets/*.js) — no test files
- `secure-db.js` (521 lines) — no dedicated test file
- `workspace-metadata-store.cjs` (519 lines) — no dedicated test file

**Estimated coverage:** ~25-30% of backend logic by line count. Critical auth/security paths are well-tested; workspace operations and assistant features have significant gaps.

## CI Integration

No CI configuration files found (no `.github/workflows/`, no `Jenkinsfile`, no `buildspec.yml`). Tests run locally only.
