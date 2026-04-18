
# CSV SplitView

CSV SplitView is a high-performance VS Code extension that lets you preview CSV and TSV files in a true side-by-side (split view) interactive table. It is designed to be lightweight and zero-config, with state management handled directly in the status bar for minimum memory overhead.



## Features

- **True split/side-by-side preview:** See your CSV/TSV file as a colorful table right next to the raw text.
- **Smart Status Bar:** Real-time Ln/Col coordinates and total row/column counts shown directly in the VS Code status bar.
- **Hover Tracking:** Instantly see the coordinates of the cell under your mouse cursor.
- **Jump to Source:** `Cmd + Click` (macOS) or `Ctrl + Click` (Windows/Linux) on any cell to instantly jump to the corresponding field in the raw editor.
- **Zero Config Theming:** Automatically adapts to your VS Code theme (Light, Dark, and High Contrast).
- **High Performance:** Uses specialized streaming parsing and virtual rendering to handle large files smoothly.

## Commands

- `CSV SplitView: Preview CSV` (`csv-splitview.preview`)

## Settings

- `csv-splitview.colors`: Column color palette (supports VS Code theme variables).
- `csv-splitview.autoReleaseTimeout`: Automatically close the preview when hidden to save memory.

## Development

1. Install dependencies:
   `npm install`
2. Build:
   `npm run compile`
3. Debug:
   Run the `Extension` launch target in VS Code.

## Install & Repository

[Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Purestone.csv-splitview)

[GitHub Repo](https://github.com/Purestone/vscode-csv-splitview)

## License

[MIT](LICENSE)
