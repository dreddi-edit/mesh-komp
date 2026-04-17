# Mesh Deployment Runbook

Canonical deployment procedure for `try-mesh.com`. Read before every deploy.

---

## Architecture Overview

```
GitHub (main)
  │  push
  ▼
GitHub Actions ─── CI (.github/workflows/ci.yml)
  │                  lint + test + security audit
  │
  ├── Deploy (.github/workflows/deploy.yml)
  │     1. npm ci + npm test
  │     2. rsync → EC2
  │     3. SSH: npm ci + node-pty rebuild + PM2 reload
  │     4. healthcheck curl localhost:8080/healthz
  │     5. (optional) CloudFront cache invalidation
  │
  ▼
EC2 (t2.micro, us-east-1)
  │  PM2 cluster: mesh-gateway
  │  Port 8080
  ▼
CloudFront (E2YB5DP2ZI4FHD)
  │  CDN + HTTPS termination
  ▼
try-mesh.com
```

## Production Targets

| Resource | Value |
|----------|-------|
| EC2 instance | `54.242.44.159` (us-east-1, t2.micro) |
| PM2 process | `mesh-gateway` |
| Domain | `try-mesh.com` |
| CloudFront distribution | `E2YB5DP2ZI4FHD` |
| GitHub repo | `dreddi-edit/mesh-komp` |
| Entry point | `src/server.js` |
| Env file (EC2) | `/home/ec2-user/app/.env` |

---

## GitHub Secrets (Required)

These secrets must be configured in the GitHub repo under **Settings → Secrets and variables → Actions**.

| Secret | Purpose | How to get it |
|--------|---------|---------------|
| `EC2_SSH_KEY` | SSH private key for rsync + PM2 reload | The `.pem` file from AWS EC2 key pair |
| `AWS_ACCESS_KEY_ID` | CloudFront invalidation + S3 error pages | AWS IAM console → Create access key |
| `AWS_SECRET_ACCESS_KEY` | CloudFront invalidation + S3 error pages | AWS IAM console → Create access key |
| `S3_BUCKET` | S3 bucket for CloudFront error pages | (optional) Bucket name, e.g. `mesh-error-pages` |

### How to set GitHub Secrets

1. Go to https://github.com/dreddi-edit/mesh-komp/settings/secrets/actions
2. Click **New repository secret**
3. Enter the name (e.g. `AWS_ACCESS_KEY_ID`) and paste the value
4. Repeat for each secret

### How to create AWS access keys

1. Go to https://console.aws.amazon.com/iam
2. Navigate to **Users → your-user → Security credentials**
3. Click **Create access key** → choose **Third-party service**
4. Copy both `Access key ID` and `Secret access key`
5. Add both as GitHub secrets (see above)

The IAM user needs these permissions:
- `cloudfront:CreateInvalidation` (for cache busting after deploy)
- `s3:PutObject` on the error pages bucket (optional)

### Current status

Check which secrets are configured:

```bash
gh secret list --repo dreddi-edit/mesh-komp
```

**Without AWS credentials:** Deploy still works (EC2 rsync + PM2 reload). Only CloudFront cache invalidation and S3 error page upload are skipped. Users get new assets once the old CloudFront cache expires (default TTL).

**With AWS credentials:** CloudFront cache is invalidated immediately after deploy, so users see changes instantly.

---

## Method 1 — Automatic Deploy (GitHub Actions)

**Triggers on every push to `main`.** No manual steps needed.

### Pipeline steps

1. Checkout + Node 22 setup
2. `npm ci --ignore-scripts` + `npm test`
3. Rsync to EC2 (excludes `node_modules`, `.git`, `.env`, images)
4. SSH into EC2:
   - `npm ci --ignore-scripts`
   - `npm rebuild node-pty --build-from-source`
   - `npm rebuild better-sqlite3 --build-from-source`
   - Verify node-pty loads
   - `pm2 reload ecosystem.config.js --env production`
   - Healthcheck: `curl localhost:8080/healthz`
5. Upload CloudFront error pages to S3 (skipped if `S3_BUCKET` not set)
6. Invalidate CloudFront cache (skipped if AWS credentials not set)

