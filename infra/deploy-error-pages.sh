#!/usr/bin/env bash
# infra/deploy-error-pages.sh
# Upload branded CloudFront error pages to S3 under the /_errors/ prefix.
# Run this once during initial stack creation and after any HTML changes.
#
# Usage:
#   ./infra/deploy-error-pages.sh <s3-bucket-name>
#
# Examples:
#   ./infra/deploy-error-pages.sh my-mesh-bucket
#   S3_BUCKET=my-mesh-bucket ./infra/deploy-error-pages.sh

set -euo pipefail

BUCKET="${1:-${S3_BUCKET:-}}"

if [[ -z "$BUCKET" ]]; then
  echo "Error: S3 bucket name required." >&2
  echo "Usage: $0 <bucket-name>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PAGES_DIR="${SCRIPT_DIR}/error-pages"

if [[ ! -d "$PAGES_DIR" ]]; then
  echo "Error: error-pages directory not found at ${PAGES_DIR}" >&2
  exit 1
fi

echo "Uploading error pages to s3://${BUCKET}/_errors/ ..."

for code in 502 503 504; do
  PAGE="${PAGES_DIR}/${code}.html"
  if [[ ! -f "$PAGE" ]]; then
    echo "Warning: ${code}.html not found — skipping" >&2
    continue
  fi
  aws s3 cp "$PAGE" "s3://${BUCKET}/_errors/${code}.html" \
    --content-type "text/html; charset=utf-8" \
    --cache-control "public, max-age=30"
  echo "  Uploaded ${code}.html"
done

echo "Done. CloudFront will serve branded error pages within 30s (TTL)."
