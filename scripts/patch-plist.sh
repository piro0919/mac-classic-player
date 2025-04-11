#!/bin/bash
PLIST_PATH="dist/mac-arm64/Mac Classic Player.app/Contents/Info.plist"

# Skip if already patched
if /usr/libexec/PlistBuddy -c "Print :CFBundleDocumentTypes" "$PLIST_PATH" &>/dev/null; then
  echo "Info.plist already patched. Skipping."
  exit 0
fi

echo "Patching Info.plist for supported file types..."

# Add document types
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes array" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0 dict" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeName string Media File" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:CFBundleTypeRole string Viewer" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes array" "$PLIST_PATH"

/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:0 string public.mpeg-4" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:1 string public.mp3" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:2 string public.wav" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:3 string public.m4a" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:4 string public.video" "$PLIST_PATH"
/usr/libexec/PlistBuddy -c "Add :CFBundleDocumentTypes:0:LSItemContentTypes:5 string public.audio" "$PLIST_PATH"

echo "✅ Info.plist patched."