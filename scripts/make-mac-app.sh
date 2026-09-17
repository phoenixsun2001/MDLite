#!/usr/bin/env bash
# 将 cargo 构建产物打包为 macOS .app（含图标与 .md 文档类型声明）
# 用法: 在 macOS 上执行  bash scripts/make-mac-app.sh
set -euo pipefail
cd "$(dirname "$0")/../src-tauri"

cargo build --release

APP="target/release/bundle/MDLite.app"
BIN="target/release/mdlite"
[[ -x "$BIN" ]] || { echo "未找到 $BIN，请先 cargo build --release"; exit 1; }

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cp "$BIN" "$APP/Contents/MacOS/MDLite"
cp icons/icon.icns "$APP/Contents/Resources/mdlite.icns"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key>              <string>MDLite</string>
    <key>CFBundleDisplayName</key>       <string>MDLite</string>
    <key>CFBundleIdentifier</key>        <string>com.geoq.mdlite</string>
    <key>CFBundleVersion</key>           <string>1.0.0</string>
    <key>CFBundleShortVersionString</key><string>1.0.0</string>
    <key>CFBundleExecutable</key>        <string>MDLite</string>
    <key>CFBundlePackageType</key>       <string>APPL</string>
    <key>CFBundleIconFile</key>          <string>mdlite</string>
    <key>NSHighResolutionCapable</key>   <true/>
    <key>CFBundleDocumentTypes</key>
    <array>
        <dict>
            <key>CFBundleTypeName</key>        <string>Markdown Document</string>
            <key>CFBundleTypeRole</key>        <string>Viewer</string>
            <key>LSHandlerRank</key>           <string>Alternate</string>
            <key>CFBundleTypeExtensions</key>
            <array>
                <string>md</string>
                <string>markdown</string>
                <string>mdown</string>
                <string>mkd</string>
                <string>txt</string>
            </array>
        </dict>
    </array>
</dict>
</plist>
PLIST

codesign --force --deep --sign - "$APP" 2>/dev/null || true

echo "完成: $(pwd)/$APP"
echo "文件关联: 右键 .md → 显示简介 → 打开方式 → MDLite → 全部更改"
