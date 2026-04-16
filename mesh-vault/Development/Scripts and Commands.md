---
tags: [development]
---

# Scripts and Commands

## npm Scripts (Root Package)

```bash
npm start                  # Start the gateway: node --env-file .env src/server.js
npm run monitor:web        # Launch ccmon dashboard: node ccmon-server.js
npm run bench:compression  # Run compression benchmark
npm test                   # Run all tests: node --test
npm run test:workspace-ops # Run workspace-ops tests only: node --test test/workspace-ops.test.js
npm run lint               # Lint all JS: eslint .
npm run lint:fix           # Auto-fix lint issues: eslint . --fix
```

## Running Locally

### Start Gateway
```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
npm start
```

### Start Worker
```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
node mesh-core/src/server.js
```

### Watch ccmon (Claude Code cost monitor)
```bash
npm run monitor:web
# or
node ccmon-server.js
```

## Syntax Checks (Pre-Deploy)

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

## Running Tests

```bash
# All tests
npm test

# Specific test files
node --test test/assistant-core.test.js
node --test test/compression-core.test.js
node --test test/ccmon/parser.test.js
```

## Compression Benchmark

```bash
npm run bench:compression
# or
node benchmarks/compression-benchmark.js
```

## Deploy Commands

See [[Operations/Deploy Runbook]] for full deploy commands (EC2 Rsync approach).

## LLM Compression CLI (`llm-compress.js`)

Legacy CLI for testing compression heuristics:

```bash
node llm-compress.js <file-path>
```

Useful for manually testing how a file is compressed before shipping changes to `compression-core.cjs`.
