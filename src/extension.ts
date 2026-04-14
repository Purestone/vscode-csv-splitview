import * as vscode from 'vscode';
import * as Papa from 'papaparse';
import * as path from 'path';
import { findCsvCellRange } from './csvCellRange';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentDocumentUri: vscode.Uri | undefined = undefined;
let updateTimer: NodeJS.Timeout | undefined = undefined;

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

        const config = vscode.workspace.getConfiguration('csv-splitview');
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

        currentPanel.webview.html = getWebviewContent(colors, {
            rowBackgroundMode,
            rowBgLightOdd,
            rowBgLightEven,
            rowBgDarkOdd,
            rowBgDarkEven
        });

        // Send data to webview
        currentPanel.webview.postMessage({
            command: 'setData',
            headers: parsed.meta.fields || [],
            data: parsed.data
        });
    };

    let disposable = vscode.commands.registerCommand('csv-splitview.preview', () => {
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
                    } else if (message.command === 'ready') {
                        updateWebview();
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
            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
                updateWebview();
            }, 300);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('csv-splitview')) {
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
    colors: string[],
    rowOptions: {
        rowBackgroundMode: 'auto' | 'light' | 'dark';
        rowBgLightOdd: string;
        rowBgLightEven: string;
        rowBgDarkOdd: string;
        rowBgDarkEven: string;
    }
): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV SplitView</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 0;
            margin: 0;
            height: 100vh;
            overflow: hidden;
        }
        #viewport {
            height: 100vh;
            width: 100vw;
            overflow: auto;
            position: relative;
        }
        #spacer {
            width: 1px;
            visibility: hidden;
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
            border-collapse: separate;
            border-spacing: 0;
            width: max-content;
            min-width: 100%;
            position: absolute;
            top: 0;
            left: 0;
            z-index: 1;
        }
        th, td {
            border-right: 1px solid var(--vscode-editorGroup-border);
            border-bottom: 1px solid var(--vscode-editorGroup-border);
            padding: 8px 12px;
            text-align: left;
            cursor: text;
            word-break: break-all;
            min-width: 80px;
            max-width: 800px;
            box-sizing: border-box;
        }
        th:first-child, td:first-child {
            border-left: 1px solid var(--vscode-editorGroup-border);
        }
        th {
            font-weight: bold;
            position: sticky;
            top: 0;
            z-index: 100;
            background-color: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-editorGroup-border);
            border-bottom: 2px solid var(--vscode-editorGroup-border);
        }
        
        tbody tr.odd td {
            background-color: var(--csv-row-bg-odd);
        }
        tbody tr.even td {
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

        #stats {
            position: fixed;
            bottom: 10px;
            right: 10px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-editorGroup-border);
            padding: 4px 8px;
            font-size: 10px;
            opacity: 0.7;
            z-index: 200;
        }
        .buffer-row td {
            padding: 0 !important;
            border: 0 !important;
            height: 0;
        }
    </style>
