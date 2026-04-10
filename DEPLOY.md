# Try-Mesh Deployment Runbook

This document is the canonical deployment procedure for `try-mesh.com`.

Two deployment methods are available:

| Method | When to use |
|--------|-------------|
| **GitHub Actions (automatic)** | Every normal code push to `main` |
| **Manual Azure CLI** | Worker-only deploys, emergency redeploys, rollback, or when Actions is unavailable |

---

## Critical Facts (Read First)

1. User API keys are stored in encrypted SQLite (`secure-db.js`) and must survive deploys.
2. The DB file must be on persistent storage:
   - `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`
3. Encryption key must stay stable:
   - `MESH_DATA_ENCRYPTION_KEY` must exist and must **not** be rotated casually.
4. Do not rely on shipping `.mesh-secure.db` inside zip artifacts.
5. Manual deploys: prefer `--clean false`.

## Production Targets

- Gateway app: `mesh-gateway-303137`
- Worker app: `mesh-worker-303137`
- Resource group: `mesh-rg`
- GitHub repo: `dreddi-edit/mesh-komp`

---

## Method 1 — GitHub Actions (Automatic, Gateway Only)

Workflow file: `.github/workflows/azure-deploy.yml`

**Triggers automatically on every push to `main`.** No manual steps required after the initial setup below.

### What the workflow does

1. Checks out the repo
2. Creates a zip excluding `node_modules`, `.git`, `archive`, `output`, and log files
3. Deploys the zip to `mesh-gateway-303137` via the publish profile

### Prerequisites (one-time setup)

The GitHub secret `AZURE_WEBAPP_PUBLISH_PROFILE` must exist in the repo:

```bash
# Fetch publish profile from Azure and set as GitHub secret in one step
az webapp deployment list-publishing-profiles \
  --name mesh-gateway-303137 \
  --resource-group mesh-rg \
  --xml | gh secret set AZURE_WEBAPP_PUBLISH_PROFILE \
  --repo dreddi-edit/mesh-komp --body "$(cat)"
```

Verify:

```bash
gh secret list --repo dreddi-edit/mesh-komp
# Expected: AZURE_WEBAPP_PUBLISH_PROFILE  <timestamp>
```

### Monitor a deployment

```bash
gh run list --repo dreddi-edit/mesh-komp --limit 5
gh run watch --repo dreddi-edit/mesh-komp
```

Or: `https://github.com/dreddi-edit/mesh-komp/actions`

### Re-trigger without a code change

```bash
gh workflow run azure-deploy.yml --repo dreddi-edit/mesh-komp --ref main
```

### Limitations

- **Gateway only** — the worker is not deployed by this workflow.
- If worker code changed (`mesh-core/src/*`), use Method 2 to deploy the worker separately.

---

## Method 2 — Manual Azure CLI

Use this for:
- Worker deploys (Actions does not cover the worker)
- Emergency redeploys or rollbacks
- Situations where GitHub Actions is unavailable

### 0) One-Time App Settings Baseline

Run once, then verify on every deploy.

```bash
az webapp config appsettings set -g mesh-rg -n mesh-gateway-303137 --settings \
  MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db
```

Verify required settings exist:

```bash
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='MESH_SECURE_DB_FILE' || name=='MESH_DATA_ENCRYPTION_KEY' || name=='SCM_DO_BUILD_DURING_DEPLOYMENT' || name=='ENABLE_ORYX_BUILD'].name" -o tsv
```

Verify DB path value:

```bash
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='MESH_SECURE_DB_FILE'].{name:name,value:value}" -o table
```

Expected DB path:

- `MESH_SECURE_DB_FILE  /home/data/mesh-secure-v2.db`

Voice settings for the rebuilt `transcribe -> text-agent -> tts` voice agent:

```bash
az webapp config appsettings set -g mesh-rg -n mesh-gateway-303137 --settings \
  AZURE_OPENAI_VOICE_ENDPOINT=https://edgar-mnpv2n5b-eastus2.openai.azure.com/ \
  AZURE_OPENAI_VOICE_KEY='<secret>' \
  AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT=gpt-4o-mini-transcribe \
  AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT=gpt-5.4-nano \
  AZURE_OPENAI_VOICE_TTS_DEPLOYMENT=gpt-4o-mini-tts \
  AZURE_OPENAI_VOICE_AUDIO_API_VERSION=2025-04-01-preview \
  AZURE_OPENAI_VOICE_CHAT_API_VERSION=2025-04-01-preview \
  AZURE_OPENAI_VOICE_TTS_VOICE=alloy
```

Recommended verification:

```bash
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='AZURE_OPENAI_VOICE_ENDPOINT' || name=='AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT' || name=='AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT' || name=='AZURE_OPENAI_VOICE_TTS_DEPLOYMENT' || name=='AZURE_OPENAI_VOICE_AUDIO_API_VERSION' || name=='AZURE_OPENAI_VOICE_CHAT_API_VERSION' || name=='AZURE_OPENAI_VOICE_TTS_VOICE'].{name:name,value:value}" -o table
```

### 1) Preflight

From repo root (`mesh-komp`):

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

