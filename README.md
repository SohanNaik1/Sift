# Sift (Parallel Desktop Edition)

A high-performance, keyboard-driven file triage application. Built for extreme efficiency, zero mouse movement, and rapid directory sorting. It now features a blazing-fast **Wails Desktop GUI** while perfectly retaining the original, untouchable **Terminal TUI**.

## Architecture
Sift is distributed as a unified binary:
- Passing arguments (e.g., `sift triage .`) will trigger the untouched Terminal TUI.
- Passing zero arguments (e.g., double-clicking `sift`) will launch the rich Wails Desktop GUI.

## Installation

Sift is a native, cross-platform application that runs flawlessly on Linux, Windows, and macOS.

### 1. Pre-Built Releases (Recommended)
You do not need to clone this repository or install dependencies to use the app. Sift is distributed with a fully automated CI/CD pipeline.
1. Navigate to the [GitHub Releases](https://github.com/SohanNaik1/Sift/releases) page.
2. Download the official installer for your operating system (e.g., `sift-windows-installer.exe`, `sift-mac-universal.app.tar.gz`, or `sift-linux-amd64`).
3. Run the installer or binary!

### Method 2: Build from Source (Arch Linux & Others)
Due to how rolling-release distributions (like Arch Linux) handle WebKitGTK versions, downloading the Ubuntu-built binary from GitHub may result in a missing `webkit2gtk-4.0` library error. **Arch users should always compile from source.**

Our automated `install.sh` script detects your system's libraries (automatically utilizing `webkit2gtk-4.1` for Arch) and compiles Sift flawlessly.

**Prerequisites:**
- **Go 1.20+** 
- **Node.js & npm** 
- **Wails CLI** (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`)

**Linux Only:** You must install WebKitGTK dev packages to compile the windowing environment.
- **Ubuntu/Debian**: `sudo apt install libgtk-3-dev libwebkit2gtk-4.0-dev pkg-config`
- **Arch/Manjaro**: `sudo pacman -S base-devel pkgconf gtk3 webkit2gtk-4.1 gst-plugins-good gst-plugins-bad gst-plugins-ugly gst-libav`
*(Note: Arch users should always compile from source using `./install.sh` to ensure compatibility with `webkit2gtk-4.1`).*
- **Fedora**: `sudo dnf install webkit2gtk4.0-devel gtk3-devel`
- **openSUSE**: `sudo zypper in webkit2gtk3-devel gtk3-devel`

*(Note: MacOS and Windows do not require extra graphical dependencies.)*

Run the included installation script to handle Wails bindings, frontend building, and final compilation automatically:

```bash
chmod +x install.sh
./install.sh
```

Once built, move it to your PATH:
```bash
sudo cp build/bin/sift /usr/local/bin/
```

## Usage

### Desktop GUI Mode
Launch Sift without any arguments to open the premium Wails Desktop UI.
```bash
sift
```
* **[Arrow Keys]**: Navigate through the file list.
* **[1-9]**: Quick move the selected file to pre-configured paths.
* **[R]**: Move the selected file to the internal Sift Trash.
* **[Enter]**: Open directory or file.
* **[?]**: Open Hotkeys & Quick Paths modal.

### Terminal TUI Mode
The Terminal UI (TUI) is fully intact and allows you to rapidly triage files via SSH or entirely from the terminal. 
To access it, you **must** pass the `triage` command along with a target directory:
```bash
sift triage -dir=/path/to/folder
```

**Global TUI Keybindings:**
* **[1-9]**: Quick move file to pre-configured paths.
* **[M]**: Open Tree View to manually select a destination.
* **[W]**: Skip current file.
* **[R]**: Delete current file.
* **[V]**: View configured Quick Paths.
* **[Q]**: Quit the application.

## Configuration

Sift reads quick-move hotkeys from a `targets.json` configuration file, shared seamlessly between the CLI and the GUI.

* **Auto-generation**: A default template is generated automatically if the file does not exist.
* **Path Expansion**: Standard `~/` prefixes are natively supported and resolve to your system home directory.
* **Customization**: Edit the `targets.json` file to map your desired keys to preferred storage directories.

## Telemetry & Auto-Updates
Sift is a production-ready application featuring:
- **Sentry Crash Telemetry**: Silent logging of fatal panics. (Requires compiling with a valid DSN in `main.go`).
- **Auto-Updater**: Sift silently pings the GitHub API on startup and presents a sleek UI banner if a new release is available.
- **Automated Installers**: Powered by GitHub Actions, releasing a new tag automatically compiles NSIS Windows installers and MacOS bundles.