### Deploy workflow

```bash
# Normal deploy: just push to main
git push origin main

# Watch the deploy
gh run watch --repo dreddi-edit/mesh-komp

# Check recent runs
gh run list --repo dreddi-edit/mesh-komp --limit 5

# View failed step logs
gh run view <run-id> --log-failed
```

### Common CI failures

| Failure | Cause | Fix |
|---------|-------|-----|
| Lint error | ESLint `error` (not warning) in changed code | Fix the lint error, push again |
| Test failure | Broken test or new code breaks existing test | Run `npm test` locally, fix, push |
| Rsync failure | EC2 unreachable or SSH key invalid | Check `EC2_SSH_KEY` secret, check EC2 is running |
| node-pty rebuild | Missing build tools on EC2 | SSH in, run `sudo dnf install gcc-c++ make python3` |
| Healthcheck failure | Server crashed on startup | SSH in, check `pm2 logs mesh-gateway --err --lines 50` |
| CloudFront invalidation | AWS credentials missing | Add `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` secrets |

---

## Method 2 — Manual Deploy (Emergency)

Use when GitHub Actions is down or for rollback.

### 1. Preflight

```bash
node --check src/server.js
node --check src/core/index.js
npm test
```

### 2. Rsync to EC2

```bash
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.png' \
  --exclude='*.jpg' \
  --exclude='.playwright-mcp' \
  --exclude='.superpowers' \
  --exclude='docs/benchmark-results' \
  -e "ssh -i /path/to/key.pem" \
  ./ ec2-user@54.242.44.159:/home/ec2-user/app/
```

### 3. Restart on EC2

```bash
ssh -i /path/to/key.pem ec2-user@54.242.44.159 << 'EOF'
  set -e
  cd /home/ec2-user/app
  npm ci --ignore-scripts
  npm rebuild node-pty --build-from-source
  npm rebuild better-sqlite3 --build-from-source
  pm2 reload ecosystem.config.js --env production
  pm2 save
  sleep 3
  curl -sf http://localhost:8080/healthz | grep '"service"'
  echo "Deploy successful"
EOF
```

### 4. (Optional) Invalidate CloudFront

```bash
aws cloudfront create-invalidation \
  --distribution-id E2YB5DP2ZI4FHD \
  --paths "/*"
```

---

## Post-Deploy Checks

### Healthcheck

```bash
curl -sf https://try-mesh.com/healthz | python3 -m json.tool
# Expected: {"ok": true, "service": "mesh-gateway", "authStoreOk": true, ...}
```

### Quick browser check

1. Open https://try-mesh.com/app
2. Welcome screen loads (Open Folder, Clone Repository visible)
3. Open a folder → indexing progresses to 100%
4. Click a file → Monaco editor shows syntax highlighting
5. Open terminal → shows "Local Terminal" or "Remote Terminal"
6. Open Operations view → shows log entries with timestamps

---

## PM2 Management (on EC2)

```bash
ssh -i /path/to/key.pem ec2-user@54.242.44.159

pm2 list                                    # Process status
pm2 logs mesh-gateway --lines 50            # Recent logs
pm2 logs mesh-gateway --err --lines 50      # Error logs only
pm2 reload ecosystem.config.js --env production  # Zero-downtime reload
pm2 restart mesh-gateway --update-env       # Hard restart (brief downtime)
pm2 env 0 | grep MESH_DYNAMO               # Check env vars loaded
```

---

## Rollback

```bash
# Find the last good commit
git log --oneline -10

# Reset to it
git revert HEAD    # or git revert <bad-commit>
git push origin main   # triggers automatic redeploy
```

Never use `git reset --hard` + `git push --force` on main unless absolutely necessary.

---

## Data Safety

- User data is in **DynamoDB** (managed AWS service) — survives all deploys
- `MESH_DATA_ENCRYPTION_KEY` in `.env` must not be rotated without migrating data
- `.env` is excluded from rsync — stays stable on EC2 across deploys
- EC2 instance replacement requires DynamoDB table export first
