#!/bin/bash
ICON_SRC="assets/icon.png"
ICONSET_DIR="icon.iconset"

mkdir -p $ICONSET_DIR
sips -z 16 16     $ICON_SRC --out $ICONSET_DIR/icon_16x16.png
sips -z 32 32     $ICON_SRC --out $ICONSET_DIR/icon_16x16@2x.png
sips -z 128 128   $ICON_SRC --out $ICONSET_DIR/icon_128x128.png
sips -z 256 256   $ICON_SRC --out $ICONSET_DIR/icon_128x128@2x.png
iconutil -c icns $ICONSET_DIR -o assets/icon.icns
rm -r $ICONSET_DIR
echo "✅ assets/icon.icns generated successfully."