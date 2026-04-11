---
tags: [operations]
---

# Environment Variables

All variables organized by component.

## Gateway (`mesh-gateway-303137`)

### Core / Database

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_SECURE_DB_FILE` | **Yes** | Path to encrypted SQLite. Must be `/home/data/mesh-secure-v2.db` |
| `MESH_DATA_ENCRYPTION_KEY` | **Yes** | Encryption key for secure-db. Never rotate casually. |

### Build / Deployment

| Variable | Required | Description |
|----------|----------|-------------|
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | Yes | Azure build config |
| `ENABLE_ORYX_BUILD` | Yes | Azure Oryx build flag |

### Azure Blob / Offload

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_AZURE_OFFLOAD_ENABLED` | Yes | Enable blob offload for uploads |
| `MESH_AZURE_BLOB_BASE_URL` | Yes | Blob storage endpoint URL |
| `MESH_AZURE_BLOB_CONTAINER` | Yes | Container name |
| `MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN` | Yes | SAS for browser direct uploads |
| `MESH_AZURE_BLOB_INGEST_SAS_TOKEN` | Yes | SAS for server-side ingest |
| `MESH_AZURE_BLOB_READ_SAS_TOKEN` | Yes | SAS for reading files |
| `MESH_AZURE_BLOB_DELETE_SAS_TOKEN` | Yes | SAS for deleting files |
| `MESH_AZURE_BLOB_SAS_TOKEN` | Yes | General SAS (fallback) |

### Cosmos DB

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_COSMOS_ENDPOINT` | Yes | `https://meshcosmosne303137.documents.azure.com:443/` |
| `MESH_COSMOS_KEY` | Yes | Cosmos auth key |
| `MESH_COSMOS_DATABASE` | Yes | Database name |
| `MESH_COSMOS_WORKSPACE_FILES_CONTAINER` | Yes | Container for file records |
| `MESH_COSMOS_WORKSPACES_CONTAINER` | Yes | Container for workspace summaries |
| `MESH_COSMOS_CREATE_CONTAINERS` | No | Auto-create containers on startup |

### Voice / Azure OpenAI

| Variable | Required | Value / Description |
|----------|----------|-------------------|
| `AZURE_OPENAI_VOICE_ENDPOINT` | Yes | `https://edgar-mnpv2n5b-eastus2.openai.azure.com/` |
| `AZURE_OPENAI_VOICE_KEY` | Yes | Azure OpenAI key (secret) |
| `AZURE_OPENAI_VOICE_TRANSCRIBE_DEPLOYMENT` | Yes | `gpt-4o-mini-transcribe` |
| `AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT` | Yes | `gpt-5.4-nano` |
| `AZURE_OPENAI_VOICE_TTS_DEPLOYMENT` | Yes | `gpt-4o-mini-tts` |
| `AZURE_OPENAI_VOICE_AUDIO_API_VERSION` | Yes | `2025-04-01-preview` |
| `AZURE_OPENAI_VOICE_CHAT_API_VERSION` | Yes | `2025-04-01-preview` |
| `AZURE_OPENAI_VOICE_TTS_VOICE` | Yes | `alloy` |

### Terminal

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_TERMINAL_UPLOAD_ROOT` | No | Root dir for materializing upload workspaces for terminal |

### Observability

| Variable | Required | Description |
|----------|----------|-------------|
| `LOG_LEVEL` | No | Structured logger verbosity: `debug \| info \| warn \| error`. Default: `info`. Output is newline-delimited JSON to stdout (info/debug) or stderr (warn/error). |

## Worker (`mesh-worker-303137`)

### Blob Config

| Variable | Required | Description |
|----------|----------|-------------|
| `MESH_AZURE_OFFLOAD_ENABLED` | Yes | Enable blob backing for upload workspaces |
| `MESH_AZURE_BLOB_BASE_URL` | Yes | Same as gateway |
| `MESH_AZURE_BLOB_CONTAINER` | Yes | Same as gateway |
| `MESH_AZURE_BLOB_READ_SAS_TOKEN` | Yes | For reading workspace files |
| (other blob SAS tokens) | Yes | For write/delete operations |

### Cosmos DB

Same variables as gateway.

## Azure Functions (`mesh-capsule-fanout-303137`)

| Variable | Source | Description |
|----------|--------|-------------|
| `MESH_FUNCTION_AZURE_STORAGE_CONNECTION_STRING` | Option 1 | Full connection string for blob access |
| `AzureWebJobsStorage` | Option 2 | Azure Functions default storage connection |
| `MESH_AZURE_STORAGE_ACCOUNT` + `MESH_AZURE_STORAGE_KEY` | Option 3 | Account + key auth |
| (Blob Base URL + Read SAS) | Option 4 | URL-based access fallback |
| `MESH_COSMOS_ENDPOINT` | Yes | Cosmos endpoint for writing results |
| `MESH_COSMOS_KEY` | Yes | Cosmos key |
| `MESH_COSMOS_DATABASE` | Yes | Database name |
| `MESH_WORKSPACE_MAX_FILE_CHARS` | No | Default `25_000_000`. Max chars to process per file. |
| `MESH_FUNCTION_INLINE_BUFFER_BYTES` | No | Default `8 MiB`. Max inline RAM before disk spool. |

## Verify Commands

```bash
# Verify critical gateway settings
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='MESH_SECURE_DB_FILE' || name=='MESH_DATA_ENCRYPTION_KEY'].{name:name,value:value}" -o table

# Verify voice settings
az webapp config appsettings list -g mesh-rg -n mesh-gateway-303137 \
  --query "[?name=='AZURE_OPENAI_VOICE_ENDPOINT' || name=='AZURE_OPENAI_VOICE_TEXT_DEPLOYMENT' || name=='AZURE_OPENAI_VOICE_TTS_VOICE'].{name:name,value:value}" -o table
```
