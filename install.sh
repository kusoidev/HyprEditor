#!/usr/bin/env bash
set -Eeuo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="$HOME/.local/share/HyprEditor"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

print_header() {
  echo -e "${CYAN}"
  echo "  ╔══════════════════════════════════╗"
  echo "  ║        HyprEditor Installer      ║"
  echo "  ║   Visual Hyprland Config Editor  ║"
  echo "  ╚══════════════════════════════════╝"
  echo -e "${NC}"
}

die() {
  echo -e "\n${RED}Error:${NC} $1"
  exit 1
}

need_file() {
  local file="$1"
  [[ -f "$file" ]] || die "Missing required file: $file"
}

print_header

echo -e "${CYAN}[1/7] Checking prerequisites...${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${YELLOW}Node.js not found. Installing via pacman...${NC}"
  sudo pacman -S --noconfirm nodejs npm
fi

if ! command -v node >/dev/null 2>&1; then
  die "Node.js installation failed or is still unavailable."
fi

NODE_VER="$(node --version | sed 's/^v//' | cut -d. -f1)"
if [[ "$NODE_VER" -lt 18 ]]; then
  die "Node.js 18+ is required (found: $(node --version))."
fi
echo -e "${GREEN}✓ Node.js $(node --version) found${NC}"

if ! command -v npm >/dev/null 2>&1; then
  die "npm not found. Try: sudo pacman -S npm"
fi
echo -e "${GREEN}✓ npm $(npm --version) found${NC}"

echo -e "\n${CYAN}[2/7] Verifying project files...${NC}"

need_file "$SCRIPT_DIR/package.json"
need_file "$SCRIPT_DIR/main.ts"
need_file "$SCRIPT_DIR/preload.js"
need_file "$SCRIPT_DIR/build.mjs"
need_file "$SCRIPT_DIR/renderer/index.html"
need_file "$SCRIPT_DIR/renderer/style.css"
need_file "$SCRIPT_DIR/renderer/app.ts"
need_file "$SCRIPT_DIR/renderer/parser.ts"
need_file "$SCRIPT_DIR/renderer/schema.ts"
need_file "$SCRIPT_DIR/renderer/system.ts"
need_file "$SCRIPT_DIR/renderer/waybar.ts"
need_file "$SCRIPT_DIR/renderer/types.ts"
need_file "$SCRIPT_DIR/renderer/lockscreen/lockscreen.ts"
need_file "$SCRIPT_DIR/renderer/lockscreen/lockscreen-qs.css"
need_file "$SCRIPT_DIR/renderer/powermenu/powermenu.ts"
need_file "$SCRIPT_DIR/renderer/quicksettings/quicksettings.ts"

echo -e "${GREEN}✓ Required files found${NC}"

echo -e "\n${CYAN}[3/7] Installing build dependencies...${NC}"

cd "$SCRIPT_DIR"

if ! npm list esbuild --depth=0 >/dev/null 2>&1; then
  npm install --no-save esbuild
fi

echo -e "${GREEN}✓ Build dependencies ready${NC}"

echo -e "\n${CYAN}[4/7] Compiling TypeScript...${NC}"

cd "$SCRIPT_DIR"
node build.mjs || die "TypeScript compilation failed."

if [[ ! -f "$SCRIPT_DIR/dist/main.js" ]]; then
  die "Build output not found. Compilation may have failed silently."
fi

echo -e "${GREEN}✓ TypeScript compiled to dist/${NC}"

echo -e "\n${CYAN}[5/7] Installing files to $INSTALL_DIR...${NC}"

mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/renderer"
mkdir -p "$BIN_DIR"
mkdir -p "$APP_DIR"
mkdir -p "$INSTALL_DIR/renderer/lockscreen"
mkdir -p "$INSTALL_DIR/renderer/powermenu"
mkdir -p "$INSTALL_DIR/renderer/quicksettings"
mkdir -p "$INSTALL_DIR/renderer/applauncher"

