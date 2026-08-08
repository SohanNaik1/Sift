package gui

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"sift/internal/core"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	goruntime "runtime"
)

type Controller struct {
	ctx context.Context
}

func NewController() *Controller {
	return &Controller{}
}

// Startup is called when the app starts
func (c *Controller) Startup(ctx context.Context) {
	c.ctx = ctx
}

func (c *Controller) Quit() {
	if c.ctx != nil {
		runtime.Quit(c.ctx)
	}
}

// CheckForUpdates calls the GitHub API to check for newer tags
func (c *Controller) CheckForUpdates(currentVersion string) string {
	resp, err := http.Get("https://api.github.com/repos/SohanNaik1/Sift/releases/latest")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusOK {
		var result struct {
			TagName string `json:"tag_name"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&result); err == nil {
			if result.TagName != "" && result.TagName != currentVersion {
				return result.TagName
			}
		}
	}
	return ""
}

type FileEntry struct {
	Name        string  `json:"name"`
	Path        string  `json:"path"`
	IsDir       bool    `json:"isDir"`
	SizeMB      float64 `json:"sizeMB"`
	ModTime     string  `json:"modTime"`
	Perms       string  `json:"perms"`
	PreviewType string  `json:"previewType"`
	Mime        string  `json:"mime"`
	Ext         string  `json:"ext"`
	IsHidden    bool    `json:"isHidden"`
}

type PreviewData struct {
	Text string `json:"text"`
}

func (c *Controller) ListFiles(dir string) ([]FileEntry, error) {
	if len(dir) > 0 && dir[0] == '~' {
		homeDir, _ := os.UserHomeDir()
		dir = filepath.Join(homeDir, dir[1:])
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}

	var results []FileEntry
	if dir != "/" {
		results = append(results, FileEntry{
			Name:  "../",
			Path:  filepath.Dir(dir),
			IsDir: true,
		})
	}

	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(dir, e.Name())
		sizeMB := float64(info.Size()) / (1024.0 * 1024.0)
		modTime := info.ModTime().Format("2006-01-02 15:04")
		
		var mimeStr string
		var previewType = "none"

		if !e.IsDir() {
			ext := strings.ToLower(filepath.Ext(fullPath))
			mimeStr = mime.TypeByExtension(ext)
			if mimeStr == "" {
				f, err := os.Open(fullPath)
				if err == nil {
					buffer := make([]byte, 512)
					n, _ := f.Read(buffer)
					mimeStr = http.DetectContentType(buffer[:n])
					f.Close()
				}
			}

			if strings.HasPrefix(mimeStr, "image/") {
				previewType = "image"
			} else if strings.HasPrefix(mimeStr, "video/") {
				previewType = "video"
			} else if strings.HasPrefix(mimeStr, "application/pdf") {
				previewType = "pdf"
			} else if strings.HasPrefix(mimeStr, "text/") || mimeStr == "inode/x-empty" || mimeStr == "application/json" {
				previewType = "text"
			} else if strings.HasPrefix(mimeStr, "application/vnd.openxmlformats") || strings.HasPrefix(mimeStr, "application/msword") || strings.HasSuffix(strings.ToLower(e.Name()), ".docx") || strings.HasSuffix(strings.ToLower(e.Name()), ".pptx") {
				previewType = "document"
			}
		} else {
			previewType = "directory"
		}

		results = append(results, FileEntry{
			Name:        e.Name(),
			Path:        fullPath,
			IsDir:       e.IsDir(),
			SizeMB:      sizeMB,
			ModTime:     modTime,
			Perms:       info.Mode().String(),
			PreviewType: previewType,
			Mime:        mimeStr,
			Ext:         filepath.Ext(e.Name()),
			IsHidden:    strings.HasPrefix(e.Name(), "."),
		})
	}
	return results, nil
}

// GetFilePreview returns text content for previewing files
func (c *Controller) GetFilePreview(path string) PreviewData {
	ext := strings.ToLower(filepath.Ext(path))

	// Fast path for raw text
	if ext == ".txt" || ext == ".md" || ext == ".go" || ext == ".json" || ext == ".ts" || ext == ".html" || ext == ".css" || ext == ".js" || ext == ".sh" || ext == ".xml" {
		return PreviewData{Text: readTextSnippet(path)}
	}

	// Office document parsing
	if ext == ".docx" {
		return PreviewData{Text: parseZipXML(path, "word/document.xml")}
	}
	if ext == ".pptx" {
		// PPTX splits slides, just grab slide 1 for preview
		return PreviewData{Text: parseZipXML(path, "ppt/slides/slide1.xml")}
	}

	// Fallback to text reading
	mimeBytes, _ := exec.Command("file", "-b", "--mime-type", path).Output()
	if strings.HasPrefix(string(mimeBytes), "text/") {
		return PreviewData{Text: readTextSnippet(path)}
	}

	return PreviewData{Text: "No text preview available."}
}

func readTextSnippet(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	buf := make([]byte, 2048)
	n, _ := f.Read(buf)
	return string(buf[:n])
}

// stripXML tags removes all XML tags to get raw text
func stripXML(xmlContent string) string {
	re := regexp.MustCompile(`<[^>]*>`)
	text := re.ReplaceAllString(xmlContent, " ")
	
	// Collapse multiple spaces
	reSpaces := regexp.MustCompile(`\s+`)
	text = reSpaces.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func parseZipXML(zipPath, internalFilePath string) string {
	r, err := zip.OpenReader(zipPath)
	if err != nil {
		return "Unable to read document."
	}
	defer r.Close()

	for _, f := range r.File {
		if f.Name == internalFilePath {
			rc, err := f.Open()
			if err != nil {
				return "Unable to open document file."
			}
			defer rc.Close()

			buf, err := io.ReadAll(rc)
			if err != nil {
				return "Error reading document."
			}
			
			rawText := stripXML(string(buf))
			if len(rawText) > 2000 {
				return rawText[:2000] + "..."
			}
			return rawText
		}
	}
	return "No text content found."
}

func getConfigPath() string {
	homeDir, _ := os.UserHomeDir()
	configDir := filepath.Join(homeDir, ".local", "share", "sift")
	os.MkdirAll(configDir, os.ModePerm)
	return filepath.Join(configDir, "targets.json")
}

func (c *Controller) GetQuickTargets() map[string]string {
	targets := make(map[string]string)
	configPath := getConfigPath()

	if _, err := os.Stat(configPath); os.IsNotExist(err) {
		return map[string]string{"1": "~/Downloads", "2": "~/Pictures"}
	}

	data, err := os.ReadFile(configPath)
	if err == nil {
		json.Unmarshal(data, &targets)
	}
	return targets
}

func (c *Controller) PinTarget(path string) map[string]string {
	targets := c.GetQuickTargets()
	
	// Check if already pinned, if so, unpin it
	for k, v := range targets {
		if v == path {
			delete(targets, k)
			data, err := json.MarshalIndent(targets, "", "  ")
			if err == nil {
				os.WriteFile(getConfigPath(), data, 0644)
			}
			return targets
		}
	}

	// Find first available slot 1-9
	for i := 1; i <= 9; i++ {
		key := fmt.Sprintf("%d", i)
		if _, exists := targets[key]; !exists {
			targets[key] = path
			break
		}
	}
	
	// Save
	data, err := json.MarshalIndent(targets, "", "  ")
	if err == nil {
		os.WriteFile(getConfigPath(), data, 0644)
	}
	
	return targets
}

func (c *Controller) GetTrashPath() string {
	homeDir, _ := os.UserHomeDir()
	return filepath.Join(homeDir, ".local", "share", "sift", "trash")
}

func (c *Controller) TrashFile(path string) error {
	trashDir := c.GetTrashPath()
	os.MkdirAll(trashDir, os.ModePerm)

	dest := filepath.Join(trashDir, fmt.Sprintf("%d_%s", time.Now().Unix(), filepath.Base(path)))
	return core.MoveFile(path, dest)
}

func (c *Controller) MoveFile(src, destDir string) error {
	if len(destDir) > 0 && destDir[0] == '~' {
		homeDir, _ := os.UserHomeDir()
		relativePath := destDir[1:]
		relativePath = strings.TrimPrefix(relativePath, "/")
		relativePath = strings.TrimPrefix(relativePath, "\\")
		destDir = filepath.Join(homeDir, relativePath)
	}
	os.MkdirAll(destDir, os.ModePerm)
	destPath := filepath.Join(destDir, filepath.Base(src))
	return core.MoveFile(src, destPath)
}

func (c *Controller) PickDirectory() string {
	if c.ctx == nil {
		return ""
	}
	dir, err := runtime.OpenDirectoryDialog(c.ctx, runtime.OpenDialogOptions{
		Title: "Select Destination Directory",
	})
	if err != nil {
		return ""
	}
	return dir
}

func (c *Controller) OpenNative(path string) error {
	// Simple fallback to xdg-open on Linux (or open on Mac, start on Windows)
	var cmd *exec.Cmd
	switch goruntime.GOOS {
	case "windows":
		cmd = exec.Command("cmd", "/c", "start", "", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	return cmd.Start()
}

func (c *Controller) FindDuplicates(dirs []string) ([]core.DuplicateGroup, error) {
	return core.FindDuplicates(dirs)
}
