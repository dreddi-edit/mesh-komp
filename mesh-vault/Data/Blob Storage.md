---
tags: [data]
---

# Blob Storage

Account: `meshoffload303137`
Type: StorageV2
Region: West Europe
Endpoint: `https://meshoffload303137.blob.core.windows.net/`
Container: `workspace-offload`

## Role

Azure Blob Storage is the **source of truth** for all uploaded workspace files.

- Browser uploads raw `File` objects directly via PUT + SAS (not base64 JSON)
- Functions read from Blob to build capsules
- Workers read from Blob to serve file content
- Browser fetches file content directly from Blob via read URLs (not through Gateway)

## Blob Naming Schema

```
mesh-workspace/<sessionId>/<workspaceId>/<folderSlug>/files/<relativePath>
```

### Example

```
mesh-workspace/session-abc123/workspace-xyz789/my-repo/files/src/index.js
mesh-workspace/session-abc123/workspace-xyz789/my-repo/files/package.json
mesh-workspace/session-abc123/workspace-xyz789/my-repo/files/src/utils/helpers.js
```

### Why This Schema

- Completely self-contained path — encodes all workspace identity
- Azure Function can derive `workspaceId`, `sessionId`, and relative `path` from the blob path alone
- No Worker lookup needed to attribute a blob to a workspace
- Supports multiple sessions per workspace (different `sessionId` prefix)

Built in: `workspace-upload-utils.cjs` → `buildBlobPath()`
Parsed in: `workspace-upload-utils.cjs` → `parseBlobPath()`

## SAS Token Types

The system uses separate SAS tokens with least-privilege scopes:

| Token | Env Var | Permissions | Used By |
|-------|---------|------------|---------|
| Upload SAS | `MESH_AZURE_BLOB_UPLOAD_SAS_TOKEN` | Write | Browser (direct PUT) |
| Ingest SAS | `MESH_AZURE_BLOB_INGEST_SAS_TOKEN` | Write | Server-side ingest |
| Read SAS | `MESH_AZURE_BLOB_READ_SAS_TOKEN` | Read | Worker + browser file open |
| Delete SAS | `MESH_AZURE_BLOB_DELETE_SAS_TOKEN` | Delete | File delete operations |
| General SAS | `MESH_AZURE_BLOB_SAS_TOKEN` | Read+Write | Fallback |

SAS tokens expire — if they expire, browser can't open files. Rotate and update app settings.

## Browser Direct Upload

The browser uploads files **directly to Blob** without going through the Gateway:

1. Gateway delivers offload config to browser (SAS tokens + blob base URL)
2. Browser builds canonical blob path for each file
3. Browser sends `PUT <blobUrl>` with file data and upload SAS
4. Browser sends metadata-only ingest to Gateway (paths only, no content)

This reduces Gateway load significantly for large workspaces.

## Browser Direct Read

When opening a file from an upload workspace:

1. Gateway returns `storage.readUrl` (blob URL + read SAS)
2. Browser fetches content directly from Blob via `GET`
3. Blob content renders in Monaco editor

Again, no file content flows through Gateway for reads.

## File Operations on Upload Workspaces

| Operation | What Happens |
|-----------|-------------|
| Save | Worker writes updated content to Blob, updates Cosmos metadata |
| Create | Worker creates new Blob, seeds Cosmos file record |
| Rename | Worker copies to new path, deletes old path, updates Cosmos |
| Delete | Worker deletes Blob, removes Cosmos record |

All operations pass `workspaceId` explicitly to route correctly in multi-instance deployments.

## Cross-Region Note

Blob is in **West Europe**, Cosmos is in **North Europe**.

Azure Function reads from Blob (West EU) and writes to Cosmos (North EU) — this adds ~10–20ms latency per Function invocation. Accepted at current scale.
