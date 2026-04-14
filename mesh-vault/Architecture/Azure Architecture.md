---
tags: [architecture]
---

# Azure Architecture

> Last updated: 2026-04-06

## Five-Component Model

```
Browser
  │
  ▼
Gateway Web App  ──────────────────────► Worker Web App
mesh-gateway-303137                      mesh-worker-303137
  │                                           │
  │                                           │ (upload workspaces)
  │                                           ▼
  │                                     Azure Blob Storage
  │                                     meshoffload303137
  │                                           │ (Event Grid trigger)
  │                                           ▼
  │                                     Azure Functions
  │                                     mesh-capsule-fanout-303137
  │                                           │ (writes capsule metadata)
  │                                           ▼
  └──────────────────────────────────► Cosmos DB
                                        meshcosmosne303137
```

## Live Resources

| Resource | Name | Region |
|----------|------|--------|
| Resource Group | `mesh-rg` | — |
| Gateway Web App | `mesh-gateway-303137` | — |
| Worker Web App | `mesh-worker-303137` | — |
| Function App | `mesh-capsule-fanout-303137` | — |
| Blob Storage | `meshoffload303137` | West Europe |
| Cosmos DB | `meshcosmosne303137` | North Europe |

**Note:** Blob is in West Europe, Cosmos in North Europe — intentional due to capacity constraints at setup time. Causes some cross-region latency.

Blob endpoint: `https://meshoffload303137.blob.core.windows.net/`
Cosmos endpoint: `https://meshcosmosne303137.documents.azure.com:443/`

## Component Roles

### Gateway
- Serves `app.html` and static assets
- Handles login/session/auth
- Exposes all `/api/*` endpoints
- Proxies workspace requests to Worker via `meshTunnelRequest(...)`
- Falls back to inline logic if Worker is down
- Delivers offload config to the frontend (Blob SAS tokens)

### Worker
- **Local-path workspaces:** reads directly from server filesystem, indexes, runs git
- **Upload workspaces:** acts as coordinator/reader; Cosmos is the source of truth, not Worker RAM
- Exposes `/mesh/tunnel` dispatch endpoint

### Blob Storage
- Source of truth for all uploaded workspace files
- Browser uploads raw `File` objects directly via PUT + SAS (not base64 JSON)
- Worker and Functions read from Blob
- On file open, Gateway returns a read URL and browser fetches content directly from Blob

### Azure Functions (`mesh-capsule-fanout-303137`)
- Triggered per blob via Event Grid
- `maxEventsPerBatch: 1` — each blob gets its own invocation
- Stateless and horizontally scalable
- Builds capsule metadata per file via `buildWorkspaceFileRecord(...)`
- Writes result to Cosmos `workspace_files`

### Cosmos DB
- Stores workspace summaries (`workspace_workspaces` container)
- Stores per-file records with capsule cache, span index, compression stats (`workspace_files` container)
- Does **not** store raw file content or large base64 payloads

## Browser Upload Flow

1. Browser selects folder, generates `workspaceId` + `sessionId`
2. For each file: builds canonical blob path and uploads directly via PUT + SAS
3. Sends metadata-only ingest to `/api/assistant/workspace/offload/ingest`
4. Gateway forwards manifest to Worker
5. Worker seeds `pending` file entries in Cosmos
6. Event Grid fires per blob creation → Function executes
7. Function parses blob path, loads content, builds capsule, upserts to Cosmos
8. UI polls progress, shows files appearing as `indexing` → `completed`

## File Open Flow (Upload Workspace)

```
Browser → GET /api/assistant/workspace/file?path=...&view=original&workspaceId=...
  → Gateway → Worker (or fallback)
  → Response includes storage.readUrl (Azure Blob SAS read URL)
  → Browser fetches content directly from Blob
```

This offloads bandwidth from Gateway and Worker.

## Multi-Instance Safety

Because Gateway and Worker scale horizontally, workspace identity **must be explicit** in every request. `workspaceId` is passed explicitly on:
- File listing
- File open
- Save / create / delete / rename

Never rely on Worker in-memory state as the implicit workspace source.

## Blob Naming Schema

```
mesh-workspace/<sessionId>/<workspaceId>/<folderSlug>/files/<relativePath>
```

Example:
```
mesh-workspace/session-123/workspace-456/my-repo/files/src/index.js
```

The Function derives `workspaceId`, `sessionId`, and `path` directly from the blob path — no Worker lookup needed.

The Function derives all context from the blob path — see `mesh-functions/src/shared/blob-capsule-processor.cjs` for the parser logic.

## Environment Variables

See [[Operations/Environment Variables]] for the full list.

## Operational Limits

| Limit | Description |
|-------|-------------|
| Cosmos RU throttling | Large manifest seeds + concurrent Function upserts can cause 429s. Retry/backoff in `workspace-metadata-store.cjs`. |
| Function burst limits | Fan-out is high but Azure cold starts and concurrency caps apply. |
| Cross-region latency | Blob (West EU) → Cosmos (North EU) adds latency to Function writes. |
| Text extraction limit | `MESH_WORKSPACE_MAX_FILE_CHARS` defaults to 25,000,000 chars. Inline buffer capped at 8 MiB. |

## Troubleshooting

See [[Operations/Troubleshooting]] for common failure patterns.
