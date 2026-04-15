---
tags: [operations]
---

# Troubleshooting

## Auth Fails / "Authentication service temporarily unavailable"

The healthz probe calls `getUserByEmail` against DynamoDB. If this fails, `authStoreOk` is `false`.

### Causes (in order of likelihood)

1. **`MESH_DYNAMO_ENABLED` not set or `false`** — app falls back to in-memory store, which has no users
2. **Wrong table names** — check `MESH_DYNAMO_TABLE_PREFIX` (default: `mesh` → tables: `mesh-users`, `mesh-sessions`, `mesh-stores`)
3. **AWS credentials missing/invalid** — `AWS_ACCESS_KEY_ID` or `AWS_SECRET_ACCESS_KEY` wrong
4. **Demo user not in DynamoDB** — seed it manually (see below)

### Fix

```bash
# SSH into EC2
ssh -i /path/to/key.pem ec2-user@35.175.88.93

# Check PM2 has env vars
pm2 env 0 | grep -E 'MESH_DYNAMO|AWS_ACCESS'

# Check healthz locally
curl http://localhost:8080/healthz

# Verify DynamoDB tables exist
AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... aws dynamodb list-tables --region us-east-1

# Query demo user
AWS_ACCESS_KEY_ID=... aws dynamodb query \
  --table-name mesh-users \
  --index-name email-index \
  --key-condition-expression "email = :e" \
  --expression-attribute-values '{":e":{"S":"edgar@test.com"}}' \
  --region us-east-1
```

---

## PM2 Process Stopped

```bash
ssh -i /path/to/key.pem ec2-user@35.175.88.93

# Check status
pm2 list

# View error logs
pm2 logs mesh-gateway --err --lines 100

# Restart
pm2 start mesh-gateway
# or
pm2 restart mesh-gateway --update-env
```

---

## Deploy Fails / GitHub Actions Error

1. Check Actions logs: `gh run list --repo dreddi-edit/mesh-komp --limit 5`
2. Verify `EC2_SSH_KEY` secret is still valid
3. Check EC2 instance is running (AWS console or attempt SSH)
4. If rsync fails: check EC2 disk space (`df -h /`)

---

## Upload Workspace Hangs / Files Don't Appear

With S3 offload disabled (default), all workspace data flows through the gateway directly.

### Check

1. Is the gateway running? `pm2 list`
2. Are there errors? `pm2 logs mesh-gateway --err --lines 50`
3. Is the worker reachable? `curl http://localhost:8080/mesh/tunnel` (should 400, not timeout)

---

## Graph Shows Empty / "No Data"

This is a known reliability concern.

### Possible Causes

1. Frontend built a synthetic `workspaceId` (from `dirName + userId`) that doesn't match worker's canonical ID
2. Worker graph path read from metadata store and found no data for that ID
3. Indexing still in progress
4. Workspace genuinely has no importable dependencies

### Check

Compare the `workspaceId` the frontend sends to `/api/assistant/workspace/graph` against what the worker has in its `workspaceState`. If they differ, the graph will return empty.

### Workaround

Re-open the workspace folder (triggers a fresh select with the correct ID).

---

## Voice Session Fails to Connect

### Check

1. Are AWS credentials loaded? `pm2 env 0 | grep AWS_ACCESS`
2. Is mic permission granted in the browser?
3. Check browser console for WebSocket errors to `/api/realtime`
4. Check PM2 logs for Transcribe or Polly errors

---

## 503 After Deploy

Normal. PM2 takes ~3–5 seconds to restart and bind the port.

Wait and retry. Only escalate if 503 persists beyond 30 seconds.

---

## Emergency Recovery Checklist

1. SSH into EC2: `ssh -i /path/to/key.pem ec2-user@35.175.88.93`
2. Check PM2: `pm2 list` — if stopped, `pm2 restart mesh-gateway --update-env`
3. Check env file: `cat /home/ec2-user/app/.env | grep MESH_DYNAMO`
4. Check healthz: `curl http://localhost:8080/healthz`
5. Check DynamoDB: `aws dynamodb list-tables --region us-east-1`
6. Check logs: `pm2 logs mesh-gateway --err --lines 100`
