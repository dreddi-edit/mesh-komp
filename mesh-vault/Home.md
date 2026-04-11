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
- [[Architecture/Azure Architecture]] — Blob, Cosmos, Functions, Web Apps
- [[Architecture/Compression Pipeline]] — tree-sitter, capsule tiers, focused capsules
- [[Architecture/Workspace Model]] — local-path vs upload, indexing phases
- [[Architecture/Voice System]] — Azure STT/TTS pipeline, voice agent tools
- [[Architecture/Authentication]] — sessions, secure-db, BYOK

### Frontend
- [[Frontend/App Shell]] — app.html, app-workspace.js, surface switcher
- [[Frontend/Feature Modules]] — all assets/features/* modules
- [[Frontend/Settings SPA]] — hash-based SPA, user-store keys
- [[Frontend/Views Reference]] — all HTML surfaces and their purpose

### Backend
- [[Backend/Server and Routes]] — Express setup, route modules
- [[Backend/Core Orchestrator]] — src/core/index.js and extracted submodules
- [[Backend/Worker (mesh-core)]] — mesh-core internals, tunnel actions
- [[Backend/Azure Functions]] — blob-triggered fan-out indexer

### Operations
- [[Operations/Deploy Runbook]] — step-by-step production deploy procedure
- [[Operations/Environment Variables]] — all required env vars by component
- [[Operations/Troubleshooting]] — known failure modes and fixes

### Development
- [[Development/Scripts and Commands]] — npm scripts, how to run things
- [[Development/ccmon Dashboard]] — Claude Code monitoring tool
- [[Development/Testing]] — test files and structure

### Data
- [[Data/Cosmos Data Model]] — workspace_files, workspace_workspaces containers
- [[Data/Blob Storage]] — naming schema, SAS token types

## Stack at a Glance

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS, Monaco, xterm.js, D3, Lottie |
| Backend | Node.js, Express 5, SQLite (secure-db) |
| Cloud | Azure Web Apps, Blob Storage, Cosmos DB, Functions |
| AI | Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI (voice) |
| Compression | Tree-sitter AST, capsule serialization, tiered tiers |

## Production Targets

| App | Azure Name |
|-----|-----------|
| Gateway | `mesh-gateway-303137` |
| Worker | `mesh-worker-303137` |
| Functions | `mesh-capsule-fanout-303137` |
| Resource Group | `mesh-rg` |