### 2) Full Zip Deploy (Gateway)

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
rm -f /tmp/mesh-gateway-deploy.zip
zip -rq -0 /tmp/mesh-gateway-deploy.zip . \
  -x "node_modules/*" "mesh-core/node_modules/*" ".mesh*" "*.DS_Store" \
     "old/*" "xray-terminal-demo/*" "Animationen/*" "Logos/*" "*.log"

az webapp deploy -g mesh-rg -n mesh-gateway-303137 \
  --src-path /tmp/mesh-gateway-deploy.zip \
  --type zip \
  --clean false \
  --restart true \
  --track-status false
```

### 3) Full Zip Deploy (Worker)

Deploy worker when worker code changed (`mesh-core/src/server.js`, `mesh-core/src/compression-core.cjs`, etc.).

Important: worker startup command is `node mesh-core/src/server.js`, so artifact layout must preserve repository root + `mesh-core/` path.

```bash
cd /Users/edgarbaumann/Downloads/mesh-komp
rm -f /tmp/mesh-worker-deploy.zip
zip -rq -0 /tmp/mesh-worker-deploy.zip . \
  -x "node_modules/*" "mesh-core/node_modules/*" ".mesh*" "*.DS_Store" \
     "old/*" "xray-terminal-demo/*" "Animationen/*" "Logos/*" "*.log"

az webapp deploy -g mesh-rg -n mesh-worker-303137 \
  --src-path /tmp/mesh-worker-deploy.zip \
  --type zip \
  --clean false \
  --restart true \
  --track-status false
```

Startup command reference check:

```bash
az webapp config show -g mesh-rg -n mesh-worker-303137 \
  --query "appCommandLine" -o tsv
```

---

## Post-Deploy Smoke Checks

Run after either deployment method.

### Health + Auth + Assistant Status

```bash
curl -I https://try-mesh.com/
```

Then run a scripted smoke check (login/session/status):

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

If the site briefly returns `503` right after deploy, wait for App Service warmup to finish and retry before assuming startup failed.

---

## DB Persistence Verification (Mandatory After Manual Deploys)

For GitHub Actions deploys this is less critical since no `--clean` flag is involved, but run it after any manual deploy or if user data concerns arise.

### Write marker

```bash
node - <<'NODE'
const https = require('https');
function req(method,path,payload,cookie=''){const body=payload?JSON.stringify(payload):'';return new Promise((resolve,reject)=>{const r=https.request({hostname:'try-mesh.com',method,path,headers:{...(payload?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}),...(cookie?{cookie}:{})}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{let j=null;try{j=JSON.parse(d)}catch{}resolve({status:res.statusCode,json:j,headers:res.headers});});});r.on('error',reject);if(payload)r.write(body);r.end();});}
(async()=>{
  const marker=`persist-marker-${Date.now()}`;
  const login=await req('POST','/api/auth/login',{email:'edgar@test.com',password:'12345'});
  const cookie=String((login.headers['set-cookie']||[''])[0]).split(';')[0];
  await req('PUT','/api/user/store/meshAppearance',{value:{deployPersistProbe:marker},merge:true},cookie);
  const get=await req('GET','/api/user/store/meshAppearance',null,cookie);
  console.log(JSON.stringify({marker,stored:get.json?.value?.deployPersistProbe||null},null,2));
})();
NODE
```

### Restart app

```bash
az webapp restart -g mesh-rg -n mesh-gateway-303137
```

### Re-read marker

Run same GET check and ensure value still matches marker.

If marker disappears, stop and investigate settings immediately.

---

## Why Keys Disappear (Known Failure Modes)

1. `MESH_SECURE_DB_FILE` missing/misconfigured and DB resolves to non-persistent location.
2. `MESH_DATA_ENCRYPTION_KEY` changed (old encrypted rows become unreadable).
3. Clean deploys plus runtime DB in app root (`/home/site/wwwroot`) cause loss.
4. Deployment happened to wrong app/slot.

## Emergency Recovery Checklist

1. Confirm app settings:
   - `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`
   - `MESH_DATA_ENCRYPTION_KEY` present and unchanged
2. Restart gateway.
3. Run DB persistence marker test.
4. If still failing, inspect runtime filesystem via App Service console/SSH:
   - Check whether `/home/data/mesh-secure.db` exists.
   - If legacy DB exists under app root and `/home/data` DB is missing, copy legacy DB to `/home/data` and restart.

---

## Recommended Deploy Routine (Short Form)

### Normal code push
Push to `main` — GitHub Actions handles it automatically. Monitor via `gh run watch`.

### Worker-only change
Use Method 2, Step 3 only. Gateway Actions deploy is not needed.

### Full manual deploy
1. Preflight syntax checks.
2. Verify app settings (`MESH_SECURE_DB_FILE`, `MESH_DATA_ENCRYPTION_KEY`).
   For voice deploys also verify all `AZURE_OPENAI_VOICE_*` settings.
3. Full zip deploy gateway (`--clean false`).
4. Deploy worker if changed.
5. Smoke checks (auth + status).
6. DB persistence marker test.

If any step fails: stop, fix, redeploy.
