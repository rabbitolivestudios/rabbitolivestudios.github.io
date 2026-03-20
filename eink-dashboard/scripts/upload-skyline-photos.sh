#!/usr/bin/env bash
#
# Upload skyline reference photos to R2 bucket.
# Photos must be in photos/skylines/{city_key}_{n}.jpg
#
# Usage: bash scripts/upload-skyline-photos.sh

set -euo pipefail

PHOTO_DIR="photos/skylines"
BUCKET="eink-birthday-photos"
R2_PREFIX="skylines"

cd "$(dirname "$0")/.."

if [ ! -d "$PHOTO_DIR" ]; then
  echo "Error: $PHOTO_DIR directory not found. Run download-skyline-photos.sh first."
  exit 1
fi

echo "=== Uploading skyline photos to R2 ==="
echo "Bucket: $BUCKET"
echo "Prefix: $R2_PREFIX/"
echo ""

uploaded=0
failed=0

for f in "$PHOTO_DIR"/*.jpg; do
  [ -f "$f" ] || continue
  filename=$(basename "$f")
  r2key="${R2_PREFIX}/${filename}"

  echo "  PUT $r2key"
  if npx wrangler r2 object put "${BUCKET}/${r2key}" --file="$f" --remote 2>/dev/null; then
    uploaded=$((uploaded + 1))
  else
    echo "  FAIL $r2key"
    failed=$((failed + 1))
  fi
done

echo ""
echo "=== Upload complete ==="
echo "Uploaded: $uploaded  Failed: $failed"
