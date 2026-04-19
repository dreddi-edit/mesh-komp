# Structure

## Directory Layout

```
mesh-komp/
├── src/                          # Gateway application source
│   ├── server.js                 # Express app entry point (240 lines)
│   ├── logger.js                 # Structured JSON logger (45 lines)
│   ├── config/
│   │   ├── index.js              # Centralized config + validation (196 lines)
│   │   └── env-utils.js          # Env parsing helpers (93 lines)
│   ├── core/
│   │   ├── index.js              # Wiring hub — imports everything, exports facade (1,200 lines)
│   │   ├── auth.js               # Auth/session/credential layer (582 lines)
│   │   ├── model-providers.js    # AI provider calls + codec (1,663 lines)
│   │   ├── workspace-ops.js      # Workspace CRUD, search, grep (1,723 lines)
│   │   ├── workspace-infrastructure.js  # Path safety, metadata, S3, git (1,191 lines)
│   │   ├── workspace-context.js  # File caching, terminal sessions (1,146 lines)
│   │   ├── assistant-runs.js     # Run lifecycle, proposals, batches (1,130 lines)
│   │   ├── voice-agent.js        # Voice agent + tool loop (851 lines)
│   │   ├── voice-aws-audio.js    # Transcribe + Polly wrappers (257 lines)
│   │   └── deployments.js        # Deploy queue + policies (210 lines)
│   ├── routes/
│   │   ├── auth.routes.js        # Login/logout/register/session (253 lines)
│   │   ├── app.routes.js         # Docs browsing, operations API (604 lines)
│   │   ├── assistant.routes.js   # Composer: mounts sub-routers (214 lines)
│   │   ├── assistant-workspace.routes.js  # Workspace REST (478 lines)
│   │   ├── assistant-chat.routes.js       # Chat + SSE streaming (768 lines)
│   │   ├── assistant-git.routes.js        # Git operations (332 lines)
│   │   ├── realtime.routes.js    # Voice WebSocket handler (573 lines)
│   │   ├── terminal.routes.js    # Terminal WebSocket handler (307 lines)
│   │   └── route-utils.js        # Error response helper (22 lines)
│   ├── middleware/
│   │   ├── compression.js        # Brotli/gzip/deflate (139 lines)
│   │   ├── rate-limiter.js       # IP-based rate limiting (103 lines)
│   │   └── validate.js           # Schema validation middleware (34 lines)
│   ├── schemas/
│   │   └── index.js              # Vanilla JS validation schemas (68 lines)
│   ├── services/                 # Empty — not yet used
│   └── utils/                    # Empty — not yet used
│
├── mesh-core/                    # Compression engine + mesh worker
│   └── src/
│       ├── compression-core.cjs  # Brotli + capsule pipeline (2,568 lines)
│       ├── workspace-operations.js  # Worker workspace ops (2,326 lines)
│       ├── workspace-helpers.js  # Worker utilities (875 lines)
│       ├── tree-sitter-worker.cjs   # AST code analysis (574 lines)
│       ├── server.js             # Mesh-core HTTP server (324 lines)
│       └── (4 smaller files)
│
├── mesh-functions/               # Serverless functions (unused/future)
│
├── views/                        # HTML pages (16 files, ~9,360 lines)
│   ├── index.html                # Landing page (2,067 lines)
│   ├── app.html                  # Main IDE view (679 lines)
│   ├── terminal.html             # Terminal view (827 lines)
│   ├── settings*.html            # Settings pages (6 files)
│   ├── statistics.html           # Usage stats (714 lines)
│   ├── docs.html                 # Documentation browser (409 lines)
│   └── (more views)
│
├── assets/                       # Client-side JS/CSS
│   ├── app.js                    # Main app logic (871 lines)
│   ├── app-workspace.js          # Workspace UI logic (1,957 lines)
│   ├── app-graph.js              # Dependency graph viz (851 lines)
│   ├── settings.js               # Settings page logic (1,276 lines)
│   ├── mesh-client.js            # API client (75 lines)
│   ├── *.css                     # Stylesheets (4 files, ~1,837 lines)
│   ├── animations/               # UI animation assets
│   ├── brand/                    # Brand assets (logos, etc.)
│   └── features/                 # Feature showcase assets
│
├── test/                         # Test files (13 files, 2,665 lines)
├── infra/                        # CloudFormation + deploy scripts
├── benchmarks/                   # Compression benchmarks
├── docs/                         # Documentation
├── pitch/                        # Marketing / pitch materials
├── mesh-vault/                   # Obsidian knowledge base
│
├── secure-db.js                  # DynamoDB + SQLite encrypted storage (521 lines)
├── workspace-metadata-store.cjs  # DynamoDB workspace metadata (519 lines)
├── assistant-core.js             # Shared assistant utilities (806 lines)
├── llm-compress.js               # LLM context compression (499 lines)
├── ecosystem.config.js           # PM2 process config (71 lines)
├── server.js                     # Legacy dev entry point (delegates to src/)
└── package.json
```

## Key Locations

| What | Where |
|------|-------|
| App entry point | `src/server.js` |
| All config/env vars | `src/config/index.js` |
| Auth & sessions | `src/core/auth.js` |
| AI model routing | `src/core/model-providers.js` |
| Workspace file operations | `src/core/workspace-ops.js` |
| Path sanitization | `src/core/workspace-infrastructure.js:126-131` |
| Encrypted storage | `secure-db.js` |
| CloudFormation | `infra/cloudformation.yml` |
| Tests | `test/*.test.js` |
| Frontend views | `views/*.html` |
| Frontend JS | `assets/*.js` |
| Frontend CSS | `assets/*.css` |

## Naming Conventions

- **Files**: kebab-case (`voice-aws-audio.js`, `rate-limiter.js`)
- **Modules**: CommonJS (`require`/`module.exports`) — no ESM
- **Routes**: `{domain}.routes.js` pattern (`auth.routes.js`, `terminal.routes.js`)
- **Core modules**: domain name (`auth.js`, `deployments.js`, `model-providers.js`)
- **CJS extension**: `.cjs` for files that must be CommonJS in mixed environments
- **`'use strict'`**: present in all src/ files
