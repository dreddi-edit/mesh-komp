---
tags: [development]
---

# Testing

## Test Runner

Node.js built-in test runner (`node --test`).

```bash
npm test           # run all tests
node --test <file> # run specific file
```

## Test Files

### Core / Assistant

| File | What It Tests |
|------|--------------|
| `test/assistant-core.test.js` | Unit/integration coverage for `assistant-core.js` |
| `test/assistant-integration.test.js` | Integration tests across server/assistant/runtime flows |
| `test/auth.test.js` | Authentication, session lifecycle, BYOK |
| `test/config.test.js` | Centralized config validation logic |
| `test/logger.test.js` | Structured logger output |

### Compression

| File | What It Tests |
|------|--------------|
| `test/compression-core.test.js` | Capsule pipeline, passthrough, compact headers, raw storage encoding, transport envelope, focused query ranking, tiered token budget, legacy encoding backward compat |
| `test/compression-benchmark.test.js` | Benchmark/compression assumptions |

### Routes / Security

| File | What It Tests |
|------|--------------|
| `test/model-providers.test.js` | Model registry, provider routing, BYOK calls |
| `test/mesh-codec.test.js` | Mesh model codec encode/decode |
| `test/rate-limiter.test.js` | Rate limiting middleware |
| `test/realtime-routes.test.js` | Voice WebSocket session handling |
| `test/terminal-routes.test.js` | Terminal WebSocket setup |
| `test/security-integration.test.js` | CSRF, headers, XSS protection |

### ccmon

| File | What It Tests |
|------|--------------|
| `test/ccmon/parser.test.js` | JSONL parsing, event normalization |
| `test/ccmon/history.test.js` | Historical aggregation logic |
| `test/ccmon/pricing.test.js` | Cost calculation functions |
| `test/ccmon/render.test.js` | Panel render functions |
| `test/ccmon/state.test.js` | State accumulator and event application |

## Test Standards (from CLAUDE.md)

- **AAA pattern**: Arrange → Act → Assert
- Test **behavior, not implementation** — tests should survive refactors
- Name format: `given [context], when [action], then [expected]`
- Mock at module boundaries only
- Tests must be deterministic and isolated — no shared mutable state

## Coverage Targets

- >80% coverage on business logic
- 100% on critical paths (auth, compression, workspace identity)

## Integration Tests (`assistant-integration.test.js`)

These tests exercise full server/assistant/runtime flows. They require:
- A running server instance (or mock)
- Route APIs accessible
- Workspace files accessible

Run separately from unit tests when testing end-to-end behavior.

## Benchmarks (Not Tests)

`benchmarks/compression-benchmark.js` measures compression ratio and speed.

```bash
npm run bench:compression
```

Use this to validate that compression changes don't regress performance before shipping.
