---
tags: [home]
---

# Mesh — Knowledge Base

> A coding environment where one imported workspace becomes the shared source of truth for editor, terminal, graph, typed agent, and voice agent — with compressed capsule-based context making multi-file reasoning cheaper and faster.

## What is Mesh?

Mesh is a **browser-based AI-native IDE** and context-compression platform. It runs at [try-mesh.com](https://try-mesh.com).

The product has three top-level surfaces:
- **Editor** — VS Code-inspired workbench with file explorer, Monaco editor, chat panel, dependency graph
- **Terminal** — dedicated full-page terminal tied to the active workspace
- **Voice-Coding** — speech-first agent mode (STT → tool loop → TTS)

## Quick Navigation

### Architecture
- [[Architecture/System Architecture]] — split gateway/worker model, data flow
- [[Architecture/AWS Architecture]] — EC2, DynamoDB, S3, Bedrock, Transcribe, Polly
- [[Architecture/Compression Pipeline]] — tree-sitter, capsule tiers, focused capsules
- [[Architecture/Workspace Model]] — local-path vs upload, indexing phases
- [[Architecture/Voice System]] — AWS Transcribe/Polly pipeline, voice agent tools
- [[Architecture/Authentication]] — sessions, secure-db (DynamoDB), BYOK

### Frontend
- [[Frontend/App Shell]] — app.html, app-workspace.js, surface switcher
- [[Frontend/Feature Modules]] — all assets/features/* modules
- [[Frontend/Settings SPA]] — hash-based SPA, user-store keys
- [[Frontend/Views Reference]] — all HTML surfaces and their purpose

### Backend
- [[Backend/Server and Routes]] — Express setup, route modules
- [[Backend/Core Orchestrator]] — src/core/index.js and extracted submodules
- [[Backend/Worker (mesh-core)]] — mesh-core internals, tunnel actions

### Operations
- [[Operations/Deploy Runbook]] — step-by-step production deploy procedure
- [[Operations/Environment Variables]] — all required env vars by component
- [[Operations/Troubleshooting]] — known failure modes and fixes

### Development
- [[Development/Scripts and Commands]] — npm scripts, how to run things
- [[Development/ccmon Dashboard]] — Claude Code monitoring tool
- [[Development/Testing]] — test files and structure

### Data
- [[Data/DynamoDB Data Model]] — mesh-users, mesh-sessions, mesh-stores tables
- [[Data/S3 Storage]] — workspace offload, naming schema

## Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Monaco, xterm.js, D3, Lottie |
| Backend | Node.js, Express 5, DynamoDB (secure-db) |
| Cloud | AWS EC2 (t2.micro), DynamoDB, S3, Bedrock, Transcribe, Polly |
| AI | Anthropic Claude (via Bedrock), OpenAI GPT, Google Gemini, BYOK |
| Compression | Tree-sitter AST, capsule serialization, tiered tiers |

## Production Infrastructure

| Resource | AWS |
|----------|-----|
| Compute | EC2 t2.micro — `50.16.15.217` (us-east-1) |
| Users/Sessions | DynamoDB `mesh-users`, `mesh-sessions`, `mesh-stores` |
| AI | Bedrock — Claude Sonnet 4.6 via `mesh-bedrock-access` IAM user |
| Voice STT | Amazon Transcribe Streaming |
| Voice TTS | Amazon Polly (neural, voice: Joanna) |
| Workspace offload | S3 `mesh-workspace-offload-960583973825` (optional) |
| DNS | Cloudflare → EC2 |
| CI/CD | GitHub Actions → rsync → PM2 |
