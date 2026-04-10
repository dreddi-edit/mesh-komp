# Try-Mesh Deployment Runbook

This document is the canonical deployment procedure for `try-mesh.com`.

Use this runbook for **every production deploy**.

## Goals

- Deploy latest workspace code with one full zip artifact.
- Keep encrypted user data (API keys, preferences) persistent across deploys.
- Catch failures early via preflight + post-deploy smoke checks.

## Critical Facts (Read First)

1. User API keys are stored in encrypted SQLite (`secure-db.js`) and must survive deploys.
2. The DB file must be on persistent storage:
   - `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`
3. Encryption key must stay stable:
   - `MESH_DATA_ENCRYPTION_KEY` must exist and must **not** be rotated casually.
4. Do not rely on shipping `.mesh-secure.db` inside zip artifacts.
5. Prefer `--clean false` for normal deploys.

## Production Targets

- Gateway app: `mesh-gateway-303137`
- Worker app: `mesh-worker-303137`
- Resource group: `mesh-rg`

## 0) One-Time App Settings Baseline

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

## 1) Preflight (Before Any Deploy)

From repo root (`mesh-komp`):

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

Optional (editor diagnostics): ensure no errors in changed files.

## 2) Full Zip Deploy (Gateway)

This is the canonical **single full zip deploy** command:

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

Notes:

- `--clean false` reduces risk of removing runtime artifacts and is faster.
- Excluding `.mesh*` is fine because DB lives in `/home/data`.

## 3) Full Zip Deploy (Worker)

Deploy worker when worker code changed (`mesh-core/src/server.js`, `mesh-core/src/compression-core.cjs`, etc.).

Important: worker startup command is currently `node mesh-core/src/server.js`, so artifact layout must preserve repository root + `mesh-core/` path.

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

If startup command changes in the future (for example to `node src/server.js`), update packaging layout accordingly.

## 4) Post-Deploy Smoke Checks

### 4.1 Health + Auth + Assistant Status

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

### 4.2 Assistant Chat Smoke

Chat requires provider keys in user settings (Anthropic/OpenAI/etc.).
If key is missing, expected 400 with explicit error message.

## 5) DB Persistence Verification (Mandatory)

This confirms user API keys/preferences survive restart/deploy.

### 5.1 Write marker

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

### 5.2 Restart app

```bash
az webapp restart -g mesh-rg -n mesh-gateway-303137
```

### 5.3 Re-read marker

Run same GET check and ensure value still matches marker.

If marker disappears, stop and investigate settings immediately.

## 6) Why Keys Disappear (Known Failure Modes)

1. `MESH_SECURE_DB_FILE` missing/misconfigured and DB resolves to non-persistent location.
2. `MESH_DATA_ENCRYPTION_KEY` changed (old encrypted rows become unreadable).
3. Clean deploys plus runtime DB in app root (`/home/site/wwwroot`) cause loss.
4. Deployment happened to wrong app/slot.

## 7) Emergency Recovery Checklist

1. Confirm app settings:
   - `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`
   - `MESH_DATA_ENCRYPTION_KEY` present and unchanged
2. Restart gateway.
3. Run DB persistence marker test.
4. If still failing, inspect runtime filesystem via App Service console/SSH:
   - Check whether `/home/data/mesh-secure.db` exists.
   - If legacy DB exists under app root and `/home/data` DB is missing, copy legacy DB to `/home/data` and restart.

## 8) Recommended Deploy Routine (Short Form)

1. Preflight syntax checks.
2. Verify app settings (`MESH_SECURE_DB_FILE`, `MESH_DATA_ENCRYPTION_KEY`).
   For voice deploys also verify `AZURE_OPENAI_VOICE_ENDPOINT`, `AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT`, `AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT`, `AZURE_OPENAI_VOICE_TTS_DEPLOYMENT`, `AZURE_OPENAI_VOICE_AUDIO_API_VERSION`, `AZURE_OPENAI_VOICE_CHAT_API_VERSION`, and `AZURE_OPENAI_VOICE_TTS_VOICE`.
3. Full zip deploy gateway (`--clean false`).
4. Deploy worker if changed.
5. Smoke checks (auth + status).
   If the site briefly returns `503` right after deploy, wait for App Service warmup to finish and retry before assuming startup failed.
6. DB persistence marker test.

If any step fails: stop, fix, redeploy.
