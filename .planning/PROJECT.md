# Mesh. — AI-Native IDE

## Overview
Mesh is a full-stack AI-native IDE and context-compression platform. The frontend is a VS Code-inspired workbench (`views/app.html`) with editor, terminal, voice-coding, chat, and graph surfaces. The backend runs on Express + Azure with tree-sitter compression, assistant orchestration, and voice agent pipelines.

## Stack
- **Frontend:** Vanilla HTML/CSS/JS, Monaco Editor, xterm.js, D3 graph, Lottie animations
- **Backend:** Node.js, Express 5, SQLite (secure-db), Azure Blob/Cosmos
- **AI:** Anthropic Claude, OpenAI GPT, Google Gemini, Azure OpenAI (voice)
- **Compression:** Tree-sitter AST analysis, capsule serialization, tiered compression

## Key Surfaces
- `views/app.html` — Main IDE workbench (v1, production)
- `views/app-v2.html` — Next-gen IDE workbench (v2, in development)
- `views/index.html` — Marketing landing page
- `views/settings.html` — SPA settings hub
- `views/marketplace.html` — Extension marketplace

## Constraint
- `app-v2.html` is the only file being actively edited
- All other files are read-only references
