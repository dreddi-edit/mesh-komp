---
tags: [architecture]
---

# AWS Architecture

> Last updated: 2026-04-15
> Migrated from Azure on 2026-04-15.

## Infrastructure Overview

```
Browser
  │
  ▼
EC2 t2.micro (us-east-1)
Gateway + Worker (same process via MESH_CORE_URL)
  │
  ├─► AWS Bedrock (Claude Sonnet 4.6) — AI chat
  │
  ├─► Amazon Transcribe Streaming — voice STT
  │
  ├─► Amazon Polly — voice TTS
  │
  ├─► DynamoDB — users, sessions, user store
  │     mesh-users (PK: id, GSI: email-index)
  │     mesh-sessions (PK: id, GSI: userId-index)
  │     mesh-stores (PK: id, GSI: userId-index)
  │
  └─► S3 — workspace offload (optional, disabled by default)
        mesh-workspace-offload-960583973825
```

## Live Resources

| Resource | Details |
|----------|---------|
| EC2 Instance | t2.micro, us-east-1, `35.175.88.93` |
| DynamoDB | `mesh-users`, `mesh-sessions`, `mesh-stores` (us-east-1) |
| S3 Bucket | `mesh-workspace-offload-960583973825` |
| IAM User | `mesh-bedrock-access` — Bedrock + DynamoDB + Transcribe + Polly |
| DNS | Cloudflare → EC2 (A record: `try-mesh.com` → `35.175.88.93`) |

## Component Roles

### EC2 Gateway
- Serves `app.html` and static assets
- Handles login/session/auth via DynamoDB
- Exposes all `/api/*` endpoints
- Proxies workspace requests to Worker via `MESH_CORE_URL`
- Falls back to inline logic if Worker is unavailable
- Managed by PM2 (`mesh-gateway` process)
- Env file: `/home/ec2-user/app/.env`

### DynamoDB
- `mesh-users` — user accounts (PK: `id`, GSI: `email-index` on `email`)
- `mesh-sessions` — auth sessions with native TTL (PK: `id`, GSI: `userId-index`)
- `mesh-stores` — per-user encrypted key-value store (PK: `id`, GSI: `userId-index`)

All tables use DynamoDB native TTL on the `ttl` attribute (epoch seconds).

### AWS Bedrock
- Default model: `claude-sonnet-4-6` (via cross-region inference profile)
- Region: `us-east-1`
- Auth: IAM user `mesh-bedrock-access` with `AmazonBedrockFullAccess`

### Amazon Transcribe + Polly (Voice)
- STT: Amazon Transcribe Streaming — language `en-US` (configurable)
- TTS: Amazon Polly — voice `Joanna`, engine `neural` (configurable)
- Same IAM user and credentials as Bedrock

### S3 (Optional Workspace Offload)
- Disabled by default (`MESH_S3_OFFLOAD_ENABLED=false`)
- When enabled: browser uploads workspace chunks → S3 → gateway ingests
- Bucket: `mesh-workspace-offload-960583973825`

## CI/CD

GitHub Actions workflow (`.github/workflows/deploy.yml`):
1. `npm ci --ignore-scripts`
2. `npm test`
3. Rsync to EC2 via `burnett01/rsync-deployments`
4. SSH: `npm ci && pm2 restart mesh-gateway --update-env && pm2 save`
5. Smoke check: `curl -sf http://localhost:8080/healthz | grep '"service"'`

Secret required: `EC2_SSH_KEY` (RSA private key for `ec2-user@35.175.88.93`)

## Environment Variables

See [[Operations/Environment Variables]] for the full list.

## Free Tier Status (as of 2026-04)

| Service | Free Tier |
|---------|-----------|
| EC2 t2.micro | 750 hrs/month for 12 months |
| DynamoDB | 25 GB storage + 25 WCU/RCU always free |
| S3 | 5 GB storage + 20K GET + 2K PUT always free |
| Bedrock | Pay per token (no free tier) |
| Transcribe | 60 min/month free for 12 months |
| Polly | 5M characters/month free for 12 months |