cp "$SCRIPT_DIR/dist/main.js"              "$INSTALL_DIR/"
cp "$SCRIPT_DIR/dist/preload.js"           "$INSTALL_DIR/"
cp "$SCRIPT_DIR/dist/renderer/index.html" "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/style.css"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/app.js"     "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/waybar.js"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/parser.js"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/schema.js"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/dist/renderer/system.js"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/package.json"             "$INSTALL_DIR/"
cp "$SCRIPT_DIR/dist/renderer/lockscreen/lockscreen.js"      "$INSTALL_DIR/renderer/lockscreen/"
cp "$SCRIPT_DIR/dist/renderer/lockscreen/lockscreen-qs.css"  "$INSTALL_DIR/renderer/lockscreen/"
cp "$SCRIPT_DIR/dist/renderer/powermenu/powermenu.js"        "$INSTALL_DIR/renderer/powermenu/"
cp "$SCRIPT_DIR/dist/renderer/quicksettings/quicksettings.js" "$INSTALL_DIR/renderer/quicksettings/"
cp "$SCRIPT_DIR/dist/renderer/applauncher/applauncher.js" "$INSTALL_DIR/renderer/applauncher/"
[[ -f "$SCRIPT_DIR/package-lock.json" ]] && cp "$SCRIPT_DIR/package-lock.json" "$INSTALL_DIR/" || true

if [[ -d "$SCRIPT_DIR/dist/assets" ]]; then
  rm -rf "$INSTALL_DIR/assets"
  cp -r "$SCRIPT_DIR/dist/assets" "$INSTALL_DIR/"
elif [[ -d "$SCRIPT_DIR/assets" ]]; then
  rm -rf "$INSTALL_DIR/assets"
  cp -r "$SCRIPT_DIR/assets" "$INSTALL_DIR/"
fi

echo -e "${GREEN}✓ Files copied${NC}"

echo -e "\n${CYAN}[6/7] Installing npm dependencies...${NC}"

cd "$INSTALL_DIR"
npm install

if [[ ! -x "$INSTALL_DIR/node_modules/.bin/electron" ]]; then
  die "Electron binary was not installed correctly."
fi

echo -e "${GREEN}✓ Dependencies installed${NC}"

echo -e "\n${CYAN}[7/7] Creating launcher and desktop entry...${NC}"

cat > "$BIN_DIR/hypreditor" << EOF
#!/usr/bin/env bash
set -e
cd "$INSTALL_DIR"
exec "$INSTALL_DIR/node_modules/.bin/electron" . "\$@"
EOF

chmod +x "$BIN_DIR/hypreditor"

if [[ ! -x "$BIN_DIR/hypreditor" ]]; then
  die "Failed to create launcher at $BIN_DIR/hypreditor"
fi

cat > "$APP_DIR/hypreditor.desktop" << EOF
[Desktop Entry]
Version=1.0
Name=HyprEditor
Comment=Visual Hyprland configuration editor
Exec=$BIN_DIR/hypreditor
Icon=preferences-system
Terminal=false
Type=Application
Categories=Settings;System;Utility;
Keywords=hyprland;hypr;config;editor;wayland;tiling;
StartupNotify=true
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$APP_DIR" >/dev/null 2>&1 || true
fi

echo -e "${GREEN}✓ Launcher created at $BIN_DIR/hypreditor${NC}"
echo -e "${GREEN}✓ Desktop entry created${NC}"

echo -e "\n${GREEN}════════════════════════════════════${NC}"
echo -e "${GREEN}✓ HyprEditor installed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════${NC}"
echo ""

if [[ ":$PATH:" == *":$BIN_DIR:"* ]]; then
  echo -e "  Run with:  ${CYAN}hypreditor${NC}"
else
  echo -e "${YELLOW}⚠ $BIN_DIR is not currently in your PATH.${NC}"
  echo -e "  Run now with: ${CYAN}$BIN_DIR/hypreditor${NC}"
  echo -e "  To use ${CYAN}hypreditor${NC} directly, add this to your shell config:"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
  echo -e "  Then restart your terminal, or run:"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo ""
echo -e "  Or search: ${CYAN}HyprEditor${NC} in your app launcher"
echo ""
echo -e "${YELLOW}Tip:${NC} HyprEditor will try to auto-detect:"
echo -e "     ${CYAN}~/.config/hypr/hyprland.conf${NC}"
echo -e "     and included sourced config files when present."
echo -e "     A backup is saved as ${CYAN}.hypreditor.bak${NC} before every save."
echo ""