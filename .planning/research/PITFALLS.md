# Pitfalls Research

**Domain:** Node.js/Express production hardening & quality sweep
**Researched:** 2026-04-16
**Confidence:** HIGH

## Critical Pitfalls

### Pitfall 1: CSP Tightening Breaks Inline Scripts

**What goes wrong:**
Removing `unsafe-inline` from CSP causes all inline `<script>` and `<style>` tags to stop executing. With 16 HTML pages many containing inline scripts, this silently breaks the entire frontend.

**Why it happens:**
CSP violations are logged to console but don't throw errors — the page loads but functionality is missing. Easy to miss in testing if you only check the happy path.

**How to avoid:**
1. Audit all 16 HTML files for inline scripts/styles BEFORE changing CSP
2. Move inline scripts to external files first
3. Add nonce-based CSP as intermediate step (allows tagged inline scripts)
4. Use CSP report-only mode first to detect violations without breaking

**Warning signs:**
Browser console shows `Refused to execute inline script` errors. Features silently stop working.

**Phase to address:** Security hardening phase (CSP + innerHTML work)
**Severity:** Breaks prod

---

### Pitfall 2: innerHTML Replacement Causes Visual Regressions

**What goes wrong:**
Replacing ~100+ `innerHTML` calls with DOM APIs changes rendering subtly. HTML string patterns that relied on browser's HTML parser behavior (auto-closing tags, whitespace normalization) produce different results with `createElement`/`textContent`.

**Why it happens:**
`innerHTML` delegates to the browser's HTML parser which is very forgiving. DOM APIs are stricter. Template literals with complex nested HTML are especially prone to differences.

**How to avoid:**
1. Replace one file at a time, not bulk
2. Screenshot comparison before/after each file
3. Prioritize: chat messages (DOMPurify already used) are safe; dynamic UI construction is risky
4. Keep `innerHTML` where content is static HTML (templates) — focus on user-content injection points
5. Consider `DOMPurify.sanitize()` as intermediate step where full DOM rewrite is too risky

**Warning signs:**
Broken layouts, missing elements, double-escaped HTML, lost event listeners.

**Phase to address:** Frontend security phase
**Severity:** Breaks prod (visual regressions)

---

### Pitfall 3: Module Split Breaks Import Chains

**What goes wrong:**
Splitting a 1,700-line file into 5 smaller files means every `require('./workspace-ops')` across the codebase must be updated. Missing one import = runtime crash on the first request that hits that code path.

**Why it happens:**
CommonJS `require()` resolves at runtime, not compile time. There's no static analysis to catch broken imports until the code path executes. With ~25% test coverage, many paths are untested.

**How to avoid:**
1. Keep the original file as a re-export facade: `module.exports = { ...require('./workspace/files'), ...require('./workspace/search') }`
2. Update external consumers to point at the facade first
3. Gradually migrate consumers to import from specific sub-modules
4. Run full test suite after each split
5. Grep for ALL require paths before moving any function

**Warning signs:**
`Cannot find module` errors, `undefined is not a function` errors on specific routes.

**Phase to address:** Code quality / module decomposition phase
**Severity:** Breaks prod

---

### Pitfall 4: Global State Refactor Creates Race Conditions

**What goes wrong:**
`src/core/index.js` assigns shared mutable state (`localAssistantWorkspace`, `workspaceMetadataStore`) that 10+ modules read/write. Changing how this state is managed (DI, module scoping) can introduce race conditions if two request handlers modify state concurrently.

**Why it happens:**
The current design "works" because mutations happen in a specific order that evolved organically. Restructuring breaks those implicit ordering guarantees.

**How to avoid:**
1. Do this LAST — after all module splits and after test coverage is high
2. Add tests that exercise concurrent access patterns BEFORE refactoring
3. Make state changes explicit (function calls, not direct mutation)
4. Consider keeping the wiring hub pattern but making it read-only after init

**Warning signs:**
Intermittent failures, data corruption that only happens under load, "works locally but fails in prod" syndrome.

**Phase to address:** Code quality phase (final step)
**Severity:** Breaks prod (intermittent, hard to debug)

---

### Pitfall 5: Zod Migration Changes Validation Behavior

**What goes wrong:**
Replacing hand-rolled validators with Zod changes error messages, edge case handling, and coercion behavior. API consumers (frontend JS, external tools) that parse error responses break.

**Why it happens:**
Hand-rolled validators have specific string error messages that frontend code matches against. Zod produces structured errors in a different format. Edge cases (empty strings, extra fields, type coercion) behave differently.

**How to avoid:**
1. Map Zod errors back to the existing `{ ok: false, error: "message" }` response format
2. Replace one schema at a time, test the route, check frontend behavior
3. Write a Zod-to-existing-format error transformer in the validation middleware
4. Add integration tests for each route's error responses BEFORE migrating

**Warning signs:**
Frontend toast messages showing "[object Object]" or raw Zod error paths.

**Phase to address:** Security hardening phase (validation replacement)
**Severity:** Breaks prod (user-facing error messages)

---

### Pitfall 6: CI Pipeline Fails on First Run Due to Env Vars

**What goes wrong:**
Tests that work locally fail in CI because they depend on env vars, DynamoDB connection, or file system state that doesn't exist in the CI runner.

