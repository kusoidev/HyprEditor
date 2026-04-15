#!/usr/bin/env bash
# HyprEditor Installer for CachyOS / Arch Linux
set -e

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

INSTALL_DIR="$HOME/.local/share/HyprEditor"
BIN_DIR="$HOME/.local/bin"
APP_DIR="$HOME/.local/share/applications"

echo -e "${CYAN}"
echo "  ╔══════════════════════════════════╗"
echo "  ║        HyprEditor Installer      ║"
echo "  ║   Visual Hyprland Config Editor  ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${NC}"

# ── Check prerequisites ──────────────────────────────────────────────────────
echo -e "${CYAN}[1/5] Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Node.js not found. Installing via pacman...${NC}"
  sudo pacman -S --noconfirm nodejs npm
fi

NODE_VER=$(node --version | tr -d 'v' | cut -d. -f1)
if [ "$NODE_VER" -lt 18 ]; then
  echo -e "${RED}Node.js 18+ is required (found: $(node --version))${NC}"
  echo "Run: sudo pacman -S nodejs npm"
  exit 1
fi
echo -e "${GREEN}✓ Node.js $(node --version) found${NC}"

if ! command -v npm &> /dev/null; then
  echo -e "${RED}npm not found. Run: sudo pacman -S npm${NC}"
  exit 1
fi
echo -e "${GREEN}✓ npm $(npm --version) found${NC}"

# ── Copy files ───────────────────────────────────────────────────────────────
echo -e "\n${CYAN}[2/5] Installing to $INSTALL_DIR...${NC}"

mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/renderer"

# Copy all app files (script is in the HyprEditor source dir)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$SCRIPT_DIR/package.json"         "$INSTALL_DIR/"
cp "$SCRIPT_DIR/main.js"              "$INSTALL_DIR/"
cp "$SCRIPT_DIR/preload.js"           "$INSTALL_DIR/"
cp "$SCRIPT_DIR/renderer/index.html"  "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/renderer/style.css"   "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/renderer/app.js"      "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/renderer/parser.js"   "$INSTALL_DIR/renderer/"
cp "$SCRIPT_DIR/renderer/schema.js"   "$INSTALL_DIR/renderer/"

echo -e "${GREEN}✓ Files copied${NC}"

# ── Install npm dependencies ─────────────────────────────────────────────────
echo -e "\n${CYAN}[3/5] Installing npm dependencies (this may take a moment)...${NC}"
cd "$INSTALL_DIR"
npm install --save-dev electron@latest 2>&1 | grep -E '(added|error|warn)' || true
echo -e "${GREEN}✓ Dependencies installed${NC}"

# ── Create launcher script ───────────────────────────────────────────────────
echo -e "\n${CYAN}[4/5] Creating launcher...${NC}"

mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/hypreditor" << EOF
#!/usr/bin/env bash
cd "$INSTALL_DIR"
exec ./node_modules/.bin/electron . "\$@"
EOF
chmod +x "$BIN_DIR/hypreditor"
echo -e "${GREEN}✓ Launcher at $BIN_DIR/hypreditor${NC}"

# ── Create .desktop entry ────────────────────────────────────────────────────
echo -e "\n${CYAN}[5/5] Creating application entry...${NC}"

mkdir -p "$APP_DIR"
cat > "$APP_DIR/hypreditor.desktop" << EOF
[Desktop Entry]
Name=HyprEditor
Comment=Visual Hyprland Configuration Editor
Exec=$BIN_DIR/hypreditor
Icon=preferences-system
Terminal=false
Type=Application
Categories=Settings;System;
Keywords=hyprland;config;wayland;tiling;
StartupWMClass=HyprEditor
EOF
echo -e "${GREEN}✓ Desktop entry created${NC}"

# ── PATH check ───────────────────────────────────────────────────────────────
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
  echo -e "\n${YELLOW}⚠ $BIN_DIR is not in your PATH."
  echo -e "  Add this to your ~/.bashrc or ~/.zshrc:${NC}"
  echo -e "  ${CYAN}export PATH=\"\$HOME/.local/bin:\$PATH\"${NC}"
fi

echo -e "\n${GREEN}════════════════════════════════════${NC}"
echo -e "${GREEN}✓ HyprEditor installed successfully!${NC}"
echo -e "${GREEN}════════════════════════════════════${NC}"
echo ""
echo -e "  Run with:  ${CYAN}hypreditor${NC}"
echo -e "  Or search: ${CYAN}HyprEditor${NC} in your app launcher"
echo ""
echo -e "${YELLOW}Tip:${NC} Your config is auto-detected at ~/.config/hypr/hyprland.conf"
echo -e "     A backup is saved as ${CYAN}.hypreditor.bak${NC} before every save."
echo ""