</head>
<body>
    <div id="viewport">
        <div id="spacer"></div>
        <table id="csvTable">
            <thead id="csvHeader"></thead>
            <tbody id="csvBody"></tbody>
        </table>
    </div>
    <div id="stats">Rows: 0</div>
    
    <script>
        const vscode = acquireVsCodeApi();
        const viewport = document.getElementById('viewport');
        const spacer = document.getElementById('spacer');
        const table = document.getElementById('csvTable');
        const header = document.getElementById('csvHeader');
        const body = document.getElementById('csvBody');
        const stats = document.getElementById('stats');
        const rowOptions = {
            rowBackgroundMode: '${rowOptions.rowBackgroundMode}'
        };

        let currentData = [];
        let currentHeaders = [];
        const AVG_ROW_HEIGHT = 37;
        const BUFFER_ROWS = 20;
        
        // --- High-Precision Canvas Measurement ---
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const lockedWidths = [];

        function measureCellWidth(text, isHeader = false) {
            const style = window.getComputedStyle(document.body);
            // Clean font string: remove any existing weight to avoid "bold 400" conflict
            const fontSize = style.fontSize || '13px';
            const fontFamily = style.fontFamily || 'monospace';
            ctx.font = (isHeader ? 'bold ' : 'normal ') + fontSize + ' ' + fontFamily;
            
            const metrics = ctx.measureText(text || '');
            return Math.ceil(metrics.width) + 28; // text + 24px padding + 4px extra buffer
        }

        function escapeHtml(value) {
            if (value === null || value === undefined) return '';
            return String(value)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

        function render() {
            if (currentData.length === 0) return;

            const scrollTop = viewport.scrollTop;
            const scrollLeft = viewport.scrollLeft;
            const viewportHeight = viewport.clientHeight;
            
            // 1. Identify Anchor Column Identifying
            const ths = Array.from(header.querySelectorAll('th'));
            const visibleCols = [];
            for (let i = 0; i < ths.length; i++) {
                if (ths[i].offsetLeft + ths[i].offsetWidth > scrollLeft) {
                    visibleCols.push({ index: i, offset: ths[i].offsetLeft - scrollLeft });
                    if (visibleCols.length >= 2) break; 
                }
            }
            const anchor = visibleCols.length >= 2 ? visibleCols[1] : (visibleCols[0] || { index: 0, offset: 0 });

            // 2. Scan and lock widths - including ensuring headers are accounted for
            let startIndex = Math.floor(scrollTop / AVG_ROW_HEIGHT) - BUFFER_ROWS;
            startIndex = Math.max(0, startIndex);
            let endIndex = Math.ceil((scrollTop + viewportHeight) / AVG_ROW_HEIGHT) + BUFFER_ROWS;
            endIndex = Math.min(currentData.length, endIndex);

            // Double check headers in case font was not ready earlier
            if (currentHeaders.length > 0) {
                for (let j = 0; j < currentHeaders.length; j++) {
                    const headerW = measureCellWidth(currentHeaders[j], true);
                    if (headerW > (lockedWidths[j] || 0)) lockedWidths[j] = headerW;
                }
            }

            for (let i = startIndex; i < endIndex; i++) {
                const row = currentData[i];
                for (let j = 0; j < currentHeaders.length; j++) {
                    const val = row[currentHeaders[j]];
                    const w = measureCellWidth(val);
                    if (w > (lockedWidths[j] || 0)) {
                        lockedWidths[j] = w;
                    }
                }
            }
            
            // Apply locked widths
            ths.forEach((th, i) => {
                const w = Math.min(800, lockedWidths[i]) + 'px';
                if (th.style.width !== w) {
                    th.style.width = w;
                    th.style.minWidth = w;
                }
            });

            // 3. Render content
            const offsetY = startIndex * AVG_ROW_HEIGHT;
            let html = '<tr class="buffer-row" style="height:' + offsetY + 'px"><td colspan="' + currentHeaders.length + '"></td></tr>';
            
            for (let i = startIndex; i < endIndex; i++) {
                const row = currentData[i];
                const rowClass = (i % 2 === 0) ? 'even' : 'odd';
                let cells = '';
                for (let j = 0; j < currentHeaders.length; j++) {
                    const h = currentHeaders[j];
                    const val = row[h] !== undefined ? row[h] : '';
                    cells += '<td data-row="' + i + '" data-col="' + j + '">' + escapeHtml(val) + '</td>';
                }
                html += '<tr class="' + rowClass + '">' + cells + '</tr>';
            }
            body.innerHTML = html;

            // 4. Anchor position correction
            requestAnimationFrame(() => {
                const finalThs = header.querySelectorAll('th');
                if (finalThs[anchor.index]) {
                    const newOffsetLeft = finalThs[anchor.index].offsetLeft;
                    viewport.scrollLeft = newOffsetLeft - anchor.offset;
                }
            });
        }

        viewport.addEventListener('scroll', render);
        window.addEventListener('resize', render);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'setData') {
                currentHeaders = message.headers;
                currentData = message.data;
                
                // Reset state
                lockedWidths.length = 0;
                currentHeaders.forEach((h, i) => {
                    lockedWidths[i] = measureCellWidth(h, true);
                });

                spacer.style.height = (currentData.length * AVG_ROW_HEIGHT) + AVG_ROW_HEIGHT + 'px';
                stats.textContent = 'Rows: ' + currentData.length;

                let headerHtml = '<tr>';
                for (let i = 0; i < currentHeaders.length; i++) {
                    const w = Math.min(800, lockedWidths[i]) + 'px';
                    headerHtml += '<th data-col="' + i + '" style="width:' + w + '; min-width:' + w + '">' + escapeHtml(currentHeaders[i]) + '</th>';
                }
                headerHtml += '</tr>';
                header.innerHTML = headerHtml;

                render();
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
                        vscode.postMessage({ command: 'locateCell', row, col });
                    }
                }
            }
        });

        const updateHoverCursor = (event) => {
            document.body.classList.toggle('cmd-hover', Boolean(event.metaKey || event.ctrlKey));
        };
        document.addEventListener('mousemove', updateHoverCursor);
        document.addEventListener('keydown', (e) => (e.metaKey || e.ctrlKey) && document.body.classList.add('cmd-hover'));
        document.addEventListener('keyup', (e) => !e.metaKey && !e.ctrlKey && document.body.classList.remove('cmd-hover'));

        const applyRowTheme = () => {
            document.body.classList.remove('row-theme-light', 'row-theme-dark');
            const isLightTheme = document.body.classList.contains('vscode-light') ||
                               document.body.classList.contains('vscode-high-contrast-light');
            if (rowOptions.rowBackgroundMode === 'light') document.body.classList.add('row-theme-light');
            else if (rowOptions.rowBackgroundMode === 'dark') document.body.classList.add('row-theme-dark');
            else document.body.classList.add(isLightTheme ? 'row-theme-light' : 'row-theme-dark');
        };
        applyRowTheme();
        vscode.postMessage({ command: 'ready' });
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
