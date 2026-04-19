# Phase 22: Testing & CI/CD - Context

**Gathered:** 2026-04-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Set up GitHub Actions CI pipeline, add c8 code coverage, write dedicated tests for 6 untested core modules, create Playwright E2E suite, and add frontend smoke tests. Safety net for upcoming refactoring phases.

</domain>

<decisions>
## Implementation Decisions

### CI Pipeline
- **D-01:** Create `.github/workflows/ci.yml` — lint → test → coverage on push and PR
- **D-02:** Include `npm audit` step that fails CI on high/critical severity vulnerabilities
- **D-03:** Use Node.js built-in test runner (`node --test`) — no framework migration
- **D-04:** c8 for coverage reports; coverage badge or summary in CI output

### Core Module Tests
- **D-05:** Dedicated test files for 6 untested modules, each targeting >60% line coverage:
  - `test/workspace-ops.test.js` — currently 84 lines, needs expansion (source is 1,723 lines)
  - `test/workspace-infrastructure.test.js` — new (source is 1,191 lines)
  - `test/workspace-context.test.js` — new (source is 1,146 lines)
  - `test/assistant-runs.test.js` — new (source is 1,130 lines, currently only integration coverage)
  - `test/voice-agent.test.js` — new (source is 851 lines)
  - `test/deployments.test.js` — new (source is 210 lines)
- **D-06:** Tests use manual stubs and in-memory fakes — no mock framework (consistent with existing pattern)
- **D-07:** Existing test files (13 files, 2,665 lines) must continue passing

### E2E Tests
- **D-08:** Playwright E2E tests covering: login flow, workspace open, chat send, terminal launch, voice page load
- **D-09:** Replace/supplement Puppeteer (`devDependencies`) with Playwright — or keep Puppeteer and add Playwright separately
- **D-10:** E2E tests may need a test server setup (start server, seed demo user, run tests, tear down)

### Frontend Smoke Tests
- **D-11:** Verify all 16 HTML pages load without JS console errors
- **D-12:** Can be Playwright-based or standalone script using headless browser

### Claude's Discretion
- c8 configuration and thresholds
- CI runner OS (ubuntu-latest)
- Whether to use matrix builds for Node versions
- E2E test server lifecycle management
- Playwright vs. Puppeteer decision for E2E

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Testing Patterns
- `.planning/codebase/TESTING.md` — Full test inventory: 13 files, 2,665 lines, test patterns, mocking approach, coverage gaps
- `.planning/codebase/CONVENTIONS.md` §Error Handling — `safeRouteError()` pattern tests need to verify

### Coverage Gaps
- `.planning/codebase/TESTING.md` §Coverage Gaps — Lists all untested modules with line counts
- `.planning/codebase/CONCERNS.md` §6 (Missing Infrastructure → No CI/CD) — No GitHub Actions config exists

### Module Structure
- `.planning/codebase/STRUCTURE.md` — All source files and line counts for test planning
- `.planning/codebase/ARCHITECTURE.md` §3 (Core Logic) — Module responsibilities and dependencies

### Requirements
- `.planning/REQUIREMENTS.md` — TEST-01, TEST-02, TEST-03, TEST-04, INFRA-01, INFRA-04

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- 13 existing test files (2,665 lines) — patterns to follow for new tests
- `node:test` + `node:assert/strict` — established testing framework
- `src/config/index.js` `buildConfig()` — tests can create isolated config instances
- Puppeteer already in devDependencies for E2E

### Established Patterns
- `describe`/`it` from `node:test` with `assert.strictEqual` assertions
- Manual stubs (no jest.mock or sinon) — test isolation via config injection
- Auth tests demonstrate the pattern: `buildConfig()` with test env vars
- Integration tests exercise real code paths

### Integration Points
- `package.json` test script: `node --test --test-force-exit --test-timeout=120000`
- `test/` directory at project root — all test files live here
- No `.github/` directory exists — CI pipeline is net new

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 22-testing-ci-cd*
*Context gathered: 2026-04-16*
