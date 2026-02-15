#!/bin/bash
# Resize all portrait photos to max 512x512, normalize extensions to lowercase,
# and upload to R2.

BUCKET="eink-birthday-photos"
PHOTO_DIR="$(dirname "$0")/../photos/portraits"
PREPARED_DIR="$(dirname "$0")/../photos/.prepared"
COUNT=0

if [ ! -d "$PHOTO_DIR" ]; then
  echo "Error: photos/portraits/ directory not found"
  exit 1
fi

rm -rf "$PREPARED_DIR"
mkdir -p "$PREPARED_DIR"

echo "=== Resizing and normalizing photos ==="

for file in "$PHOTO_DIR"/*.jpg "$PHOTO_DIR"/*.jpeg "$PHOTO_DIR"/*.JPG "$PHOTO_DIR"/*.JPEG; do
  [ -f "$file" ] || continue

  filename=$(basename "$file")
  # Normalize extension to .jpg (lowercase)
  normalized=$(echo "$filename" | sed -E 's/\.(jpg|jpeg|JPG|JPEG)$/.jpg/')

  dest="$PREPARED_DIR/$normalized"
  cp "$file" "$dest"

  # Resize to fit within 512x512, preserving aspect ratio
  sips --resampleHeightWidthMax 512 "$dest" --out "$dest" > /dev/null 2>&1

  size=$(du -h "$dest" | cut -f1)
  echo "  $filename → $normalized ($size)"
done

echo ""
echo "=== Uploading to R2 ==="

for file in "$PREPARED_DIR"/*.jpg; do
  [ -f "$file" ] || continue
  filename=$(basename "$file")
  r2_key="portraits/$filename"
  echo "  Uploading $r2_key"
  npx wrangler r2 object put "$BUCKET/$r2_key" --file="$file" --remote 2>&1 | grep -E "(✅|error|Error)"
  COUNT=$((COUNT + 1))
done

echo ""
echo "Done — uploaded $COUNT photo(s)"

# Cleanup
rm -rf "$PREPARED_DIR"
