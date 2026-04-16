---
tags: [operations]
---

# Deploy Runbook

> Canonical deployment procedure for `try-mesh.com`. Use for every production deploy.

## Goals

- Deploy with rsync — no zip artifacts, no App Service quirks
- Keep encrypted user data persistent (DynamoDB survives deploys automatically)
- Catch failures early via preflight + smoke checks

## Production Target

| Resource | Details |
|----------|---------|
| EC2 Instance | `50.16.15.217` (us-east-1, t2.micro) |
| SSH user | `ec2-user` |
| App path | `/home/ec2-user/app/` |
| PM2 process | `mesh-gateway` |
| Env file | `/home/ec2-user/app/.env` |

## Critical Pre-Deploy Facts

1. User API keys are in encrypted DynamoDB (`secure-db.js`) — they survive deploys automatically
2. Encryption key `MESH_DATA_ENCRYPTION_KEY` must never be rotated
3. Never overwrite `/home/ec2-user/app/.env` — it contains production secrets
4. The rsync excludes `.env` automatically

## Method 1: GitHub Actions (Automatic)

Workflow: `.github/workflows/deploy.yml`

Triggers on every push to `main`. Does:
1. `npm ci --ignore-scripts`
2. `npm test`
3. Rsync to EC2 (excludes `.env`, `node_modules`, images)
4. SSH: `npm ci && pm2 restart mesh-gateway --update-env && pm2 save`
5. Smoke check: `curl -sf http://localhost:8080/healthz | grep '"service"'`

Monitor:
```bash
gh run list --repo dreddi-edit/mesh-komp --limit 5
gh run watch --repo dreddi-edit/mesh-komp
```

## Method 2: Manual Deploy

### Step 1: Preflight Syntax Checks

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

### Step 2: Rsync to EC2

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
  /Users/edgarbaumann/Downloads/mesh-komp/ \
  ec2-user@50.16.15.217:/home/ec2-user/app/
```

### Step 3: Restart

```bash
ssh -i /path/to/key.pem ec2-user@50.16.15.217 "
  set -e
  cd /home/ec2-user/app
  npm ci --ignore-scripts
  pm2 restart mesh-gateway --update-env
  pm2 save
"
```

## Step 4: Post-Deploy Smoke Checks

### 4.1 Health Check

```bash
curl -sf https://try-mesh.com/healthz
# Expected: {"ok":true,"service":"mesh-gateway","authStoreOk":true,...}
```

### 4.2 Auth + Session + Assistant Status

```bash
node - <<'NODE'
const https = require('https');
function req(method, path, payload, cookie='') {
  const body = payload ? JSON.stringify(payload) : '';
  return new Promise((resolve, reject) => {
    const r = https.request({
      hostname: 'try-mesh.com', method, path,
      headers: {
        ...(payload ? {'content-type':'application/json','content-length':Buffer.byteLength(body)} : {}),
        ...(cookie ? {cookie} : {}),
      }
    }, res => {
      let d='';
      res.on('data', c => d += c);
      res.on('end', () => {
        let j=null; try { j=JSON.parse(d); } catch {}
        resolve({status:res.statusCode, headers:res.headers, json:j});
      });
    });
    r.on('error', reject);
    if (payload) r.write(body);
    r.end();
  });
}
(async () => {
  const login = await req('POST','/api/auth/login',{email:'edgar@test.com',password:'12345'});
  const cookie = String((login.headers['set-cookie']||[''])[0]).split(';')[0];
  const session = await req('GET','/api/auth/session',null,cookie);
  const status = await req('GET','/api/assistant/status',null,cookie);
  console.log(JSON.stringify({
    loginStatus: login.status,
    sessionStatus: session.status,
    assistantStatus: status.status,
    assistantMode: status.json?.mode || null,
  }, null, 2));
})();
NODE
```

Expected: `loginStatus: 200`, `sessionStatus: 200`, `assistantStatus: 200`.

## Short-Form Checklist

- [ ] Preflight syntax checks
- [ ] Rsync (or push to `main` for GitHub Actions)
- [ ] `pm2 restart mesh-gateway --update-env`
- [ ] Smoke check: `curl https://try-mesh.com/healthz`
- [ ] Auth check: login/session/status all 200
