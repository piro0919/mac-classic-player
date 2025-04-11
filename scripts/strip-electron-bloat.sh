#!/bin/bash

APP_PATH="dist/mac-arm64/Mac Classic Player.app"

LOCALE_DIR="$APP_PATH/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources"
LIB_DIR="$APP_PATH/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries"

echo "🧹 Removing unused language packs..."
find "$LOCALE_DIR" -type d -name '*.lproj' \
  ! -name 'en.lproj' \
  ! -name 'ja.lproj' \
  -exec rm -rf {} +

echo "🧹 Removing libvk_swiftshader.dylib..."
rm -f "$LIB_DIR/libvk_swiftshader.dylib"

echo "✅ Done. Bloat stripped."