**Why it happens:**
Existing tests may implicitly depend on `.env` file, local SQLite database, or workspace state. This isn't visible when running locally.

**How to avoid:**
1. Run tests in CI with minimal env (no `.env` file) first to discover dependencies
2. Ensure all tests use `buildConfig()` with explicit test env vars
3. Mock or skip tests that require external services (DynamoDB, S3)
4. Add `test:ci` script that sets `NODE_ENV=test` and required minimum env vars

**Warning signs:**
Green locally, red in CI. `ECONNREFUSED` errors. `Config validation failed` in test output.

**Phase to address:** CI/CD phase
**Severity:** Wastes time (blocks all CI progress until fixed)

---

### Pitfall 7: Template Engine Migration Breaks Asset Paths

**What goes wrong:**
Moving from standalone HTML files to nunjucks templates changes how relative paths resolve. `<link href="assets/app.css">` works from `views/app.html` but breaks when the template is rendered from a different directory.

**Why it happens:**
Template engines render from the template root, not the file's location. Relative paths that worked as direct file serving break under template rendering.

**How to avoid:**
1. Use absolute paths (`/assets/app.css`) everywhere, not relative
2. Convert one page at a time, verify all assets load
3. Keep the existing content-hash cache-busting system working through the migration
4. Test with browser DevTools Network tab to catch 404s on assets

**Warning signs:**
Broken CSS, missing JS, 404 errors in browser network tab.

**Phase to address:** UI/UX phase (template engine)
**Severity:** Breaks prod (visual)

---

### Pitfall 8: Adding Tests to Untested Code Reveals Bugs

**What goes wrong:**
Writing tests for the 6 untested core modules (~7,000 lines) exposes actual bugs. The tests "fail" not because the test is wrong but because the code has real issues that were never caught.

**Why it happens:**
Code that's never been tested often has edge cases that don't work. With 1,700-line files and cyclomatic complexity >10, there are hidden code paths with bugs.

**How to avoid:**
1. This is actually GOOD — finding bugs is the point
2. Budget extra time for test writing (2x normal) because you'll be fixing bugs too
3. Start with smoke tests (does the function exist, does it not throw on basic input) before testing edge cases
4. Document discovered bugs as findings, fix them in the same phase

**Warning signs:**
Test writing taking 3x longer than expected. Cascade of failures when one function is fixed.

**Phase to address:** Testing phase
**Severity:** Wastes time (but produces value)

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep re-export facade after module split | Zero breaking changes | Extra indirection; consumers never migrate | Acceptable for 1 milestone; plan migration |
| innerHTML with DOMPurify instead of DOM APIs | Fast, covers XSS | Still relying on sanitizer correctness | Acceptable for user-generated content; not for static UI |
| CSP with nonces instead of no-inline | Allows some inline scripts | Nonce management complexity | Acceptable permanently; this is the standard approach |
| Tests without mocks (integration-style) | Faster to write; tests real behavior | Slower test suite; fragile if external deps change | Acceptable for this codebase; pure unit tests would require DI refactor first |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Unbounded workspace Map | Heap grows, GC pauses, eventual OOM | lru-cache with maxSize based on available memory | >500 concurrent workspaces |
| Rate limiter Map with 10K threshold | Memory spike during traffic burst | lru-cache with maxSize: 5000 | DDoS or traffic spike |
| Synchronous readFileSync per HTML request | Blocks event loop under concurrent requests | Async read + in-memory cache at startup | >50 concurrent page loads |
| Prompt caching miss (no cache_control) | Full input token cost every request | Phase 18: add cache_control blocks | Every Anthropic API call |

## "Looks Done But Isn't" Checklist

- [ ] **CSP:** Verify no console errors in ALL 16 pages, not just app.html
- [ ] **CSRF:** Verify tokens work with WebSocket upgrade (terminal, voice)
- [ ] **innerHTML:** Verify event listeners still work after DOM API conversion
- [ ] **Module splits:** Verify ALL routes still work, not just the ones with tests
- [ ] **CI pipeline:** Verify it catches a deliberately broken test (not just passing green)
- [ ] **Template engine:** Verify content-hash cache busting still works
- [ ] **Accessibility:** Verify keyboard nav works in EVERY panel, not just the editor
- [ ] **Error handling:** Verify errors in WebSocket handlers are caught (not just HTTP routes)

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| CSP breaks inline scripts | Security hardening | All 16 pages functional with strict CSP |
| innerHTML visual regressions | Frontend security | Screenshot comparison before/after |
| Module split import breaks | Code quality | Full test suite green after each split |
| Global state race conditions | Code quality (final) | Concurrent request test suite |
| Zod validation behavior change | Security hardening | Integration tests for error responses |
| CI env var failures | CI/CD setup | Green pipeline with zero local deps |
| Template asset path breaks | UI/UX | Zero 404s in browser network tab |
| Tests revealing bugs | Testing | Budget 2x time; track discovered bugs |

## Sources

- Codebase audit: `.planning/codebase/CONCERNS.md`, `TESTING.md`
- Node.js monolith refactoring post-mortems
- Express security hardening guides (OWASP)

---
*Pitfalls research for: Node.js/Express production hardening*
*Researched: 2026-04-16*
