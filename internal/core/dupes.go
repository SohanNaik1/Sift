package core

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"lukechampine.com/blake3"
)

// DuplicateGroup represents a list of files that are identical
type DuplicateGroup struct {
	Hash  string   `json:"hash"`
	Files []string `json:"files"`
	Size  int64    `json:"size"`
}

// FindDuplicates scans directories and finds duplicate files
func FindDuplicates(dirs []string) ([]DuplicateGroup, error) {
	// Pass 1: Group by file size
	sizeMap := make(map[int64][]string)
	
	for _, dir := range dirs {
		if len(dir) > 0 && dir[0] == '~' {
			homeDir, _ := os.UserHomeDir()
			dir = filepath.Join(homeDir, dir[1:])
		}
		
		err := filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				name := info.Name()
				switch name {
				case ".git", ".svn", ".hg":
					return filepath.SkipDir
				case "node_modules", "dist", "out", "build", ".npm":
					return filepath.SkipDir
				case "vendor", "bin", "pkg":
					return filepath.SkipDir
				case ".dart_tool", ".gradle", "Pods", ".xcodeproj", ".xcworkspace":
					return filepath.SkipDir
				case ".cache", ".config", "AppData", "Temp", "Prefetch", ".Trash":
					return filepath.SkipDir
				case ".vscode", ".idea", ".lazy":
					return filepath.SkipDir
				}
				if strings.Contains(filepath.ToSlash(path), "/.local/share") {
					return filepath.SkipDir
				}
			} else {
				name := info.Name()
				if name == ".DS_Store" || name == "Thumbs.db" || strings.HasSuffix(name, ".o") || strings.HasSuffix(name, ".so") || strings.HasSuffix(name, ".a") {
					return nil // Skip this file by returning nil (Walk continues)
				}
				size := info.Size()
				if size > 0 { // Ignore empty files
					sizeMap[size] = append(sizeMap[size], path)
				}
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	
	// Filter out unique sizes (cannot be duplicates)
	var potentialDupes [][]string
	for _, paths := range sizeMap {
		if len(paths) > 1 {
			potentialDupes = append(potentialDupes, paths)
		}
	}
	
	// Pass 2: Hash files with identical sizes concurrently
	var result []DuplicateGroup
	var mu sync.Mutex
	var wg sync.WaitGroup
	
	// Limit concurrency to avoid too many open files
	sem := make(chan struct{}, 8)
	
	for _, paths := range potentialDupes {
		wg.Add(1)
		go func(filePaths []string) {
			defer wg.Done()
			
			hashMap := make(map[string][]string)
			var localMu sync.Mutex
			var fileWg sync.WaitGroup
			
			for _, path := range filePaths {
				fileWg.Add(1)
				go func(p string) {
					defer fileWg.Done()
					sem <- struct{}{}
					defer func() { <-sem }()
					
					hash, err := hashFile(p)
					if err == nil {
						localMu.Lock()
						hashMap[hash] = append(hashMap[hash], p)
						localMu.Unlock()
					}
				}(path)
			}
			fileWg.Wait()
			
			mu.Lock()
			for h, group := range hashMap {
				if len(group) > 1 {
					// Sort files within the group by oldest ModTime first
					sort.Slice(group, func(i, j int) bool {
						infoI, errI := os.Stat(group[i])
						infoJ, errJ := os.Stat(group[j])
						if errI == nil && errJ == nil {
							return infoI.ModTime().Before(infoJ.ModTime())
						}
						return group[i] < group[j] // fallback
					})
					
					// Get size for this group
					info, err := os.Stat(group[0])
					size := int64(0)
					if err == nil {
						size = info.Size()
					}
					
					result = append(result, DuplicateGroup{
						Hash:  h,
						Files: group,
						Size:  size,
					})
				}
			}
			mu.Unlock()
		}(paths)
	}
	
	wg.Wait()
	
	// Deterministic Sorting: Largest size first, then Hash alphabetically
	sort.Slice(result, func(i, j int) bool {
		if result[i].Size != result[j].Size {
			return result[i].Size > result[j].Size
		}
		return result[i].Hash < result[j].Hash
	})
	
	return result, nil
}

func hashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	
	hasher := blake3.New(32, nil)
	if _, err := io.Copy(hasher, f); err != nil {
		return "", err
	}
	
	return fmt.Sprintf("%x", hasher.Sum(nil)), nil
}
