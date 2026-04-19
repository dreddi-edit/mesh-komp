# Stack

## Runtime

| Property | Value |
|----------|-------|
| Language | JavaScript (Node.js) — no TypeScript |
| Runtime | Node.js (uses `--env-file`, `node:crypto`, `node:test`) |
| Entry point | `src/server.js` (production), `server.js` (legacy dev) |
| Process manager | PM2 cluster mode (`ecosystem.config.js`) |
| Node args | `--env-file .env` for secrets loading |

## Framework

- **Express v5.2.1** — HTTP server, middleware, routing
- **ws v8.20.0** — WebSocket server (terminal, voice/realtime)
- **node-pty v1.1.0** — pseudo-terminal spawning for browser terminal

## AI / LLM Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.82.0 | Claude API client |
| `@aws-sdk/client-bedrock-runtime` | ^3.1030.0 | AWS Bedrock for model inference |

Multi-provider: Anthropic (direct + Bedrock), OpenAI-compatible, Google Gemini, BYOK via OpenRouter.

## AWS SDK Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@aws-sdk/client-dynamodb` | ^3.1030.0 | DynamoDB for auth/session/user storage |
| `@aws-sdk/lib-dynamodb` | ^3.1030.0 | DynamoDB Document Client |
| `@aws-sdk/client-s3` | ^3.1030.0 | S3 workspace blob storage |
| `@aws-sdk/s3-request-presigner` | ^3.1030.0 | Pre-signed S3 URLs |
| `@aws-sdk/client-polly` | ^3.1030.0 | Text-to-speech |
| `@aws-sdk/client-transcribe-streaming` | ^3.1030.0 | Speech-to-text |
| `@aws-sdk/client-cloudwatch` | ^3.1030.0 | Metrics/monitoring |

## Compression / Parsing

| Package | Version | Purpose |
|---------|---------|---------|
| `tree-sitter` + 7 language grammars | ^0.21.x | AST-based code compression |
| `html-minifier-terser` | ^7.2.0 | HTML minification |
| `terser` | ^5.46.1 | JS minification |
| `marked` | ^17.0.5 | Markdown → HTML rendering |
| `highlight.js` | ^11.11.1 | Syntax highlighting |
| `fast-xml-parser` | ^5.5.10 | XML parsing |
| `node-sql-parser` | ^5.4.0 | SQL parsing |
| `yaml` | ^2.8.3 | YAML parsing |
| `toml` | ^4.1.1 | TOML parsing |
| `ini` | ^6.0.0 | INI parsing |

## Data / Storage

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | ^11.10.0 | Local SQLite for dev-mode auth fallback |

## Frontend

| Package | Version | Purpose |
|---------|---------|---------|
| `animejs` | ^4.3.6 | UI animations (served from node_modules) |

## Dev Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `eslint` | ^8.57.0 | Linting |
| `puppeteer` | ^24.41.0 | E2E/integration testing |

## Build & Scripts

No build step — vanilla JS served directly. Node built-in test runner (`node --test`).

| Script | Command |
|--------|---------|
| `start` | `node --env-file .env src/server.js` |
| `test` | `node --test --test-force-exit --test-timeout=120000` |
| `lint` | `eslint .` |
| `bench:compression` | `node benchmarks/compression-benchmark.js` |
| `monitor:web` | `node --env-file .env ccmon-server.js` |

## Configuration

Centralized in `src/config/index.js` with `src/config/env-utils.js` helpers. Validates all env vars at startup — fails fast in production if critical vars are missing.

Key config groups: auth/session, AI providers, AWS services, workspace compression, rate limiting, S3 offload, voice parameters.
