#!/bin/bash
set -e

echo "=========================================="
echo "    Sift (Desktop & CLI) Installer        "
echo "=========================================="

# Check for Go
if ! command -v go &> /dev/null; then
    echo "[Error] Go is not installed. Please install Go 1.20+ first."
    exit 1
fi

# Check for Node.js
if ! command -v npm &> /dev/null; then
    echo "[Error] npm/Node.js is not installed. Required for building the GUI frontend."
    exit 1
fi

echo "[OK] Go and Node.js are installed."

# Ensure Wails CLI is installed
if ! command -v wails &> /dev/null; then
    echo "[Info] Wails CLI not found. Installing..."
    go install github.com/wailsapp/wails/v2/cmd/wails@latest
    export PATH=$PATH:$(go env GOPATH)/bin
fi

echo "[Info] Building Sift using Wails..."

BUILD_FLAGS=""
if command -v pkg-config &> /dev/null; then
    if ! pkg-config --exists webkit2gtk-4.0 && pkg-config --exists webkit2gtk-4.1; then
        echo "[Info] Detected webkit2gtk-4.1 instead of 4.0. Using -tags webkit2_41."
        BUILD_FLAGS="-tags webkit2_41"
    fi
fi

if ! command -v wails &> /dev/null; then
    $(go env GOPATH)/bin/wails build -clean $BUILD_FLAGS
else
    wails build -clean $BUILD_FLAGS
fi

# Clean up any residual Wails temporary directories
rm -rf sift-wails-tmp*

echo "[Success] Build complete!"

BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
cp build/bin/sift "$BIN_DIR/sift"

echo ""
echo "=========================================================="
echo " Sift is now installed to $BIN_DIR/sift"
echo ""
echo " You can now run Sift from anywhere in your terminal!"
echo "   GUI Mode: sift"
echo "   TUI Mode: sift triage -dir=/path/to/folder"
echo "=========================================================="
