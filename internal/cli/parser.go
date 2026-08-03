package cli

import (
	"flag"
	"fmt"
	"os"

	"sift/internal/tui"
)

// Execute handles command-line arguments and launches TUI modes
func Execute() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	triageCmd := flag.NewFlagSet("triage", flag.ExitOnError)
	triageDir := triageCmd.String("dir", ".", "Directory to triage")

	dupeCmd := flag.NewFlagSet("dupes", flag.ExitOnError)

	switch os.Args[1] {
	case "triage", "scan":
		triageCmd.Parse(os.Args[2:])
		// Launches full-screen Triage TUI (Move / Withhold / Remove + Preview)
		if err := tui.StartTriage(*triageDir); err != nil {
			fmt.Printf("Error starting triage mode: %v\n", err)
			os.Exit(1)
		}

	case "dupes":
		dupeCmd.Parse(os.Args[2:])
		dirs := dupeCmd.Args()

		// Positional arguments enforce cross-folder dupe checking
		if len(dirs) < 2 {
			fmt.Println("Error: 'dupes' requires at least 2 distinct directories to compare across.")
			fmt.Println("Usage: sift dupes <dir1> <dir2> [dir3...]")
			os.Exit(1)
		}

		// Launches full-screen Multi-folder Duplicate TUI
		if err := tui.StartDupes(dirs); err != nil {
			fmt.Printf("Error starting duplicate finder: %v\n", err)
			os.Exit(1)
		}

	default:
		fmt.Printf("Unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Println("Sift - High-performance local file triage & optimizer")
	fmt.Println("Usage:")
	fmt.Println("  sift triage [-dir=path]       Interactive file-by-file triage with preview")
	fmt.Println("  sift dupes <dir1> <dir2> ...  Cross-folder duplicate detector (ignores intra-folder dupes)")
}
