package tui

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sift/internal/core"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func loadQuickTargets() map[rune]string {
	targets := make(map[rune]string)
	configPath := "targets.json"

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		defaultConfig := []byte("{\n  \"1\": \"~/Downloads\",\n  \"2\": \"~/Pictures\"\n}")
		os.WriteFile(configPath, defaultConfig, 0644)
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		return targets
	}

	var strMap map[string]string
	if json.Unmarshal(data, &strMap) == nil {
		for k, v := range strMap {
			if len(k) > 0 {
				targets[rune(k[0])] = v
			}
		}
	}
	return targets
}

func StartTriage(dir string) error {
	homeDir, _ := os.UserHomeDir()

	// Fix the exact bug from your screenshot: manually expand the tilde
	if len(dir) > 0 && dir[0] == '~' {
		dir = filepath.Join(homeDir, dir[1:])
	}

	app := tview.NewApplication()
	pages := tview.NewPages()

	fileList := tview.NewList().ShowSecondaryText(false)
	fileList.SetBorder(true).SetTitle(" Files (Triage) ")

	preview := tview.NewTextView().SetDynamicColors(true).SetWrap(true)
	preview.SetBorder(true).SetTitle(" Preview (First 512 bytes) ")

	controls := tview.NewTextView().SetText(" [1-9] Quick | [V] View Paths | [M] Tree Move | [W] Skip | [R] Trash | [Q] Quit ")
	controls.SetBorder(true)

	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			fileList.AddItem(filepath.Base(path), path, 0, nil)
		}
		return nil
	})

	if err != nil || fileList.GetItemCount() == 0 {
		return fmt.Errorf("directory empty or error reading")
	}

	fileList.SetChangedFunc(func(index int, mainText string, secondaryText string, shortcut rune) {
		f, err := os.Open(secondaryText)
		if err != nil {
			preview.SetText(fmt.Sprintf("[red]Error: %v", err))
			return
		}
		defer f.Close()
		buf := make([]byte, 512)
		n, _ := f.Read(buf)
		preview.SetText(string(buf[:n]))
	})

	fileList.SetCurrentItem(0)
	quickTargets := loadQuickTargets()

	// ---------------- TREE VIEW MODAL ----------------
	showDotfiles := false
	treeRoot := tview.NewTreeNode(homeDir).SetReference(homeDir)
	tree := tview.NewTreeView().SetRoot(treeRoot).SetCurrentNode(treeRoot)
	tree.SetBorder(true).SetTitle(" Select Destination (Enter: Expand | M: Move | .: Toggle Dotfiles | Esc: Cancel) ")

	loadChildren := func(target *tview.TreeNode, path string) {
		target.ClearChildren()
		entries, err := os.ReadDir(path)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() {
					// Drop dotfiles if the toggle is false
					if !showDotfiles && len(e.Name()) > 0 && e.Name()[0] == '.' {
						continue
					}
					child := tview.NewTreeNode(e.Name()).
						SetReference(filepath.Join(path, e.Name())).
						SetSelectable(true)
					target.AddChild(child)
				}
			}
		}
	}
	loadChildren(treeRoot, homeDir)

	tree.SetSelectedFunc(func(node *tview.TreeNode) {
		if len(node.GetChildren()) == 0 {
			loadChildren(node, node.GetReference().(string))
		}
		node.SetExpanded(!node.IsExpanded())
	})

	tree.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEscape || event.Rune() == 'q' {
			pages.HidePage("tree")
			app.SetFocus(fileList)
			return nil
		}
		// The dotfile toggle logic
		if event.Rune() == '.' {
			showDotfiles = !showDotfiles
			loadChildren(treeRoot, homeDir)
			tree.SetCurrentNode(treeRoot)
			return nil
		}
		if event.Rune() == 'm' || event.Rune() == 'M' {
			if fileList.GetItemCount() > 0 {
				destDir := tree.GetCurrentNode().GetReference().(string)
				idx := fileList.GetCurrentItem()
				_, srcPath := fileList.GetItemText(idx)
				destPath := filepath.Join(destDir, filepath.Base(srcPath))
				core.MoveFile(srcPath, destPath)
				removeCurrentItem(fileList)
				pages.HidePage("tree")
				app.SetFocus(fileList)
				return nil
			}
		}
		return event
	})

	// ---------------- QUICK PATHS MODAL ----------------
	pathText := "Configured Quick Paths:\n\n"
	counter := 1
	for k, v := range quickTargets {
		pathText += fmt.Sprintf(" %d. Key [%c] -> %s\n", counter, k, v)
		counter++
	}
	pathText += "\nPress [Esc] or [V] to close."

	pathModal := tview.NewTextView().SetText(pathText).SetDynamicColors(true)
	pathModal.SetBorder(true).SetTitle(" Quick Paths ")

	pathModal.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEscape || event.Rune() == 'v' || event.Rune() == 'V' {
			pages.HidePage("paths")
			app.SetFocus(fileList)
			return nil
		}
		return event
	})

	// ---------------- GLOBAL KEYBINDS ----------------
	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if tree.HasFocus() || pathModal.HasFocus() {
			return event
		}
		r := event.Rune()
		switch r {
		case 'q', 'Q':
			app.Stop()
			return nil
		case 'v', 'V':
			pages.ShowPage("paths")
			app.SetFocus(pathModal)
			return nil
		case 'm', 'M':
			pages.ShowPage("tree")
			app.SetFocus(tree)
			return nil
		case 'w', 'W':
			removeCurrentItem(fileList)
			return nil
		case 'r', 'R':
			if fileList.GetItemCount() > 0 {
				idx := fileList.GetCurrentItem()
				_, srcPath := fileList.GetItemText(idx)
				core.DeleteFile(srcPath)
				removeCurrentItem(fileList)
			}
			return nil
		default:
			if targetDir, exists := quickTargets[r]; exists {
				if fileList.GetItemCount() > 0 {
					idx := fileList.GetCurrentItem()
					_, srcPath := fileList.GetItemText(idx)

					if len(targetDir) > 0 && targetDir[0] == '~' {
						targetDir = filepath.Join(homeDir, targetDir[1:])
					}

					destPath := filepath.Join(targetDir, filepath.Base(srcPath))
					os.MkdirAll(targetDir, os.ModePerm)
					core.MoveFile(srcPath, destPath)
					removeCurrentItem(fileList)
					return nil
				}
			}
		}
		return event
	})

	flex := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(tview.NewFlex().
			AddItem(fileList, 0, 1, true).
			AddItem(preview, 0, 2, false), 0, 1, true).
		AddItem(controls, 3, 1, false)

	pages.AddPage("main", flex, true, true)

	treeFlex := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(tree, 0, 4, true).
			AddItem(nil, 0, 1, false), 0, 2, true).
		AddItem(nil, 0, 1, false)
	pages.AddPage("tree", treeFlex, true, false)

	pathFlex := tview.NewFlex().
		AddItem(nil, 0, 1, false).
		AddItem(tview.NewFlex().SetDirection(tview.FlexRow).
			AddItem(nil, 0, 1, false).
			AddItem(pathModal, 0, 2, true).
			AddItem(nil, 0, 1, false), 0, 1, true).
		AddItem(nil, 0, 1, false)
	pages.AddPage("paths", pathFlex, true, false)

	return app.SetRoot(pages, true).Run()
}

func removeCurrentItem(l *tview.List) {
	idx := l.GetCurrentItem()
	if l.GetItemCount() > 0 {
		l.RemoveItem(idx)
	}
}
