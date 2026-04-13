# CSV Preview

CSV Preview is a VS Code extension that shows CSV and TSV files in a side-by-side interactive table.

## Features

- Preview CSV and TSV in a webview table.
- Click with Cmd (macOS) or Ctrl (Windows/Linux) on a cell to jump to the source field in the editor.
- Theme-aware colors using VS Code theme variables.
- Configurable row background mode with automatic light/dark detection.

## Commands

- `CSV Preview: Preview CSV` (`csv-preview.preview`)

## Settings

- `csv-preview.colors`: Column color palette.
- `csv-preview.rowBackgroundMode`: `auto`, `light`, or `dark`.
- `csv-preview.rowBackgroundLightOdd`: Light theme odd row color.
- `csv-preview.rowBackgroundLightEven`: Light theme even row color.
- `csv-preview.rowBackgroundDarkOdd`: Dark theme odd row color.
- `csv-preview.rowBackgroundDarkEven`: Dark theme even row color.

## Development

1. Install dependencies:

   npm install

2. Build:

   npm run compile

3. Debug:

   Run the `Run Extension` launch target in VS Code.

## License

MIT
