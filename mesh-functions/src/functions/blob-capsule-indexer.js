const { app } = require("@azure/functions");
const { metadataStore, parseUploadBlobPath, processBlobCapsuleEvent } = require("../shared/blob-capsule-processor.cjs");

app.eventGrid("workspaceBlobCapsuleIndexer", {
  handler: async (event, context) => {
    try {
      await processBlobCapsuleEvent(event, context);
    } catch (error) {
      const blobUrl = String(event?.data?.url || event?.data?.blobUrl || "").trim();
      const parsedPath = (() => {
        try {
          const url = new URL(blobUrl);
          const blobPath = decodeURIComponent(url.pathname.replace(/^\/+/, "").split("/").slice(1).join("/"));
          return parseUploadBlobPath(blobPath);
        } catch {
          return null;
        }
      })();
      if (parsedPath?.workspaceId && parsedPath?.path) {
        await metadataStore.markWorkspaceFileFailed({
          workspaceId: parsedPath.workspaceId,
          sessionId: parsedPath.sessionId,
          folderName: parsedPath.folderSlug || "workspace",
          path: parsedPath.path,
          storage: {
            provider: "azure-blob",
            blobPath: parsedPath.blobPath,
            azureBlobUrl: blobUrl.replace(/\?.*$/, ""),
          },
          error: error?.message || "Workspace capsule processing failed",
          originalSize: Number(event?.data?.contentLength || 0),
        }).catch(() => {});
      }
      context.error(error);
      throw error;
    }
  },
});
