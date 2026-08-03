# Sift

A high-performance, keyboard-driven file triage TUI. Built for extreme efficiency, zero mouse movement, and rapid directory sorting.

## Installation

* Ensure Go is installed on your system.
* Clone this repository.
* Run `go build -o sift ./cmd/sift`.
* Move the compiled binary to a directory in your system `$PATH`.

## Usage

Launch Sift by passing your target directory via the command line flag.

`./sift triage -dir=~/Downloads`

### Global Keybindings
* **[1-9]**: Quick move file to pre-configured paths.
* **[M]**: Open Tree View to manually select a destination.
* **[W]**: Skip current file.
* **[R]**: Delete current file.
* **[V]**: View configured Quick Paths.
* **[Q]**: Quit the application.

### Tree View Controls
* **[Enter]**: Expand or collapse the selected directory.
* **[.]**: Toggle the visibility of dotfiles.
* **[Esc]**: Cancel movement and return to the main list.

## Configuration

Sift reads quick-move hotkeys from a `targets.json` configuration file.

* **Auto-generation**: A default template is generated automatically if the file does not exist.
* **Path Expansion**: Standard `~/` prefixes are natively supported and resolve to your system home directory.
* **Customization**: Edit the `targets.json` file to map your desired keys to preferred storage directories.
