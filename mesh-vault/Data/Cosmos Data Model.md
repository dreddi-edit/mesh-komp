---
tags: [data]
---

# Cosmos Data Model

Cosmos DB account: `meshcosmosne303137`
Region: North Europe
Endpoint: `https://meshcosmosne303137.documents.azure.com:443/`

## Containers

| Container | Purpose | Partition Key |
|-----------|---------|---------------|
| `workspace_workspaces` | One document per workspace | `workspaceId` |
| `workspace_files` | One document per file per workspace | `workspaceId` |

Both containers created/verified on startup if `MESH_COSMOS_CREATE_CONTAINERS=true`.

---

## `workspace_workspaces` — Workspace Summary

One document per upload workspace. Tracks overall progress and status.

```json
{
  "id": "<workspaceId>",
  "workspaceId": "<workspaceId>",
  "folderName": "repo-name",
  "rootPath": "",
  "sourceKind": "upload",
  "sessionId": "<sessionId>",
  "status": "processing",
  "fileCountTotal": 100000,
  "fileCountPending": 85000,
  "fileCountCompleted": 14900,
  "fileCountFailed": 100,
  "indexedAt": "2026-04-06T20:00:00.000Z",
  "createdAt": "2026-04-06T19:50:00.000Z",
  "updatedAt": "2026-04-06T20:00:01.000Z"
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Manifest seeded, no files processed yet |
| `processing` | Files being indexed |
| `completed` | All files indexed |
| `failed` | Indexing encountered critical errors |

---

## `workspace_files` — Per-File Records

One document per file. Written by the Azure Function after capsule computation.

```json
{
  "id": "<workspaceId>:<path>",
  "workspaceId": "<workspaceId>",
  "folderName": "repo-name",
  "sourceKind": "upload",
  "sessionId": "<sessionId>",
  "path": "src/index.js",
  "status": "completed",
  "originalSize": 12345,
  "storage": {
    "provider": "azure-blob",
    "blobPath": "mesh-workspace/.../files/src/index.js",
    "azureBlobUrl": "https://.../workspace-offload/mesh-workspace/.../files/src/index.js"
  },
  "capsuleCache": {
    "ultra": { ... },
    "medium": { ... },
    "loose": { ... }
  },
  "capsuleBase": { ... },
  "spanIndex": [ ... ],
  "fileTypeInfo": {
    "language": "javascript",
    "binary": false
  },
  "compressionStats": {
    "originalTokens": 1234,
    "ultraTokens": 123,
    "mediumTokens": 456,
    "looseTokens": 789,
    "ratio": 0.64
  },
  "transportEnvelope": {
    "manifestText": "...",
    "chunks": []
  }
}
```

### File Status Values

| Status | Meaning |
|--------|---------|
| `pending` | Seeded by Worker at manifest ingest time |
| `processing` | Azure Function is working on it |
| `completed` | Capsule built and stored |
| `failed` | Function encountered an error |

### Important Constraints

- `rawStorage.contentBase64` is **not** stored in Cosmos — raw content lives in Blob only
- `transportEnvelope.chunks` is **not** used as raw payload storage
- Keeping Cosmos lean is intentional — it avoids document size limits and keeps reads fast

---

## Lifecycle

1. Worker seeds `workspace_workspaces` with status `processing`
2. Worker seeds `workspace_files` with status `pending` for each file
3. Event Grid triggers Function per blob
4. Function builds capsule → upserts `workspace_files` with `completed` status
5. Worker/Gateway poll file count to show progress in UI
6. When all files done: `workspace_workspaces` status becomes `completed`

---

## Throttling

Cosmos can return `429 Too Many Requests` when RU provisioning is exceeded.

Handled in `workspace-metadata-store.cjs` with:
- Retry logic
- Exponential backoff
- Smaller batch sizes on retry

---
