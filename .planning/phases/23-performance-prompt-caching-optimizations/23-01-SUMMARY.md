---
phase: 23
plan: "01"
title: "Anthropic + Bedrock Prompt Caching"
status: complete
date: 2026-04-16
key-files:
  modified:
    - src/core/model-providers.js
---

# Summary: Anthropic + Bedrock Prompt Caching

## What Changed

### 1. Anthropic Prompt Caching
- Added `anthropic-beta: prompt-caching-2024-07-31` header to `callAnthropicChatWithMeta`
- System prompt now uses `cache_control: { type: 'ephemeral' }` blocks, enabling KV-cache reuse across turns within the same conversation

### 2. Bedrock Client Singleton
- `createBedrockClient()` → `getBedrockClient()` — module-level singleton
- Avoids per-request TLS handshake and credential resolution overhead

### 3. maxTokens Fix
- Default changed from 1024 → 4096 across both Anthropic native and Bedrock paths
- Both providers now correctly respect `credentials?.anthropic?.maxTokens`
- Bedrock system prompt uses `cache_control: [{ type: 'default' }]` for prompt caching

## Self-Check: PASSED

- [x] `prompt-caching` header present in Anthropic requests
- [x] `cache_control` blocks on system messages
- [x] BedrockRuntimeClient is module-level singleton
- [x] maxTokens defaults to 4096 with user preference override
