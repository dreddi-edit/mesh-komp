---
tags: [operations]
---

# Troubleshooting

## API Keys Disappear After Deploy

This is the most critical failure mode. User API keys are stored in encrypted SQLite.

### Causes (in order of likelihood)

1. **`MESH_SECURE_DB_FILE` missing or wrong** — DB resolves to non-persistent location (`/home/site/wwwroot` instead of `/home/data/`)
2. **`MESH_DATA_ENCRYPTION_KEY` changed** — old encrypted rows become unreadable
3. **Clean deploy** — `--clean true` wipes app root, destroying any DB stored there
4. **Deployed to wrong app or slot**

### Fix

1. Verify `MESH_SECURE_DB_FILE=/home/data/mesh-secure-v2.db` in app settings
2. Verify `MESH_DATA_ENCRYPTION_KEY` is present and unchanged
3. Restart gateway
4. Run DB persistence marker test (see [[Operations/Deploy Runbook]])

If still failing, SSH into App Service console:
```bash
# Check if legacy DB exists at app root
ls /home/site/wwwroot/*.db

# Check if /home/data DB exists
ls /home/data/

# If legacy DB exists but /home/data DB is missing:
cp /home/site/wwwroot/mesh-secure.db /home/data/mesh-secure-v2.db
```

---

## Upload Workspace Hangs / Files Don't Appear

### Check

1. Did the blob land in the container? Check Azure Blob Storage
2. Did Cosmos manifest seeding succeed? Check for 429 errors in Function logs
3. Is Event Grid delivering events to the Function?
4. Are there Function execution errors?

### Common Causes

- Cosmos 429 (RU throttling) during large manifest seeds — retry logic in `workspace-metadata-store.cjs` should handle this
- Event Grid misconfiguration — verify trigger subscription in Azure portal
- Function cold start delays — first invocation after idle period takes longer

---

## File Stays on `indexing` Status

### Check

1. Does the file document exist in Cosmos `workspace_files`?
2. What is its `status` field? (`pending` → `processing` → `completed` | `failed`)
3. Are there Function errors for this specific blob?
4. Is there a binary detection issue (file treated as unreadable)?

### Fix

Check Function logs for the specific blob path. If status is `failed`, inspect the error detail in the Cosmos document.

---

## Editor Can't Open a File (Upload Workspace)

### Check

1. Does the API response include `storage.readUrl`?
2. Is the SAS token still valid? (They expire)
3. Does the blob still exist in storage?
4. Is the CORS config on the Blob container allowing browser reads?

### Fix

Rotate SAS tokens if expired. Verify blob container CORS settings allow the `try-mesh.com` origin.

---

## Wrong Workspace Keeps Loading

### Symptom

After refreshing or navigating, the app loads a different workspace than expected.

### Cause

`workspaceId` not being sent with file listing or file open requests — Worker falls back to last in-memory workspace state.

### Check

- Verify the frontend sends `workspaceId` with `/api/assistant/workspace/files`
- Verify the frontend sends `workspaceId` with `/api/assistant/workspace/file`
- Check browser localStorage for stale cached workspace ID
- Check if the issue is instance-specific (multi-instance worker)

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

1. Are all `AZURE_OPENAI_VOICE_*` env vars set correctly in gateway settings?
2. Is the Azure OpenAI endpoint accessible from the gateway App Service?
3. Is mic permission granted in the browser?
4. Check browser console for WebSocket connection errors to `/api/realtime`

---

## 503 After Deploy

Normal. App Service takes 30–60 seconds to warm up after a restart.

Wait and retry. Only escalate if 503 persists beyond 2 minutes.

---

## Emergency Recovery Checklist

1. Confirm app settings: `MESH_SECURE_DB_FILE` + `MESH_DATA_ENCRYPTION_KEY`
2. Restart gateway: `az webapp restart -g mesh-rg -n mesh-gateway-303137`
3. Run DB persistence marker test
4. If still failing: SSH into console, inspect `/home/data/` and `/home/site/wwwroot/`
