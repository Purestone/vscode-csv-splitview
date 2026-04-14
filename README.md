
# CSV SplitView

[![GitHub Repo](https://img.shields.io/badge/repo-github.com%2FPurestone%2Fvscode--csv--splitview-blue?logo=github)](https://github.com/Purestone/vscode-csv-splitview)

CSV SplitView is a VS Code extension that lets you preview CSV and TSV files in a true side-by-side (split view) interactive table, making it easy to compare data and source at a glance.

## Features

- True split/side-by-side preview: See your CSV/TSV file as a colorful table right next to the raw text.
- Click with Cmd (macOS) or Ctrl (Windows/Linux) on a cell to instantly jump to the corresponding field in the editor.
- Theme-aware colors using VS Code theme variables.
- Configurable row background mode with automatic light/dark detection.

## Commands

- `CSV SplitView: Preview CSV` (`csv-splitview.preview`)

## Settings

- `csv-splitview.colors`: Column color palette.
- `csv-splitview.rowBackgroundMode`: `auto`, `light`, or `dark`.
- `csv-splitview.rowBackgroundLightOdd`: Light theme odd row color.
- `csv-splitview.rowBackgroundLightEven`: Light theme even row color.
- `csv-splitview.rowBackgroundDarkOdd`: Dark theme odd row color.
- `csv-splitview.rowBackgroundDarkEven`: Dark theme even row color.

## Development

1. Install dependencies:
   npm install
2. Build:
   npm run compile
3. Debug:
   Run the `Run Extension` launch target in VS Code.

## Repository

<https://github.com/Purestone/vscode-csv-splitview>

## License

MIT
