package gui

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// FilePreviewHandler implements the Wails assetserver.Handler interface.
// It allows the frontend to load local files by requesting /local/<path>
type FilePreviewHandler struct{}

func NewFilePreviewHandler() *FilePreviewHandler {
	return &FilePreviewHandler{}
}

func (h *FilePreviewHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// Only handle requests to /local/
	if !strings.HasPrefix(r.URL.Path, "/local/") {
		w.WriteHeader(http.StatusNotFound)
		return
	}

	// Extract the actual file path by removing the "/local/" prefix
	filePath := strings.TrimPrefix(r.URL.Path, "/local/")
	
	// Open the local file
	f, err := os.Open(filePath)
	if err != nil {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	defer f.Close()
	
	// Get file info for Content-Length
	stat, err := f.Stat()
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	
	// We use standard http.ServeContent which handles range requests.
	// WebKit sometimes struggles if Content-Type isn't explicitly set for videos.
	ext := strings.ToLower(filepath.Ext(stat.Name()))
	switch ext {
	case ".mp4":
		w.Header().Set("Content-Type", "video/mp4")
	case ".webm":
		w.Header().Set("Content-Type", "video/webm")
	case ".mkv":
		w.Header().Set("Content-Type", "video/x-matroska")
	case ".pdf":
		w.Header().Set("Content-Type", "application/pdf")
	case ".png":
		w.Header().Set("Content-Type", "image/png")
	case ".jpg", ".jpeg":
		w.Header().Set("Content-Type", "image/jpeg")
	}

	http.ServeContent(w, r, stat.Name(), stat.ModTime(), f)
}
