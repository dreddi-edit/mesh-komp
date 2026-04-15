---
tags: [operations]
---

# Environment Variables

All variables organized by component. Production env file: `/home/ec2-user/app/.env`.

## Gateway (EC2 — `mesh-gateway` PM2 process)

### Core / Runtime

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | **Yes** | `production` in production |
| `PORT` | No | HTTP port. Default: `8080` |
| `MESH_CORE_URL` | No | Worker tunnel URL. Default: `http://localhost:8080/mesh/tunnel` |

### Auth / Encryption

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_DATA_ENCRYPTION_KEY` | **Yes** | AES-256 key for user store encryption. Never rotate — rotating breaks all existing encrypted rows. |
| `MESH_SECURE_DB_FILE` | No | Path to encrypted SQLite for local workspace cache. In production: `/home/ec2-user/data/mesh-secure-v2.db` |

### DynamoDB

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_DYNAMO_ENABLED` | **Yes** | `true` in production |
| `MESH_DYNAMO_TABLE_PREFIX` | No | Table name prefix. Default: `mesh` → creates `mesh-users`, `mesh-sessions`, `mesh-stores` |
| `MESH_DYNAMO_USERS_TABLE` | No | Override users table name |
| `MESH_DYNAMO_SESSIONS_TABLE` | No | Override sessions table name |
| `MESH_DYNAMO_STORES_TABLE` | No | Override stores table name |

### AWS Credentials

| Variable | Required | Description |
|----------|----------|-------------|
| `AWS_ACCESS_KEY_ID` | **Yes** | IAM user `mesh-bedrock-access` key ID |
| `AWS_SECRET_ACCESS_KEY` | **Yes** | IAM user `mesh-bedrock-access` secret |
| `AWS_REGION_BEDROCK` | No | Bedrock region. Default: `us-east-1` |

### AI / Model

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_DEFAULT_MODEL` | No | Default model. Default: `claude-sonnet-4-6` |
| `ANTHROPIC_API_KEY` | No | Direct Anthropic API key (alternative to Bedrock) |
| `OPENAI_API_KEY` | No | OpenAI API key (BYOK) |
| `GOOGLE_API_KEY` | No | Google Gemini API key (BYOK) |

### Voice (Amazon Transcribe + Polly)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESH_VOICE_TRANSCRIBE_LANGUAGE` | No | `en-US` | Transcribe language code |
| `MESH_VOICE_POLLY_VOICE` | No | `Joanna` | Polly voice ID |
| `MESH_VOICE_POLLY_ENGINE` | No | `neural` | Polly engine: `neural` or `standard` |
| `MESH_VOICE_VAD_THRESHOLD` | No | `0.012` | Energy threshold for speech detection |
| `MESH_VOICE_VAD_PREFIX_MS` | No | `240` | Pre-speech buffer (ms) |
| `MESH_VOICE_VAD_SILENCE_MS` | No | `720` | Silence to end utterance (ms) |
| `MESH_VOICE_MIN_UTTERANCE_MS` | No | `280` | Minimum utterance length (ms) |
| `MESH_VOICE_MAX_UTTERANCE_MS` | No | `14000` | Maximum utterance length (ms) |

### S3 Workspace Offload (Optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_S3_OFFLOAD_ENABLED` | No | `true` to enable S3 offload. Default: `false` |
| `MESH_S3_BUCKET` | No | S3 bucket name (`mesh-workspace-offload-960583973825`) |
| `MESH_S3_PREFIX` | No | Key prefix within bucket |
| `MESH_S3_OFFLOAD_MAX_CHUNK_FILES` | No | Max files per chunk. Default: `900` |
| `MESH_S3_OFFLOAD_MAX_CHUNK_BYTES` | No | Max bytes per chunk. Default: `60000000` |
| `MESH_S3_OFFLOAD_MAX_PARALLEL_READS` | No | Parallel reads. Default: `64` |
| `MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS` | No | In-flight chunks. Default: `4` |

### Auth Cookies

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESH_AUTH_COOKIE_NAME` | No | `mesh_auth` | Cookie name |
| `MESH_AUTH_COOKIE_SECURE` | No | `true` in prod | Set `false` for local HTTP dev |
| `MESH_AUTH_COOKIE_SAMESITE` | No | `Strict` | SameSite policy |

### Demo User

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESH_DEMO_USER_EMAIL` | No | `edgar@test.com` | Demo user email |
| `MESH_DEMO_USER_PASSWORD` | No | `12345` | Demo user password |
| `MESH_DEMO_USER_EMAIL_ALIASES` | No | — | Comma-separated additional emails |

### Compression / Workspace Budget

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MESH_WORKSPACE_TOKEN_BUDGET` | No | `8000` | Global token budget distributed across files |
| `MESH_WORKSPACE_INDEX_PARALLELISM` | No | `16` | Parallel indexing workers |
| `MESH_WORKSPACE_SELECT_ASYNC_MODE` | No | `queue` | Async workspace select mode |

### Observability

| Variable | Required | Description |
|----------|----------|-------------|
| `LOG_LEVEL` | No | Structured logger verbosity: `debug | info | warn | error`. Default: `info`. JSON to stdout/stderr. |

### Terminal

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_TERMINAL_UPLOAD_ROOT` | No | Root dir for materializing upload workspaces for terminal |

## Verify Commands (from EC2)

```bash
# SSH in
ssh -i /path/to/key.pem ec2-user@35.175.88.93

# Check env vars are loaded in PM2
pm2 env 0 | grep -E 'MESH_DYNAMO|NODE_ENV|MESH_DEFAULT'

# Check DynamoDB connectivity
aws dynamodb list-tables --region us-east-1

# Check healthz
curl http://localhost:8080/healthz
```
