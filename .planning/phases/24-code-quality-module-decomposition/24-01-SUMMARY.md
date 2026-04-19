---
phase: 24
plan: "01"
title: "Provider + Workspace Splits"
status: complete
started: 2026-04-16T22:30:00Z
completed: 2026-04-16T23:00:00Z
---

# Summary: 24-01 Provider + Workspace Splits

## What was built

Split `src/core/model-providers.js` (1,663 lines) into `src/core/providers/` and `src/core/workspace-ops.js` (1,723 lines) into `src/core/workspace/`. Both originals are now thin re-export facades.

### providers/ (9 files)
- `anthropic.js` — Anthropic SDK helpers (callAnthropicChatWithMeta, fetchAnthropicModels)
- `openai.js` — OpenAI-compatible provider (callOpenAICompatibleChat, responses endpoint, Azure)
- `gemini.js` — Google Gemini chat + model listing
- `bedrock.js` — AWS Bedrock streaming, client singleton, model map
- `byok.js` — BYOK credential routing (callByokProviderChat, resolveProviderForModel)
- `codec.js` — Mesh codec encode/decode, context injection, session state
- `constants.js` — Shared provider constants (STATIC_MODELS, MESH_SYSTEM_PROMPT, etc.)
- `utils.js` — Shared provider utilities (fetchWithTimeout, normalizeMessages, etc.)
- `index.js` — Re-exports all public functions

### workspace/ (6 files)
- `files.js` — File CRUD (read, write, rename, delete, localWorkspaceSelect)
- `search.js` — Workspace search, grep, file finding
- `git.js` — Git operations (status, commit, push, pull, diff, log)
- `batch.js` — Batch file operations
- `utils.js` — Shared workspace utilities
- `index.js` — Re-exports all public functions

## Key files
- `src/core/model-providers.js` — thin facade (`module.exports = require('./providers')`)
- `src/core/workspace-ops.js` — thin facade (`module.exports = require('./workspace')`)
- `src/core/providers/` — 9 files
- `src/core/workspace/` — 6 files

## Decisions
- `utils.js` added to both directories for shared helpers that don't belong to a single provider
- `constants.js` extracted from providers to avoid circular deps between provider files
- `workspace/git.js` is small (47 lines) — git ops are naturally bounded

## Self-Check: PASSED
- `node -e "require('./src/core/model-providers')"` — no throw
- `node -e "require('./src/core/workspace-ops')"` — no throw
- npm test: 3906 pass, 24 fail (all 24 pre-existing GSD framework failures)
- Files mostly under 400 lines; `files.js` at 447 lines due to `localWorkspaceSelect` complexity
