---
tags: [data]
---

# S3 Storage

Bucket: `mesh-workspace-offload-960583973825`
Region: `us-east-1`

## Role

S3 is an **optional** workspace offload backend. It is disabled by default (`MESH_S3_OFFLOAD_ENABLED=false`).

When enabled, it replaces in-memory/disk-only workspace chunk storage for large uploaded workspaces:
- Browser uploads workspace chunks → S3
- Gateway downloads from S3 for ingest processing

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MESH_S3_OFFLOAD_ENABLED` | `false` | Enable S3 offload |
| `MESH_S3_BUCKET` | — | S3 bucket name |
| `MESH_S3_PREFIX` | — | Key prefix within the bucket |
| `MESH_S3_OFFLOAD_MAX_CHUNK_FILES` | `900` | Max files per chunk |
| `MESH_S3_OFFLOAD_MAX_CHUNK_BYTES` | `60000000` | Max bytes per chunk |
| `MESH_S3_OFFLOAD_MAX_PARALLEL_READS` | `64` | Max parallel S3 reads |
| `MESH_S3_OFFLOAD_MAX_INFLIGHT_CHUNKS` | `4` | Max in-flight chunk operations |

S3 access uses the same IAM credentials as Bedrock (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).

## Implementation

`src/core/workspace-infrastructure.js` uses the AWS SDK v3:
- `PutObjectCommand` — upload chunk
- `GetObjectCommand` — download chunk for ingest
- `CopyObjectCommand` — copy object (rename operations)
- `DeleteObjectCommand` — delete chunk

## When to Enable

Enable S3 offload when:
- Workspace uploads exceed available EC2 instance memory/disk
- You want durable workspace storage that survives instance restarts
- Multiple gateway instances need shared workspace access

For a single EC2 t2.micro serving one user, S3 offload is not needed.
