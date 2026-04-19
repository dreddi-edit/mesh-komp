# Integrations

## AI Model Providers

### Anthropic (Primary)
- **Direct API**: `@anthropic-ai/sdk` — Claude models (Opus 4.6, Sonnet 4.6, Haiku 4.5)
- **AWS Bedrock**: `@aws-sdk/client-bedrock-runtime` — same models via Bedrock proxy
- Config: `ANTHROPIC_API_KEY`, `BEDROCK_PROXY_URL`, `AWS_BEARER_TOKEN_BEDROCK`
- File: `src/core/model-providers.js` (1663 lines) — all provider logic

### OpenAI-Compatible
- Generic OpenAI chat completions endpoint
- Models: gpt-4o-mini, gpt-4o
- Config: `OPENAI_API_KEY`

### Google Gemini
- Gemini 2.0 Flash, Gemini 1.5 Pro
- Config: `GOOGLE_API_KEY`

### BYOK (Bring Your Own Key)
- User-provided API keys stored encrypted in DynamoDB
- Supports OpenRouter and custom providers
- Config per-user via `meshAiByok` / `meshByokModelRegistry` user store keys
- File: `src/core/auth.js:445-474` — BYOK provider normalization

## AWS Services

### DynamoDB (Auth + User Storage)
- Tables: users, sessions, user stores (key-value per user)
- Config: `MESH_DYNAMO_ENABLED`, `MESH_DYNAMO_TABLE_PREFIX`, individual table names
- Client: `secure-db.js` (521 lines) — encrypted at-rest with AES-256-GCM
- All user data (API keys, preferences, credentials) encrypted before storage

### S3 (Workspace Blob Storage)
- Workspace file content offloaded to S3 for large workspaces
- Pre-signed URLs for direct browser upload
- Config: `MESH_S3_OFFLOAD_ENABLED`, `MESH_S3_BUCKET`, `MESH_S3_PREFIX`
- File: `src/core/workspace-infrastructure.js` — blob read/write/copy/delete

### Polly (Text-to-Speech)
- Voice chat TTS output
- Config: `MESH_VOICE_POLLY_VOICE` (default: Joanna), `MESH_VOICE_POLLY_ENGINE` (neural)
- File: `src/core/voice-aws-audio.js` (257 lines)

### Transcribe Streaming (Speech-to-Text)
- Real-time voice transcription via WebSocket
- Config: `MESH_VOICE_TRANSCRIBE_LANGUAGE` (default: en-US)
- File: `src/core/voice-aws-audio.js`

### CloudWatch
- `@aws-sdk/client-cloudwatch` — metrics reporting (imported but usage is minimal)

### CloudFront (CDN)
- Defined in `infra/cloudformation.yml` — fronts both the ALB and S3 bucket
- Custom domain support with ACM certificates

## WebSocket Connections

### Terminal (`/terminal`)
- `ws` + `node-pty` — full PTY shell session per browser connection
- Auth via cookie on WebSocket upgrade
- Env sanitization strips secrets before passing to shell
- File: `src/routes/terminal.routes.js` (307 lines)

### Voice/Realtime (`/api/realtime`)
- Voice chat: browser → PCM audio → Transcribe → Claude → Polly → browser
- Heartbeat/timeout management for session lifecycle
- Max 2 concurrent sessions per user
- File: `src/routes/realtime.routes.js` (573 lines)

## Infrastructure

### CloudFormation (`infra/cloudformation.yml`)
- CloudFront + ALB + Auto Scaling Group + EC2 Launch Template
- Region: us-east-1
- Instance types: t2.micro to t3a.medium
- Amazon Linux 2023, PM2 for process management
- Custom error pages (502, 503, 504) in `infra/error-pages/`

### Deployment
- `infra/deploy-asg.sh` — ASG rolling deployment script
- `.env` file pulled from S3 on instance boot
- Git-based deployment (instances clone repo on first boot)

## External Services

### Open VSX Registry
- Extension marketplace — downloads `.vsix` files from `open-vsx.org`
- File: `src/routes/assistant.routes.js:164-209`
- Uses `fetch()` + `unzip` via `execFile`

## Local Development Fallbacks

- **SQLite** (`better-sqlite3`) — local auth/session storage when DynamoDB disabled
- **In-memory workspace** — no S3 required; files stored in RAM Map
- Demo user auto-created in dev mode (`MESH_DEMO_USER_ENABLED`)
