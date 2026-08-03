package tui

import (
	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

// StartDupes boots the Duplicate Resolver UI
func StartDupes(dirs []string) error {
	app := tview.NewApplication()

	// UI Panes
	hashList := tview.NewList().ShowSecondaryText(false)
	hashList.SetBorder(true).SetTitle(" Duplicate Groups (Hashes) ")

	fileList := tview.NewList().ShowSecondaryText(false)
	fileList.SetBorder(true).SetTitle(" Files in Group ")

	controls := tview.NewTextView().SetText(" [K] Keep Selected | [D] Delete Others | [Q] Quit ")
	controls.SetBorder(true)

	// TODO: Replace with actual DB query logic later
	hashList.AddItem("Waiting for core logic...", "", 0, nil)

	// Global Keybinds
	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		switch event.Rune() {
		case 'q', 'Q':
			app.Stop()
		}
		return event
	})

	// Main Layout Grid
	flex := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(tview.NewFlex().
			AddItem(hashList, 0, 1, true).
			AddItem(fileList, 0, 2, false), 0, 1, true).
		AddItem(controls, 3, 1, false)

	return app.SetRoot(flex, true).Run()
}
