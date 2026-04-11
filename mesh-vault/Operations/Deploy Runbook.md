---
tags: [operations]
---

# Deploy Runbook

> Canonical deployment procedure for `try-mesh.com`. Use for every production deploy.

## Goals

- Deploy with one full zip artifact
- Keep encrypted user data persistent across deploys
- Catch failures early via preflight + smoke checks

## Production Targets

| App | Azure Name | Resource Group |
|-----|-----------|----------------|
| Gateway | `mesh-gateway-303137` | `mesh-rg` |
| Worker | `mesh-worker-303137` | `mesh-rg` |

## Critical Pre-Deploy Facts

1. User API keys are in encrypted SQLite (`secure-db.js`) — must survive deploys
2. DB must be on persistent storage: `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db`
3. Encryption key `MESH_DATA_ENCRYPTION_KEY` must never be rotated casually
4. Never ship `.mesh-secure.db` inside zip artifacts
5. Use `--clean false` for normal deploys

## Step 0: Verify App Settings (One-Time, Then Check Each Deploy)

```bash
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='MESH_SECURE_DB_FILE' || name=='MESH_DATA_ENCRYPTION_KEY' || name=='SCM_DO_BUILD_DURING_DEPLOYMENT' || name=='ENABLE_ORYX_BUILD'].name" -o tsv
```

Expected DB path:
```bash
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='MESH_SECURE_DB_FILE'].{name:name,value:value}" -o table
# Expected: MESH_SECURE_DB_FILE  /home/data/mesh-secure-v2.db
```

## Step 1: Preflight Syntax Checks

```bash
node --check server.js
node --check mesh-core/src/server.js
node --check llm-compress.js
```

## Step 2: Deploy Gateway

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

## Step 3: Deploy Worker (Only When Worker Code Changed)

Worker code lives in `mesh-core/src/`. Only redeploy when those files change.

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

Worker startup command: `node mesh-core/src/server.js`

Check startup command:
```bash
az webapp config show -g mesh-rg -n mesh-worker-303137 --query "appCommandLine" -o tsv
```

## Step 4: Post-Deploy Smoke Checks

### 4.1 Basic Health

```bash
curl -I https://try-mesh.com/
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

If the site briefly returns `503` after deploy, wait for App Service warmup and retry.

## Step 5: DB Persistence Verification (Mandatory)

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

### 5.2 Restart

```bash
az webapp restart -g mesh-rg -n mesh-gateway-303137
```

### 5.3 Re-read marker

Run the same GET and verify the marker still matches. If it disappears, investigate immediately.

## Short-Form Checklist

- [ ] Preflight syntax checks
- [ ] Verify `MESH_SECURE_DB_FILE` and `MESH_DATA_ENCRYPTION_KEY` in app settings
- [ ] For voice deploys: verify all `AZURE_OPENAI_VOICE_*` settings
- [ ] Deploy gateway (`--clean false`)
- [ ] Deploy worker if changed
- [ ] Smoke checks (auth + status)
- [ ] DB persistence marker test
