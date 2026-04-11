---
tags: [backend]
---

# Azure Functions

## Purpose

The Azure Functions layer handles CPU-intensive capsule computation for upload workspaces in a serverless, horizontally scalable fan-out pattern.

Each uploaded file triggers an independent Function invocation — the worker is not involved in the per-file capsule computation.

## Function App

Name: `mesh-capsule-fanout-303137`
Type: `functionapp,linux`
Status: Running

## Files

| File | Purpose |
|------|---------|
| `mesh-functions/src/functions/blob-capsule-indexer.js` | Event Grid trigger + entry point |
| `mesh-functions/src/shared/blob-capsule-processor.cjs` | Core blob → capsule logic |
| `mesh-functions/host.json` | Host config (`maxEventsPerBatch: 1`) |
| `mesh-functions/package.json` | Package manifest |
| `mesh-functions/src/scripts/invoke-event.js` | Local testing helper |

## Trigger

Function name: `workspaceBlobCapsuleIndexer`
Trigger: **Event Grid** — fires on every blob creation in the workspace container.

```json
// host.json
{
  "maxEventsPerBatch": 1,
  "preferredBatchSizeInKilobytes": 64
}
```

`maxEventsPerBatch: 1` means each blob gets its own invocation. This is the fan-out pattern.

## Processing Pipeline

1. Event Grid delivers blob URL
2. Function parses blob path → extracts `workspaceId`, `sessionId`, `path`
3. Builds Azure Blob service client (from connection string or SAS)
4. Streams blob content
5. Small files: read inline (< `MESH_FUNCTION_INLINE_BUFFER_BYTES`, default 8 MiB)
6. Large files: spool to temp disk
7. Extracts indexable text (caps at `MESH_WORKSPACE_MAX_FILE_CHARS`, default 25M chars)
8. Detects binary files early → marks as `[binary or unreadable]`
9. Calls `buildWorkspaceFileRecord(...)` → builds capsule structure
10. Upserts file document to Cosmos DB `workspace_files`

## OOM Protection

| Variable | Default | Purpose |
|----------|---------|---------|
| `MESH_WORKSPACE_MAX_FILE_CHARS` | `25_000_000` | Max characters to process per file |
| `MESH_FUNCTION_INLINE_BUFFER_BYTES` | `8 MiB` | Max inline RAM read before spooling to disk |

Binary data is detected early and never loaded into the capsule pipeline.

## Blob Client Construction

The Function tries four auth strategies in order:

1. `MESH_FUNCTION_AZURE_STORAGE_CONNECTION_STRING`
2. `AzureWebJobsStorage`
3. `MESH_AZURE_STORAGE_ACCOUNT` + `MESH_AZURE_STORAGE_KEY`
4. Blob Base URL + Read SAS token

## Path Parsing

The Function derives all workspace context from the blob path alone:

```
mesh-workspace/<sessionId>/<workspaceId>/<folderSlug>/files/<relativePath>
```

No Worker lookup needed. `workspaceId`, `sessionId`, and `path` come directly from the path.

## Cosmos Write

After building the capsule, the Function upserts a document to Cosmos `workspace_files`:

```json
{
  "id": "<workspaceId>:<path>",
  "workspaceId": "...",
  "path": "src/index.js",
  "status": "completed",
  "capsuleCache": { ... },
  "spanIndex": [ ... ],
  "compressionStats": { ... }
}
```

See [[Data/Cosmos Data Model]] for the full schema.

## Testing

`mesh-functions/src/scripts/invoke-event.js` is a helper for manually invoking function events during local testing.

## Operational Notes

- Very large workspaces → high Event Grid burst + Cosmos write concurrency → watch for 429 throttling
- Cold starts on the Function App add latency for first file after idle period
- Cross-region: Function writes to Cosmos (North Europe) while reading from Blob (West Europe)
