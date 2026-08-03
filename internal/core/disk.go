package core

import (
	"io"
	"os"
)

// DeleteFile permanently sends a file to the shadow realm.
func DeleteFile(path string) error {
	return os.Remove(path)
}

// MoveFile attempts a fast rename, falls back to copy+delete for cross-drive.
func MoveFile(src, dest string) error {
	err := os.Rename(src, dest)
	if err == nil {
		return nil
	}
	return crossDeviceMove(src, dest)
}

// crossDeviceMove handles EXDEV errors when moving between different partitions.
func crossDeviceMove(src, dest string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}

	out, err := os.Create(dest)
	if err != nil {
		in.Close()
		return err
	}

	_, err = io.Copy(out, in)
	in.Close()
	out.Close()

	if err != nil {
		return err
	}
	return os.Remove(src)
}
