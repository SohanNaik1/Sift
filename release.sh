#!/bin/bash
set -e

echo "=========================================="
echo "    Sift Local Release Builder            "
echo "=========================================="

mkdir -p build/bin

echo "[1/3] Building Linux (Arch) Binary..."
# Passing webkit2_41 tag because you are compiling natively on Arch Linux
wails build -m -platform linux/amd64 -tags webkit2_41
mv build/bin/sift build/bin/sift-linux-amd64
echo "✅ Linux build complete!"

echo ""
echo "[2/3] Checking for Windows Cross-Compiler..."
if ! command -v x86_64-w64-mingw32-gcc &> /dev/null; then
    echo "⚠️  Windows cross-compiler not found!"
    echo "To build for Windows, please install MinGW by running:"
    echo "    sudo pacman -S mingw-w64-gcc"
    echo "Skipping Windows build..."
else
    echo "Compiling Windows Binary..."
    wails build -m -platform windows/amd64
    mv build/bin/sift.exe build/bin/sift-windows-amd64.exe
    echo "✅ Windows build complete!"
fi

echo ""
echo "[3/3] MacOS Compilation Note:"
echo "⚠️  Wails cannot natively cross-compile macOS binaries (.app) directly from Linux"
echo "   without complex third-party tools (osxcross). You will need access to a Mac"
echo "   to natively run 'wails build -m -platform darwin/universal'."

echo ""
echo "=========================================="
echo " Done! Check the build/bin/ folder."
echo "=========================================="
