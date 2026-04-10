const fs = require("fs");
const os = require("os");
const path = require("path");
const { pipeline } = require("stream/promises");
const { StringDecoder } = require("string_decoder");
const { BlobClient, BlobServiceClient, StorageSharedKeyCredential } = require("@azure/storage-blob");

function requireFirst(...candidates) {
  let lastError = null;
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error(`Module load failed for candidates: ${candidates.join(", ")}`);
}

const compressionCore = requireFirst(
  "../../mesh-core/src/compression-core.cjs",
  "../../../mesh-core/src/compression-core.cjs",
);
const { createWorkspaceMetadataStore } = requireFirst(
  "../../workspace-metadata-store.cjs",
  "../../../workspace-metadata-store.cjs",
);
const { parseUploadBlobPath } = requireFirst(
  "../../workspace-upload-utils.cjs",
  "../../../workspace-upload-utils.cjs",
);

const {
  buildWorkspaceFileRecord,
} = compressionCore;

const INDEX_CHAR_LIMIT = Math.max(1, Number(process.env.MESH_WORKSPACE_MAX_FILE_CHARS || 15_000_000));
const INLINE_BUFFER_BYTES = Math.max(256 * 1024, Number(process.env.MESH_FUNCTION_INLINE_BUFFER_BYTES || 4 * 1024 * 1024));
const STREAM_CHUNK_BYTES = Math.max(64 * 1024, Number(process.env.MESH_FUNCTION_STREAM_CHUNK_BYTES || 512 * 1024));
const TRUNCATION_NOTE = `[mesh note] File truncated during indexing because it exceeded ${INDEX_CHAR_LIMIT.toLocaleString()} characters.`;

const metadataStore = createWorkspaceMetadataStore();
let blobServiceClientPromise = null;

function trim(value) {
  return String(value || "").trim();
}

function normalizeSasToken(value = "") {
  return trim(value).replace(/^\?+/, "");
}

async function getBlobServiceClient() {
  if (blobServiceClientPromise) return blobServiceClientPromise;
  blobServiceClientPromise = (async () => {
    const connectionString = trim(
      process.env.MESH_FUNCTION_AZURE_STORAGE_CONNECTION_STRING
      || process.env.AzureWebJobsStorage
      || ""
    );
    if (connectionString) {
      return BlobServiceClient.fromConnectionString(connectionString);
    }

    const accountName = trim(process.env.MESH_AZURE_STORAGE_ACCOUNT || "");
    const accountKey = trim(process.env.MESH_AZURE_STORAGE_KEY || "");
    if (accountName && accountKey) {
      const credential = new StorageSharedKeyCredential(accountName, accountKey);
      return new BlobServiceClient(`https://${accountName}.blob.core.windows.net`, credential);
    }

    const readSasToken = normalizeSasToken(
      process.env.MESH_AZURE_BLOB_READ_SAS_TOKEN
      || process.env.MESH_AZURE_BLOB_INGEST_SAS_TOKEN
      || process.env.MESH_AZURE_BLOB_SAS_TOKEN
      || ""
    );
    const baseUrl = trim(process.env.MESH_AZURE_BLOB_BASE_URL || "");
    if (baseUrl && readSasToken) {
      const separator = baseUrl.includes("?") ? "&" : "?";
      return new BlobServiceClient(`${baseUrl}${separator}${readSasToken}`);
    }

    throw new Error("Azure blob credentials are not configured for mesh functions.");
  })();
  return blobServiceClientPromise;
}

async function blobClientForUrl(blobUrl) {
  const parsedUrl = new URL(blobUrl);
  const pathParts = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "")).split("/");
  const containerName = trim(pathParts.shift() || "");
  const blobName = pathParts.join("/");
  if (!containerName || !blobName) {
    throw new Error(`Cannot resolve blob path from URL: ${blobUrl}`);
  }
  const serviceClient = await getBlobServiceClient();
  return serviceClient.getContainerClient(containerName).getBlobClient(blobName);
}

function appendDecodedChunk(state, chunk) {
  if (state.binary) return;
  const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  if (!buffer.length) return;
  state.byteLength += buffer.length;
  if (buffer.includes(0)) {
    state.binary = true;
    state.truncated = false;
    state.decoder.end();
    return;
  }
  if (state.done) return;
  const decoded = state.decoder.write(buffer);
  if (!decoded) return;
  const remaining = INDEX_CHAR_LIMIT - state.textLength;
  if (remaining <= 0) {
    state.done = true;
    state.truncated = true;
    return;
  }
  if (decoded.length <= remaining) {
    state.parts.push(decoded);
    state.textLength += decoded.length;
    return;
  }
  state.parts.push(decoded.slice(0, remaining));
  state.textLength += remaining;
  state.done = true;
  state.truncated = true;
}

