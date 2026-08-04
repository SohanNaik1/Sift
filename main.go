package main

import (
	"embed"
	"log"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"

	"sift/internal/cli"
	"sift/internal/gui"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	if len(os.Args) > 1 {
		// Run the terminal CLI/TUI if arguments are passed
		cli.Execute()
		return
	}

	// Create an instance of the app structure
	app := gui.NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:  "Sift GUI",
		Width:  1024,
		Height: 768,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: gui.NewFilePreviewHandler(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.Startup,
		Bind: []interface{}{
			app,
			gui.NewController(),
		},
	})

	if err != nil {
		log.Fatal("Error starting GUI:", err.Error())
	}
}
