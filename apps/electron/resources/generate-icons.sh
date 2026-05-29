#!/bin/bash

# Mroma Icon Generation Script
# Generates all required icon formats from icon.svg
# Requires: rsvg-convert (librsvg), iconutil (macOS), magick (ImageMagick)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🎨 Generating Mroma icons..."

# Check required tools
if ! command -v rsvg-convert &> /dev/null; then
    echo "❌ rsvg-convert not found. Install with: brew install librsvg"
    exit 1
fi

if ! command -v magick &> /dev/null; then
    echo "❌ ImageMagick (magick) not found. Install with: brew install imagemagick"
    exit 1
fi

if ! command -v iconutil &> /dev/null; then
    echo "⚠️  iconutil not found (macOS only). Skipping .icns generation"
fi

# 1. Generate icon.png (1024x1024) from SVG
echo "📦 Generating icon.png (1024x1024)..."
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png

# 2. Generate Linux icon set. electron-builder 要求 Linux 图标目录内的文件名带尺寸。
echo "📦 Generating Linux icon set..."
mkdir -p icons
for size in 16 24 32 48 64 128 256 512 1024; do
  rsvg-convert -w "$size" -h "$size" icon.svg -o "icons/${size}x${size}.png"
done

# 3. Generate menubar/tray icons (multi-resolution for Retina displays)
echo "📦 Generating tray icons..."

# macOS 托盘图标规范：
# - 标准尺寸: 22x22pt（点）
# - @2x Retina: 44x44px
# - @3x 高分辨率: 66x66px
# 使用 "Template" 命名让 macOS 自动适配深色/浅色菜单栏
TRAY_SVG="mroma-logos/icon.svg"

if [ ! -f "$TRAY_SVG" ]; then
  echo "⚠️  Tray icon SVG not found at $TRAY_SVG, skipping tray icon generation"
else
  # 生成多分辨率 Template 图标（macOS 会自动选择合适的版本）
  rsvg-convert -w 22 -h 22 "$TRAY_SVG" -o mroma-logos/iconTemplate.png
  rsvg-convert -w 44 -h 44 "$TRAY_SVG" -o "mroma-logos/iconTemplate@2x.png"
  rsvg-convert -w 66 -h 66 "$TRAY_SVG" -o "mroma-logos/iconTemplate@3x.png"

  echo "✅ Tray icons generated:"
  echo "   - mroma-logos/iconTemplate.png (22x22 @1x)"
  echo "   - mroma-logos/iconTemplate@2x.png (44x44 @2x Retina)"
  echo "   - mroma-logos/iconTemplate@3x.png (66x66 @3x)"
fi

# 4. Generate .icns (macOS app icon)
if command -v iconutil &> /dev/null; then
    echo "📦 Generating icon.icns..."

    # Create iconset directory
    mkdir -p icon.iconset

    # Generate all required sizes for macOS
    # Standard resolutions
    sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png      > /dev/null 2>&1
    sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png   > /dev/null 2>&1
    sips -z 32 32     icon.png --out icon.iconset/icon_32x32.png      > /dev/null 2>&1
    sips -z 64 64     icon.png --out icon.iconset/icon_32x32@2x.png   > /dev/null 2>&1
    sips -z 128 128   icon.png --out icon.iconset/icon_128x128.png    > /dev/null 2>&1
    sips -z 256 256   icon.png --out icon.iconset/icon_128x128@2x.png > /dev/null 2>&1
    sips -z 256 256   icon.png --out icon.iconset/icon_256x256.png    > /dev/null 2>&1
    sips -z 512 512   icon.png --out icon.iconset/icon_256x256@2x.png > /dev/null 2>&1
    sips -z 512 512   icon.png --out icon.iconset/icon_512x512.png    > /dev/null 2>&1
    sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png > /dev/null 2>&1

    # Convert to .icns
    iconutil -c icns icon.iconset -o icon.icns

    # Clean up
    rm -rf icon.iconset

    echo "✅ icon.icns generated"
else
    echo "⚠️  Skipping .icns generation (iconutil not available)"
fi

# 5. Generate .ico (Windows app icon)
echo "📦 Generating icon.ico..."
magick icon.png -define icon:auto-resize=256,128,96,64,48,32,16 icon.ico
echo "✅ icon.ico generated"

echo ""
echo "✅ All icons generated successfully!"
echo ""
echo "Generated files:"
echo "  - icon.png (1024x1024) - Linux & macOS Dock"
echo "  - icons/*.png - Linux desktop icon set"
echo "  - icon.icns - macOS app icon"
echo "  - icon.ico - Windows app icon"
echo "  - mroma-logos/iconTemplate.png - macOS tray (22x22 @1x)"
echo "  - mroma-logos/iconTemplate@2x.png - macOS tray (44x44 @2x Retina)"
echo "  - mroma-logos/iconTemplate@3x.png - macOS tray (66x66 @3x)"
