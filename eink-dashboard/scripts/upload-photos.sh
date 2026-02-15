#!/bin/bash
# Upload all portrait photos from photos/portraits/ to R2 bucket.
# Supports both single ({key}.jpg) and numbered ({key}_0.jpg) naming.

BUCKET="eink-birthday-photos"
PHOTO_DIR="$(dirname "$0")/../photos/portraits"
COUNT=0

if [ ! -d "$PHOTO_DIR" ]; then
  echo "Error: photos/portraits/ directory not found"
  exit 1
fi

for file in "$PHOTO_DIR"/*.jpg "$PHOTO_DIR"/*.jpeg; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  r2_key="portraits/$filename"
  echo "Uploading $filename → $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file"
  COUNT=$((COUNT + 1))
done

if [ $COUNT -eq 0 ]; then
  echo "No photos found in photos/portraits/"
  echo "Add .jpg files named like: thiago_0.jpg, thiago_1.jpg, or thiago.jpg"
  exit 1
fi

echo "Done — uploaded $COUNT photo(s)"
