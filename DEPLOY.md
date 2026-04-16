# Try-Mesh Deployment Runbook

This document is the canonical deployment procedure for `try-mesh.com`.

Two deployment methods are available:

| Method | When to use |
|--------|-------------|
| **GitHub Actions (automatic)** | Every normal code push to `main` |
| **Manual rsync + SSH** | Emergency redeploys, rollback, or when Actions is unavailable |

---

## Critical Facts (Read First)

1. User API keys are stored in encrypted DynamoDB (`secure-db.js`) — data survives deploys automatically.
2. Encryption key must stay stable:
   - `MESH_DATA_ENCRYPTION_KEY` must exist and must **not** be rotated casually.
3. Env file lives at `/home/ec2-user/app/.env` on the EC2 instance.
4. PM2 loads the env file via `--env-file /home/ec2-user/app/.env`.

## Production Targets

- Gateway: EC2 t2.micro, `50.16.15.217` (us-east-1)
- PM2 process: `mesh-gateway`
- Domain: `try-mesh.com` (Cloudflare → EC2)
- GitHub repo: `dreddi-edit/mesh-komp`
- SSH key: stored in GitHub secret `EC2_SSH_KEY`

---

## Method 1 — GitHub Actions (Automatic)

Workflow file: `.github/workflows/deploy.yml`

**Triggers automatically on every push to `main`.** No manual steps required.

### What the workflow does

1. Checks out the repo
2. Installs dependencies (`npm ci --ignore-scripts`)
3. Runs tests (`npm test`)
4. Rsyncs code to EC2 (excludes `node_modules`, `.git`, `.env`, images)
5. SSHs into EC2: `npm ci && pm2 restart mesh-gateway --update-env`
6. Smoke-checks `/healthz` — must return `"service"` in the response

### Monitor a deployment

```bash
gh run list --repo dreddi-edit/mesh-komp --limit 5
gh run watch --repo dreddi-edit/mesh-komp
```

Or: `https://github.com/dreddi-edit/mesh-komp/actions`

---

## Method 2 — Manual Deploy

Use this for emergency redeploys or rollback.

### 1) Preflight

From repo root:

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

### 2) Rsync code to EC2

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

### 3) Restart

```bash
ssh -i /path/to/key.pem ec2-user@50.16.15.217 "
  cd /home/ec2-user/app
  npm ci --ignore-scripts
  pm2 restart mesh-gateway --update-env
  pm2 save
"
```

---

## Post-Deploy Smoke Checks

### Health check

```bash
curl -sf https://try-mesh.com/healthz
# Expected: {"ok":true,"service":"mesh-gateway","authStoreOk":true,...}
```

### Auth + session check

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
        resolve({status:res.statusCode, headers:res.headers, json:j, data:d});
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

---

## PM2 Management

```bash
# SSH into server
ssh -i /path/to/key.pem ec2-user@50.16.15.217

# View process status
pm2 list

# View logs
pm2 logs mesh-gateway --lines 50

# Restart
pm2 restart mesh-gateway --update-env

# Check env vars are loaded
pm2 env 0 | grep MESH_DYNAMO
```

---

## Why Keys Don't Disappear

DynamoDB is a managed service — user data is durable by default. Unlike the previous SQLite-on-disk approach, there is no risk of data loss from redeploys. The EC2 instance being replaced is the only scenario requiring a data migration (export DynamoDB tables first).

## Emergency Recovery Checklist

1. Check PM2 status: `pm2 list` — if `stopped`, restart with `pm2 start mesh-gateway`
2. Check env file: `cat /home/ec2-user/app/.env` — verify `MESH_DYNAMO_ENABLED=true` and AWS credentials are present
3. Check DynamoDB: `aws dynamodb list-tables` — verify `mesh-users`, `mesh-sessions`, `mesh-stores` exist
4. Check healthz: `curl http://localhost:8080/healthz` — `authStoreOk` must be `true`
5. Check PM2 logs: `pm2 logs mesh-gateway --err --lines 100`

---

## Recommended Deploy Routine (Short Form)

### Normal code push
Push to `main` — GitHub Actions handles it automatically. Monitor via `gh run watch`.

### Emergency manual deploy
1. Preflight syntax checks.
2. Rsync code.
3. SSH restart PM2.
4. Smoke check healthz.