async function extractIndexableTextFromStream(stream) {
  const state = {
    decoder: new StringDecoder("utf8"),
    parts: [],
    textLength: 0,
    byteLength: 0,
    truncated: false,
    binary: false,
    done: false,
  };

  for await (const chunk of stream) {
    appendDecodedChunk(state, chunk);
  }

  if (!state.binary && !state.done) {
    const tail = state.decoder.end();
    if (tail) appendDecodedChunk(state, Buffer.from(tail, "utf8"));
  }

  if (state.binary) {
    return {
      content: "[binary or unreadable]",
      byteLength: state.byteLength,
      truncated: false,
      binary: true,
    };
  }

  let content = state.parts.join("");
  if (state.truncated) {
    content = `${content}\n\n${TRUNCATION_NOTE}`;
  }

  return {
    content,
    byteLength: state.byteLength,
    truncated: state.truncated,
    binary: false,
  };
}

async function withTemporaryFile(prefix, callback) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  const tempFilePath = path.join(tempDir, "blob-source.tmp");
  try {
    return await callback(tempFilePath);
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function readBlobIndexableText(blobUrl, sizeBytes = 0) {
  const blobClient = await blobClientForUrl(blobUrl);
  const download = await blobClient.download();
  if (!download.readableStreamBody) {
    throw new Error("Azure blob download did not expose a readable stream.");
  }
  if (Number(sizeBytes || 0) > 0 && Number(sizeBytes || 0) <= INLINE_BUFFER_BYTES) {
    return extractIndexableTextFromStream(download.readableStreamBody);
  }
  return withTemporaryFile("mesh-function-capsule", async (tempFilePath) => {
    await pipeline(download.readableStreamBody, fs.createWriteStream(tempFilePath));
    return extractIndexableTextFromStream(fs.createReadStream(tempFilePath, {
      highWaterMark: STREAM_CHUNK_BYTES,
    }));
  });
}

function eventBlobUrl(event) {
  return String(
    event?.data?.url
    || event?.data?.blobUrl
    || event?.url
    || ""
  ).trim();
}

function eventBlobSize(event) {
  return Number(
    event?.data?.contentLength
    ?? event?.data?.contentLengthInBytes
    ?? event?.data?.data?.contentLength
    ?? 0
  );
}

async function processBlobCapsuleEvent(event, context = {}) {
  const blobUrl = eventBlobUrl(event);
  if (!blobUrl) {
    throw new Error("Event Grid blob URL missing.");
  }
  const parsedUrl = new URL(blobUrl);
  const blobPath = decodeURIComponent(parsedUrl.pathname.replace(/^\/+/, "").split("/").slice(1).join("/"));
  const identity = parseUploadBlobPath(blobPath);
  if (!identity?.workspaceId || !identity?.path) {
    throw new Error(`Blob path "${blobPath}" is not a workspace upload path.`);
  }
  const existing = await metadataStore.getWorkspaceFile(identity.workspaceId, identity.path);
  const workspace = await metadataStore.getWorkspaceSummary(identity.workspaceId);
  const folderName = String(existing?.folderName || workspace?.folderName || identity.folderSlug || "workspace").trim() || "workspace";
  const originalSize = Number(existing?.originalSize || eventBlobSize(event) || 0);
  const indexable = await readBlobIndexableText(blobUrl, originalSize);
  const record = await buildWorkspaceFileRecord(identity.path, indexable.content, {
    originalSizeOverride: indexable.byteLength || originalSize,
    truncated: indexable.truncated,
    storage: {
      provider: "azure-blob",
      blobPath: identity.blobPath,
      azureBlobUrl: `${parsedUrl.origin}${parsedUrl.pathname}`,
    },
    persistRawContent: false,
    persistTransportChunks: false,
  });
  const saved = await metadataStore.upsertWorkspaceFileRecord({
    workspaceId: identity.workspaceId,
    sessionId: String(existing?.sessionId || workspace?.sessionId || identity.sessionId || "").trim(),
    folderName,
    rootPath: "",
    sourceKind: "upload",
    path: identity.path,
    record,
    status: "completed",
  });
  context.log?.(`Processed workspace blob ${identity.blobPath} -> ${identity.workspaceId}:${identity.path}`);
  return saved;
}

module.exports = {
  metadataStore,
  parseUploadBlobPath,
  processBlobCapsuleEvent,
  readBlobIndexableText,
};
