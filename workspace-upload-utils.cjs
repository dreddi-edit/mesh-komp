function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\.(\/|$)/g, "")
    .trim();
}

function trim(value) {
  return String(value || "").trim();
}

function sanitizeSegment(value, fallback = "segment") {
  const normalized = trim(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function buildUploadBlobPrefix({ sessionId, workspaceId, folderName }) {
  return `mesh-workspace/${sanitizeSegment(sessionId, "session")}/${sanitizeSegment(workspaceId, "workspace")}/${sanitizeSegment(folderName, "workspace")}`;
}

function buildUploadBlobPath({ sessionId, workspaceId, folderName, path }) {
  return `${buildUploadBlobPrefix({ sessionId, workspaceId, folderName })}/files/${normalizePath(path)}`;
}

function parseUploadBlobPath(blobPath) {
  const normalized = normalizePath(blobPath);
  const match = /^mesh-workspace\/([^/]+)\/([^/]+)\/([^/]+)\/files\/(.+)$/.exec(normalized);
  if (!match) return null;
  return {
    sessionId: trim(match[1]),
    workspaceId: trim(match[2]),
    folderSlug: trim(match[3]),
    path: normalizePath(match[4]),
    blobPath: normalized,
  };
}

module.exports = {
  buildUploadBlobPath,
  buildUploadBlobPrefix,
  normalizePath,
  parseUploadBlobPath,
  sanitizeSegment,
};
