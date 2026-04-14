
# CSV SplitView

CSV SplitView is a VS Code extension that shows CSV and TSV files in a side-by-side split interactive table.

## Features

- Split/side-by-side preview of CSV and TSV in a webview table.
- Click with Cmd (macOS) or Ctrl (Windows/Linux) on a cell to jump to the source field in the editor.
- Theme-aware colors using VS Code theme variables.
- Configurable row background mode with automatic light/dark detection.

## Commands

- `SplitView: Preview CSV` (`csv-splitview.preview`)

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

## License

MIT
