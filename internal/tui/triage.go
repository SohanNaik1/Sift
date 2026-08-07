package tui

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

type TrashAction struct {
	OriginalPath string
	TrashPath    string
}

func getConfigPath() string {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".local", "share", "sift")
	os.MkdirAll(configDir, os.ModePerm)
	return filepath.Join(configDir, "targets.json")
}

func loadQuickTargets() map[rune]string {
	targets := make(map[rune]string)
	configPath := getConfigPath()

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		defaultConfig := []byte("{\n  \"1\": \"~/Downloads\",\n  \"2\": \"~/Pictures\"\n}")
		os.WriteFile(configPath, defaultConfig, 0644)
	}

	data, err := os.ReadFile(configPath)
	if err == nil {
		var strMap map[string]string
		if json.Unmarshal(data, &strMap) == nil {
			for k, v := range strMap {
				if len(k) > 0 {
					targets[rune(k[0])] = v
				}
			}
		}
	}
	return targets
}

func StartTriage(dir string) error {
	homeDir, _ := os.UserHomeDir()
	trashDir := filepath.Join(homeDir, ".local", "share", "sift", "trash")
	os.MkdirAll(trashDir, os.ModePerm)

	if len(dir) > 0 && dir[0] == '~' {
		dir = filepath.Join(homeDir, dir[1:])
	}

	app := tview.NewApplication()
	pages := tview.NewPages()

	fileList := tview.NewList().ShowSecondaryText(false)
	fileList.SetBorder(true).SetTitle(" Files (Triage) ")

	preview := tview.NewTextView().SetDynamicColors(true).SetWrap(true)
	preview.SetBorder(true).SetTitle(" Preview ")

	controls := tview.NewTextView().SetText(" [Enter] In/Open | [.] Dotfiles | [R] Trash | [U] Undo | [V] Paths | [Q] Quit ")
	controls.SetBorder(true)

	currentDir := dir
	showDotfiles := false
	var trashStack []TrashAction
	var activePreviewCmd *exec.Cmd

	killPreview := func() {
		if activePreviewCmd != nil && activePreviewCmd.Process != nil {
			activePreviewCmd.Process.Kill()
			activePreviewCmd.Process.Wait()
			activePreviewCmd = nil
		}
	}

	loadDir := func(targetDir string) {
		fileList.Clear()
		entries, err := os.ReadDir(targetDir)
		if err != nil {
			return
		}

		if targetDir != "/" {
			fileList.AddItem("[blue::b]../[-:-:-]", filepath.Dir(targetDir), 0, nil)
		}

		for _, e := range entries {
			if !showDotfiles && len(e.Name()) > 0 && e.Name()[0] == '.' {
				continue
			}

			displayName := e.Name()
			if e.IsDir() {
				displayName = fmt.Sprintf("[blue::b]%s/[-:-:-]", displayName)
			}

			fileList.AddItem(displayName, filepath.Join(targetDir, e.Name()), 0, nil)
		}
	}

	loadDir(currentDir)

	if fileList.GetItemCount() == 0 {
		return fmt.Errorf("directory empty or error reading")
	}

	fileList.SetChangedFunc(func(index int, mainText string, secondaryText string, shortcut rune) {
		preview.Clear()
		killPreview()

		info, err := os.Stat(secondaryText)
		if err != nil {
			fmt.Fprint(preview, "[red]Cannot read file.[-]")
			return
		}

		ext := filepath.Ext(secondaryText)
		format := "None"
		if ext != "" {
			format = strings.ToUpper(ext[1:])
		}

		sizeMB := float64(info.Size()) / (1024.0 * 1024.0)
		modTime := info.ModTime().Format("2006-01-02 15:04")
		perms := info.Mode().String()

		if info.IsDir() {
			fmt.Fprintf(preview, "Type:   [blue]Directory[-]\nFormat: Folder\nSize:   %.2f MB\nMod:    %s\nPerms:  %s\n\n[Directory Content Not Previewed]", sizeMB, modTime, perms)
			return
		}

		meta := fmt.Sprintf("Type:   [green]File[-]\nFormat: %s\nSize:   %.2f MB\nMod:    %s\nPerms:  %s\n\n", format, sizeMB, modTime, perms)
		fmt.Fprint(preview, meta)

		mimeBytes, _ := exec.Command("file", "-b", "--mime-type", secondaryText).Output()
		mime := strings.TrimSpace(string(mimeBytes))

		// FIX: Only read and preview the file if the OS explicitly confirms it is text.
		if strings.HasPrefix(mime, "text/") {
			f, err := os.Open(secondaryText)
			if err == nil {
				defer f.Close()
				buf := make([]byte, 512)
				n, _ := f.Read(buf)
				fmt.Fprintf(preview, "[yellow]Text Preview:[-]\n%s", string(buf[:n]))
			}
		}
	})

	fileList.SetSelectedFunc(func(index int, mainText string, secondaryText string, shortcut rune) {
		info, err := os.Stat(secondaryText)
		if err == nil && info.IsDir() {
			killPreview()
			currentDir = secondaryText
			loadDir(currentDir)
			return
		}

		mimeBytes, _ := exec.Command("file", "-b", "--mime-type", secondaryText).Output()
		mime := strings.TrimSpace(string(mimeBytes))

		if strings.HasPrefix(mime, "image/") {
			activePreviewCmd = exec.Command("imv", secondaryText)
			activePreviewCmd.Start()
		} else if strings.HasPrefix(mime, "video/") {
			activePreviewCmd = exec.Command("mpv", "--quiet", "--loop", "--no-audio", "--geometry=500x500", secondaryText)
			activePreviewCmd.Start()
		} else if strings.HasPrefix(mime, "application/pdf") {
			activePreviewCmd = exec.Command("zathura", secondaryText)
			activePreviewCmd.Start()
		} else {
			exec.Command("xdg-open", secondaryText).Start()
		}
	})

	quickTargets := loadQuickTargets()

	pathModal := tview.NewTextView().SetDynamicColors(true)
	pathModal.SetBorder(true).SetTitle(" Quick Paths ")

	pathText := "Configured Quick Paths:\n\n"
	for k, v := range quickTargets {
		pathText += fmt.Sprintf(" Key [%c] -> %s\n", k, v)
	}
	pathModal.SetText(pathText + "\nPress [Esc] or [V] to close.")

	pathModal.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEscape || event.Rune() == 'v' || event.Rune() == 'V' {
			pages.HidePage("paths")
			app.SetFocus(fileList)
			return nil
		}
		return event
	})

	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if pathModal.HasFocus() {
			return event
		}
		r := event.Rune()
		switch r {
		case 'q', 'Q':
			killPreview()
			os.RemoveAll(trashDir)
			app.Stop()
			return nil
		case 'v', 'V':
			pages.ShowPage("paths")
			app.SetFocus(pathModal)
			return nil
		case '.':
			showDotfiles = !showDotfiles
			loadDir(currentDir)
			return nil
		case 'u', 'U':
			if len(trashStack) > 0 {
				last := trashStack[len(trashStack)-1]
				os.Rename(last.TrashPath, last.OriginalPath)
				trashStack = trashStack[:len(trashStack)-1]
				loadDir(currentDir)
			}
			return nil
		case 'r', 'R':
			if fileList.GetItemCount() > 0 {
				idx := fileList.GetCurrentItem()
				_, targetPath := fileList.GetItemText(idx)
				if targetPath == filepath.Dir(currentDir) {
					return nil
				}

				dest := filepath.Join(trashDir, fmt.Sprintf("%d_%s", time.Now().Unix(), filepath.Base(targetPath)))
				if err := os.Rename(targetPath, dest); err == nil {
					killPreview()
					trashStack = append(trashStack, TrashAction{OriginalPath: targetPath, TrashPath: dest})
					loadDir(currentDir)
				}
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
					os.Rename(srcPath, destPath)
					killPreview()
					loadDir(currentDir)
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
	pages.AddPage("paths", pathModal, true, false)

	return app.SetRoot(pages, true).Run()
}
