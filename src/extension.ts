import * as vscode from 'vscode';
import * as Papa from 'papaparse';
import * as path from 'path';
import { findCsvCellRange } from './csvCellRange';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentDocumentUri: vscode.Uri | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    const updateWebview = () => {
        if (!currentPanel || !currentDocumentUri) return;
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === currentDocumentUri?.toString());
        if (!editor) return;

        const text = editor.document.getText();
        const parsed = Papa.parse(text, {
            header: true,
            skipEmptyLines: false
        });

        const config = vscode.workspace.getConfiguration('csv-preview');
        const colors = config.get<string[]>('colors', [
            'var(--vscode-editor-foreground)',
            'var(--vscode-symbolIcon-keywordForeground)',
            'var(--vscode-symbolIcon-functionForeground)',
            'var(--vscode-descriptionForeground)',
            'var(--vscode-symbolIcon-stringForeground)',
            'var(--vscode-symbolIcon-variableForeground)',
            'var(--vscode-symbolIcon-constantForeground)',
            'var(--vscode-symbolIcon-classForeground)',
            'var(--vscode-editor-foreground)',
            'var(--vscode-editorError-foreground)'
        ]);

        const rowBackgroundMode = config.get<'auto' | 'light' | 'dark'>('rowBackgroundMode', 'auto');
        const rowBgLightOdd = config.get<string>('rowBackgroundLightOdd', 'rgba(0, 0, 0, 0.05)');
        const rowBgLightEven = config.get<string>('rowBackgroundLightEven', 'rgba(0, 0, 0, 0.02)');
        const rowBgDarkOdd = config.get<string>('rowBackgroundDarkOdd', 'rgba(255, 255, 255, 0.06)');
        const rowBgDarkEven = config.get<string>('rowBackgroundDarkEven', 'rgba(255, 255, 255, 0.03)');

        currentPanel.webview.html = getWebviewContent(parsed.meta.fields || [], parsed.data as any[], colors, {
            rowBackgroundMode,
            rowBgLightOdd,
            rowBgLightEven,
            rowBgDarkOdd,
            rowBgDarkEven
        });
    };

    let disposable = vscode.commands.registerCommand('csv-preview.preview', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor found.');
            return;
        }

        const document = editor.document;
        if (document.languageId !== 'csv' && document.languageId !== 'tsv' && !document.fileName.endsWith('.csv')) {
            vscode.window.showErrorMessage('Please open a CSV or TSV file first.');
            return;
        }

        currentDocumentUri = document.uri;

        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Beside);
            updateWebview();
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'csvPreview',
                `Preview: ${path.basename(document.fileName)}`,
                vscode.ViewColumn.Beside,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            currentPanel.onDidDispose(() => {
                currentPanel = undefined;
                currentDocumentUri = undefined;
            }, null, context.subscriptions);

            currentPanel.webview.onDidReceiveMessage(
                message => {
                    if (message.command === 'locateCell') {
                        const row = message.row;
                        const col = message.col;
                        revealCell(currentDocumentUri, row, col);
                    }
                },
                undefined,
                context.subscriptions
            );

            updateWebview();
        }
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        if (currentDocumentUri && event.document.uri.toString() === currentDocumentUri.toString()) {
            updateWebview();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('csv-preview')) {
            updateWebview();
        }
    }, null, context.subscriptions);

    vscode.window.onDidChangeActiveColorTheme(() => {
        updateWebview();
    }, null, context.subscriptions);

    context.subscriptions.push(disposable);
}

function revealCell(uri: vscode.Uri | undefined, rowIndex: number, colIndex: number) {
    if (!uri) return;

    const delimiter = uri.fsPath.endsWith('.tsv') ? '\t' : ',';
    const targetRow = rowIndex + 1; // Header row is 0, first data row is 1.
    if (targetRow < 0 || colIndex < 0) return;

    const activateAndReveal = (document: vscode.TextDocument, viewColumn?: vscode.ViewColumn) => {
        const range = findCsvCellRange(document.getText(), targetRow, colIndex, delimiter);
        if (!range) return;

        const startPos = document.positionAt(range.start);
        const endPos = document.positionAt(range.end);
        const selection = new vscode.Selection(startPos, endPos);

        vscode.window.showTextDocument(document, { viewColumn, preview: false, preserveFocus: false }).then(editor => {
            editor.selection = selection;
            editor.revealRange(selection, vscode.TextEditorRevealType.InCenter);
        });
    };

    const existingEditor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === uri.toString());
    if (existingEditor) {
        activateAndReveal(existingEditor.document, existingEditor.viewColumn);
        return;
    }

    vscode.workspace.openTextDocument(uri).then(document => {
        activateAndReveal(document);
    });
}

