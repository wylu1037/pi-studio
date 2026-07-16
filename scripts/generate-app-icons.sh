#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$ROOT/build/icon.svg"
PNG="$ROOT/build/icon.png"
ICNS="$ROOT/build/icon.icns"
ICO="$ROOT/build/icon.ico"
TEMP_DIR="$(mktemp -d)"
ICONSET="$TEMP_DIR/icon.iconset"

trap 'rm -rf "$TEMP_DIR"' EXIT

mkdir -p "$ICONSET"
sips -s format png "$SOURCE" --out "$PNG" >/dev/null

for size in 16 32 128 256 512; do
  double_size=$((size * 2))
  sips -z "$size" "$size" "$PNG" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$double_size" "$double_size" "$PNG" \
    --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil --convert icns "$ICONSET" --output "$ICNS"
sips -z 256 256 "$PNG" --out "$TEMP_DIR/icon-256.png" >/dev/null
sips -s format ico "$TEMP_DIR/icon-256.png" --out "$ICO" >/dev/null

printf 'Generated %s, %s, and %s\n' "$PNG" "$ICNS" "$ICO"
