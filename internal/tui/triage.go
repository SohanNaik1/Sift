package tui

import (
	"fmt"
	"os"
	"path/filepath"
	"sift/internal/core"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

// StartTriage boots the 3-pane Ranger-style file inspector
func StartTriage(dir string) error {
	app := tview.NewApplication()

	// UI Panes
	fileList := tview.NewList().ShowSecondaryText(false)
	fileList.SetBorder(true).SetTitle(" Files (Triage) ")

	preview := tview.NewTextView().SetDynamicColors(true).SetWrap(true)
	preview.SetBorder(true).SetTitle(" Preview (First 512 bytes) ")

	controls := tview.NewTextView().SetText(" [M] Move | [W] Withhold | [R] Remove | [Q] Quit ")
	controls.SetBorder(true)

	// Load Files Recursively
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			fileList.AddItem(path, "", 0, nil)
		}
		return nil
	})

	if err != nil {
		return err
	}

	if fileList.GetItemCount() == 0 {
		return fmt.Errorf("directory is empty or only contains folders")
	}

	// Dynamic Preview Trigger
	fileList.SetChangedFunc(func(index int, mainText string, secondaryText string, shortcut rune) {
		fullPath := mainText
		f, err := os.Open(fullPath)
		if err != nil {
			preview.SetText(fmt.Sprintf("[red]Error: %v", err))
			return
		}
		defer f.Close()

		buf := make([]byte, 512)
		n, _ := f.Read(buf)
		preview.SetText(string(buf[:n]))
	})

	// Force initial preview load
	fileList.SetCurrentItem(0)

	// Modal Definition - Must be declared BEFORE input capture to avoid scope panic
	pages := tview.NewPages()
	inputModal := tview.NewInputField().
		SetLabel(" Destination Path: ").
		SetFieldWidth(40)

	// Global Keybinds wired to physical disk
	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		switch event.Rune() {
		case 'q', 'Q':
			app.Stop()
		case 'm', 'M': // Move
			if fileList.GetItemCount() > 0 {
				pages.ShowPage("modal")
				app.SetFocus(inputModal)
			}
		case 'w', 'W': // Withhold (Skip)
			removeCurrentItem(fileList)
		case 'r', 'R': // Remove
			if fileList.GetItemCount() > 0 {
				idx := fileList.GetCurrentItem()
				name, _ := fileList.GetItemText(idx)
				// name is already the absolute path from WalkDir, no need to join
				core.DeleteFile(name)
				removeCurrentItem(fileList)
			}
		}
		return event
	})

	// Main Layout Grid
	flex := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(tview.NewFlex().
			AddItem(fileList, 0, 1, true).
			AddItem(preview, 0, 2, false), 0, 1, true).
		AddItem(controls, 3, 1, false)

	// Mount Pages
	pages.AddPage("main", flex, true, true)
	pages.AddPage("modal", inputModal, true, false)

	return app.SetRoot(pages, true).Run()
}

// removeCurrentItem pops the active file from the UI list
func removeCurrentItem(l *tview.List) {
	idx := l.GetCurrentItem()
	if l.GetItemCount() > 0 {
		l.RemoveItem(idx)
	}
}