function getWebviewContent(
    headers: string[],
    data: any[],
    colors: string[],
    rowOptions: {
        rowBackgroundMode: 'auto' | 'light' | 'dark';
        rowBgLightOdd: string;
        rowBgLightEven: string;
        rowBgDarkOdd: string;
        rowBgDarkEven: string;
    }
): string {
    const tableHeaders = headers.map((h, i) => `<th data-col="${i}">${escapeHtml(h)}</th>`).join('');

    const tableRows = data.map((row, index) => {
        const cells = headers.map((h, colIndex) => {
            const val = row[h] !== undefined ? row[h] : '';
            return `<td data-row="${index}" data-col="${colIndex}">${escapeHtml(String(val))}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV Preview</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 20px;
            overflow: auto;
        }
        body.row-theme-light {
            --csv-row-bg-odd: ${rowOptions.rowBgLightOdd};
            --csv-row-bg-even: ${rowOptions.rowBgLightEven};
        }
        body.row-theme-dark {
            --csv-row-bg-odd: ${rowOptions.rowBgDarkOdd};
            --csv-row-bg-even: ${rowOptions.rowBgDarkEven};
        }
        table {
            border-collapse: collapse;
            width: 100%;
            margin-top: 20px;
        }
        th, td {
            border: 1px solid var(--vscode-editorGroup-border);
            padding: 8px 12px;
            text-align: left;
            cursor: text;
        }
        th {
            font-weight: bold;
            position: sticky;
            top: 0;
            z-index: 1;
            border-bottom: 2px solid var(--vscode-editorGroup-border);
        }
        
        /* Alternating Row Backgrounds */
        tbody tr:nth-child(odd) td {
            background-color: var(--csv-row-bg-odd);
        }
        tbody tr:nth-child(even) td {
            background-color: var(--csv-row-bg-even);
        }

        /* Rainbow CSV Column Colors */
        ${colors.map((color, index) => `
            td:nth-child(${colors.length}n+${index + 1}),
            th:nth-child(${colors.length}n+${index + 1}) {
                color: ${color};
            }
        `).join('')}

        td:hover {
            outline: 1px solid var(--vscode-editorGroup-border);
        }

        body.cmd-hover th,
        body.cmd-hover td {
            cursor: pointer;
        }
    </style>
</head>
<body>
    <table id="csvTable">
        <thead>
            <tr>${tableHeaders}</tr>
        </thead>
        <tbody>
            ${tableRows}
        </tbody>
    </table>
    
    <script>
        const vscode = acquireVsCodeApi();
        const table = document.getElementById('csvTable');
        const rowBackgroundMode = '${rowOptions.rowBackgroundMode}';

        const applyRowTheme = () => {
            document.body.classList.remove('row-theme-light', 'row-theme-dark');
            if (rowBackgroundMode === 'light') {
                document.body.classList.add('row-theme-light');
                return;
            }
            if (rowBackgroundMode === 'dark') {
                document.body.classList.add('row-theme-dark');
                return;
            }

            const isLightTheme = document.body.classList.contains('vscode-light') ||
                document.body.classList.contains('vscode-high-contrast-light');
            document.body.classList.add(isLightTheme ? 'row-theme-light' : 'row-theme-dark');
        };

        applyRowTheme();

        const updateHoverCursor = (event) => {
            document.body.classList.toggle('cmd-hover', Boolean(event.metaKey || event.ctrlKey));
        };

        table.addEventListener('mousemove', updateHoverCursor);
        table.addEventListener('mouseleave', () => {
            document.body.classList.remove('cmd-hover');
        });

        document.addEventListener('keydown', (event) => {
            if (event.metaKey || event.ctrlKey) {
                document.body.classList.add('cmd-hover');
            }
        });

        document.addEventListener('keyup', (event) => {
            if (!event.metaKey && !event.ctrlKey) {
                document.body.classList.remove('cmd-hover');
            }
        });
        
        table.addEventListener('click', (event) => {
            if (event.ctrlKey || event.metaKey) {
                let target = event.target;
                if (target.tagName !== 'TD' && target.tagName !== 'TH') {
                    target = target.closest('td, th');
                }
                
                if (target && (target.tagName === 'TD' || target.tagName === 'TH')) {
                    const row = parseInt(target.getAttribute('data-row') || '-1', 10);
                    const col = parseInt(target.getAttribute('data-col') || '-1', 10);
                    if (row !== -1 && col !== -1) {
                        vscode.postMessage({
                            command: 'locateCell',
                            row: row,
                            col: col
                        });
                    } else if (target.tagName === 'TH' && col !== -1) {
                         vscode.postMessage({
                            command: 'locateCell',
                            row: -1, // Header row
                            col: col
                        });
                    }
                }
            }
        });
    </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function deactivate() { }
