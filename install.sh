#!/bin/bash
# openclaw-context-hygiene install script
#
# Usage:
#   ./install.sh              # Install from current directory
#   ./install.sh --uninstall   # Uninstall
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK_NAME="context-hygiene"
HOOK_DIR="$HOME/.openclaw/hooks/$HOOK_NAME"

uninstall() {
    echo "Removing $HOOK_DIR..."
    rm -rf "$HOOK_DIR"
    echo "✅ Uninstalled."
    echo "Restart the gateway: openclaw gateway restart"
    exit 0
}

# Parse arguments
if [[ "${1:-}" == "--uninstall" ]]; then
    uninstall
fi

echo "Installing openclaw-context-hygiene..."

# Check openclaw exists
if ! command -v openclaw &> /dev/null; then
    echo "Error: openclaw command not found. Is OpenClaw installed?"
    exit 1
fi

# Check hook source exists
if [[ ! -f "$SCRIPT_DIR/index.js" ]]; then
    echo "Error: index.js not found in $SCRIPT_DIR"
    exit 1
fi

# Remove old installation
if [[ -d "$HOOK_DIR" ]]; then
    echo "Removing old installation..."
    rm -rf "$HOOK_DIR"
fi

# Copy files
echo "Copying hook files to $HOOK_DIR..."
mkdir -p "$HOOK_DIR"
cp "$SCRIPT_DIR/HOOK.md" "$SCRIPT_DIR/index.js" "$SCRIPT_DIR/package.json" "$HOOK_DIR/"

echo ""
echo "✅ openclaw-context-hygiene installed!"
echo ""
echo "Restart the gateway to load:"
echo "   openclaw gateway restart"
echo ""
echo "Verify:"
echo "   openclaw hooks list | grep context-hygiene"
