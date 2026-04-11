---
tags: [development]
---

# Scripts and Commands

## npm Scripts (Root Package)

```bash
npm start              # Start the gateway: node server.js
npm run monitor        # Launch ccmon dashboard: node ccmon.js
npm run bench:compression  # Run compression benchmark
npm test               # Run all tests: node --test
npm run lint           # Lint all JS: eslint .
npm run lint:fix       # Auto-fix lint issues: eslint . --fix
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
npm run monitor
# or
node ccmon.js
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

See [[Operations/Deploy Runbook]] for full deploy commands.

Quick reference:

```bash
# Deploy gateway
zip -rq -0 /tmp/mesh-gateway-deploy.zip . \
  -x "node_modules/*" "mesh-core/node_modules/*" ".mesh*" "*.DS_Store"
az webapp deploy -g mesh-rg -n mesh-gateway-303137 \
  --src-path /tmp/mesh-gateway-deploy.zip --type zip --clean false --restart true

# Restart gateway
az webapp restart -g mesh-rg -n mesh-gateway-303137

# Check app settings
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 -o table
```

## LLM Compression CLI (`llm-compress.js`)

Legacy CLI for testing compression heuristics:

```bash
node llm-compress.js <file-path>
```

Useful for manually testing how a file is compressed before shipping changes to `compression-core.cjs`.
