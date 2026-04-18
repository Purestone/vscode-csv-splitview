import * as vscode from 'vscode';
import * as Papa from 'papaparse';
import * as path from 'path';
import * as fs from 'fs';
import { Readable } from 'stream';
import { findCsvCellRange } from './csvCellRange';

let currentPanel: vscode.WebviewPanel | undefined = undefined;
let currentDocumentUri: vscode.Uri | undefined = undefined;
let updateTimer: NodeJS.Timeout | undefined = undefined;
let autoReleaseTimer: NodeJS.Timeout | undefined = undefined;
let statusBarItem: vscode.StatusBarItem | undefined = undefined;

let lastOptionsKey = '';
let currentStreamId = 0;

let statsState = {
    totalRows: 0,
    totalCols: 0,
    currentRow: -1,
    currentCol: -1
};

function updateStatusBar() {
    if (!statusBarItem) return;

    if (!currentPanel) {
        statusBarItem.hide();
        return;
    }

    const rowStr = statsState.currentRow >= 0 ? `Ln ${statsState.currentRow + 1}` : '--';
    const colStr = statsState.currentCol >= 0 ? `Col ${statsState.currentCol + 1}` : '--';
    const totalRowStr = statsState.totalRows > 0 ? statsState.totalRows.toLocaleString() : '0';
    const totalColStr = statsState.totalCols > 0 ? statsState.totalCols.toLocaleString() : '0';

    statusBarItem.text = `$(table) ${rowStr}, ${colStr} (${totalRowStr} rows, ${totalColStr} cols)`;
    statusBarItem.show();
}

export function activate(context: vscode.ExtensionContext) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBarItem);

    const startAutoReleaseTimer = () => {
        if (autoReleaseTimer) clearTimeout(autoReleaseTimer);
        const config = vscode.workspace.getConfiguration('csv-splitview');
        const timeout = config.get<number>('autoReleaseTimeout', 0);
        if (timeout > 0 && currentPanel) {
            autoReleaseTimer = setTimeout(() => {
                if (currentPanel && !currentPanel.visible) {
                    currentPanel.dispose();
                }
            }, timeout * 1000);
        }
    };

    const stopAutoReleaseTimer = () => {
        if (autoReleaseTimer) {
            clearTimeout(autoReleaseTimer);
            autoReleaseTimer = undefined;
        }
    };

    const updateWebview = async (forceReloadHtml: boolean = false) => {
        if (!currentPanel || !currentDocumentUri) return;
        const editor = vscode.window.visibleTextEditors.find(e => e.document.uri.toString() === currentDocumentUri?.toString());
        if (!editor) return;

        const config = vscode.workspace.getConfiguration('csv-splitview', currentDocumentUri || null);
        const markdownConfig = vscode.workspace.getConfiguration('markdown.preview', currentDocumentUri || null);
        const colors = config.get<string[]>('colors', []);
        const fontFamily = markdownConfig.get<string>('fontFamily', 'var(--vscode-font-family)');
        
        const optionsKey = JSON.stringify({ colors, fontFamily });
        
        if (forceReloadHtml || optionsKey !== lastOptionsKey) {
            currentPanel.webview.html = getWebviewContent(colors, fontFamily);
            lastOptionsKey = optionsKey;
            return;
        }

        const streamId = ++currentStreamId;
        const document = editor.document;
        
        let inputStream: Readable;
        if (document.isDirty) {
            inputStream = Readable.from(document.getText());
        } else {
            inputStream = fs.createReadStream(document.uri.fsPath);
        }

        let headers: string[] | null = null;
        let colCount = 0;
        let isFirstBatch = true;
        const encoder = new TextEncoder();

        statsState.totalRows = 0;
        statsState.totalCols = 0;
        updateStatusBar();

        Papa.parse(inputStream, {
            header: false,
            skipEmptyLines: false,
            chunkSize: 1024 * 512, // 512KB chunks for steady parsing
            chunk: (results, parser) => {
                if (streamId !== currentStreamId) {
                    parser.abort();
                    return;
                }

                const rows = results.data as string[][];
                if (rows.length === 0) return;

                let dataStart = 0;
                if (!headers) {
                    headers = rows[0];
                    colCount = headers.length;
                    dataStart = 1;
                    
                    statsState.totalCols = colCount;
                    currentPanel?.webview.postMessage({
                        command: 'startData',
                        headers,
                        colCount
                    });
                }

                const batchRows = rows.slice(dataStart);
                if (batchRows.length === 0) return;

                const rowCount = batchRows.length;
                statsState.totalRows += rowCount;
                updateStatusBar();

                let totalByteLength = 0;
                for (const row of batchRows) {
                    for (let j = 0; j < colCount; j++) {
                        totalByteLength += Buffer.byteLength(row[j] || '', 'utf8');
                    }
                }

                const textBuffer = new Uint8Array(totalByteLength);
                const offsetBuffer = new Uint32Array(rowCount * colCount * 2);
                let currentByteOffset = 0;
                let cellIdx = 0;

                for (const row of batchRows) {
                    for (let j = 0; j < colCount; j++) {
                        const val = row[j] || '';
                        const encoded = encoder.encode(val);
                        textBuffer.set(encoded, currentByteOffset);
                        offsetBuffer[cellIdx * 2] = currentByteOffset;
                        offsetBuffer[cellIdx * 2 + 1] = encoded.length;
                        currentByteOffset += encoded.length;
                        cellIdx++;
                    }
                }

                currentPanel?.webview.postMessage({
                    command: 'appendData',
                    rowCount,
                    textBuffer: textBuffer.buffer,
                    offsetBuffer: offsetBuffer.buffer
                });
            },
            complete: () => {
                if (streamId === currentStreamId) {
                    updateStatusBar();
                    currentPanel?.webview.postMessage({ command: 'endData' });
                }
            }
        });
    };

    let disposable = vscode.commands.registerCommand('csv-splitview.preview', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const document = editor.document;
        currentDocumentUri = document.uri;

        if (currentPanel) {
            currentPanel.reveal(vscode.ViewColumn.Beside);
            updateWebview(false);
        } else {
            currentPanel = vscode.window.createWebviewPanel(
                'csvPreview',
                `Preview: ${path.basename(document.fileName)}`,
                vscode.ViewColumn.Beside,
                { enableScripts: true, retainContextWhenHidden: false }
            );

            currentPanel.onDidDispose(() => {
                stopAutoReleaseTimer();
                currentPanel = undefined;
                currentDocumentUri = undefined;
                lastOptionsKey = '';
                updateStatusBar();
            }, null, context.subscriptions);

            currentPanel.onDidChangeViewState(e => {
                if (e.webviewPanel.visible) {
                    stopAutoReleaseTimer();
                    updateWebview(false);
                    updateStatusBar();
                } else {
                    startAutoReleaseTimer();
                    statusBarItem?.hide();
                }
            }, null, context.subscriptions);

            currentPanel.webview.onDidReceiveMessage(message => {
                if (message.command === 'locateCell') {
                    revealCell(currentDocumentUri, message.row, message.col);
                    statsState.currentRow = message.row;
                    statsState.currentCol = message.col;
                    updateStatusBar();
                } else if (message.command === 'updateSelection') {
                    statsState.currentRow = message.row;
                    statsState.currentCol = message.col;
                    updateStatusBar();
                } else if (message.command === 'ready') {
                    updateWebview(false);
                }
            }, undefined, context.subscriptions);

            updateWebview(true); // Initial load requires HTML set
        }
    });

    vscode.workspace.onDidChangeTextDocument(event => {
        if (currentDocumentUri && event.document.uri.toString() === currentDocumentUri.toString()) {
            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => updateWebview(false), 300);
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration('csv-splitview.autoReleaseTimeout')) {
            if (currentPanel && !currentPanel.visible) {
                startAutoReleaseTimer();
            } else {
                stopAutoReleaseTimer();
            }
        }
        if (event.affectsConfiguration('csv-splitview')) {
            updateWebview(true);
        }
    }, null, context.subscriptions);

    vscode.window.onDidChangeActiveColorTheme(() => {
        updateWebview(true); // Always reload to ensure CSS classes and standard variables update
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

function getWebviewContent(colors: string[], fontFamily: string): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CSV SplitView</title>
    <style>
        body {
            font-family: ${fontFamily}, var(--vscode-font-family);
            background-color: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            padding: 0;
            margin: 0;
            height: 100vh;
            overflow: hidden;
        }

        /* Default row backgrounds using standard behavior */
        body.vscode-light {
            --csv-row-bg-odd: rgba(0, 0, 0, 0.05);
            --csv-row-bg-even: rgba(0, 0, 0, 0.02);
        }
        body.vscode-dark, body.vscode-high-contrast {
            --csv-row-bg-odd: rgba(255, 255, 255, 0.06);
            --csv-row-bg-even: rgba(255, 255, 255, 0.03);
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
            cursor: pointer;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            min-width: 80px;
            max-width: 800px;
            box-sizing: border-box;
            line-height: 20px;
            height: 37px;
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
    
    <script>
        const vscode = acquireVsCodeApi();
        const viewport = document.getElementById('viewport');
        const spacer = document.getElementById('spacer');
        const table = document.getElementById('csvTable');
        const header = document.getElementById('csvHeader');
        const body = document.getElementById('csvBody');

        let currentHeaders = [];
        let textBuffer = null;
        let offsetBuffer = null;
        let rowCount = 0;
        let colCount = 0;
        const decoder = new TextDecoder();

        const AVG_ROW_HEIGHT = 37;
        const BUFFER_ROWS = 20;
        
        // --- High-Precision Canvas Measurement ---
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const lockedWidths = [];

        function measureCellWidth(text, isHeader = false) {
            const style = window.getComputedStyle(document.body);
            const fontSize = style.fontSize || '13px';
            const fontFamily = style.fontFamily || 'monospace';
            ctx.font = (isHeader ? 'bold ' : 'normal ') + fontSize + ' ' + fontFamily;
            
            const metrics = ctx.measureText(text || '');
            return Math.ceil(metrics.width) + 28;
        }

        function getCellValue(row, col) {
            if (!textBuffer || !offsetBuffer) return '';
            const idx = (row * colCount) + col;
            const start = offsetBuffer[idx * 2];
            const length = offsetBuffer[idx * 2 + 1];
            if (length === 0) return '';
            return decoder.decode(textBuffer.subarray(start, start + length));
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

        let renderFrameRequested = false;
        function requestRender() {
            if (renderFrameRequested) return;
            renderFrameRequested = true;
            requestAnimationFrame(() => {
                renderFrameRequested = false;
                render();
            });
        }

        function render() {
            if (rowCount === 0 || !textBuffer || !offsetBuffer) return;

            const scrollTop = viewport.scrollTop;
            const scrollLeft = viewport.scrollLeft;
            const viewportHeight = viewport.clientHeight;
            
            // 1. Identify Anchor Column for stable horizontal scrolling
            const ths = Array.from(header.querySelectorAll('th'));
            let anchor = { index: 0, offset: 0 };
            for (let i = 0; i < ths.length; i++) {
                if (ths[i].offsetLeft + ths[i].offsetWidth > scrollLeft) {
                    anchor = { index: i, offset: ths[i].offsetLeft - scrollLeft };
                    break;
                }
            }

            // 2. Identify visible range
            let startIndex = Math.floor(scrollTop / AVG_ROW_HEIGHT) - BUFFER_ROWS;
            startIndex = Math.max(0, startIndex);
            let endIndex = Math.ceil((scrollTop + viewportHeight) / AVG_ROW_HEIGHT) + BUFFER_ROWS;
            endIndex = Math.min(rowCount, endIndex);

            // 3. Scan widths
            let widthsChanged = false;
            if (currentHeaders.length > 0) {
                for (let j = 0; j < currentHeaders.length; j++) {
                    const headerW = measureCellWidth(currentHeaders[j], true);
                    if (headerW > (lockedWidths[j] || 0)) {
                        lockedWidths[j] = headerW;
                        widthsChanged = true;
                    }
                }
            }

            const sampleStep = (endIndex - startIndex > 100) ? 5 : 1;
            for (let i = startIndex; i < endIndex; i += sampleStep) {
                for (let j = 0; j < colCount; j++) {
                    const val = getCellValue(i, j);
                    if (val.length < (lockedWidths[j] || 0) / 10) continue;
                    const w = measureCellWidth(val);
                    if (w > (lockedWidths[j] || 0)) {
                        lockedWidths[j] = w;
                        widthsChanged = true;
                    }
                }
            }
            
            // 4. Update Header Widths
            if (widthsChanged) {
                ths.forEach((th, i) => {
                    const w = Math.min(800, lockedWidths[i]) + 'px';
                    if (th.style.width !== w) {
                        th.style.width = w;
                        th.style.minWidth = w;
                    }
                });
                
                let cumulativeLeft = 0;
                for (let i = 0; i < anchor.index; i++) {
                    cumulativeLeft += Math.min(800, lockedWidths[i]);
                }
                viewport.scrollLeft = cumulativeLeft - anchor.offset;
            }

            // 5. Build Content
            const offsetY = startIndex * AVG_ROW_HEIGHT;
            let html = '<tr class="buffer-row" style="height:' + offsetY + 'px"><td colspan="' + currentHeaders.length + '"></td></tr>';
            
            for (let i = startIndex; i < endIndex; i++) {
                const rowClass = (i % 2 === 0) ? 'even' : 'odd';
                let cells = '';
                for (let j = 0; j < currentHeaders.length; j++) {
                    const val = getCellValue(i, j);
                    const escaped = escapeHtml(val);
                    cells += '<td data-row="' + i + '" data-col="' + j + '" title="' + escaped + '">' + escaped + '</td>';
                }
                html += '<tr class="' + rowClass + '">' + cells + '</tr>';
            }
            body.innerHTML = html;
        }

        viewport.addEventListener('scroll', requestRender);
        window.addEventListener('resize', requestRender);

        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'startData') {
                window.stagedHeaders = message.headers;
                window.stagedColCount = message.colCount;
                window.isFirstBatch = true;
            } else if (message.command === 'appendData') {
                const newTextPart = new Uint8Array(message.textBuffer);
                const newOffsetPart = new Uint32Array(message.offsetBuffer);
                const newRowsCount = message.rowCount;

                if (window.isFirstBatch) {
                    currentHeaders = window.stagedHeaders;
                    colCount = window.stagedColCount;
                    textBuffer = newTextPart;
                    offsetBuffer = newOffsetPart;
                    rowCount = newRowsCount;
                    window.isFirstBatch = false;

                    lockedWidths.length = 0;
                    currentHeaders.forEach((h, i) => {
                        lockedWidths[i] = measureCellWidth(h, true);
                    });

                    let headerHtml = '<tr>';
                    for (let i = 0; i < currentHeaders.length; i++) {
                        const w = Math.min(800, lockedWidths[i]) + 'px';
                        headerHtml += '<th data-col="' + i + '" style="width:' + w + '; min-width:' + w + '">' + escapeHtml(currentHeaders[i]) + '</th>';
                    }
                    headerHtml += '</tr>';
                    header.innerHTML = headerHtml;
                    body.innerHTML = '';
                } else {
                    const combinedText = new Uint8Array(textBuffer.length + newTextPart.length);
                    combinedText.set(textBuffer);
                    combinedText.set(newTextPart, textBuffer.length);
                    textBuffer = combinedText;

                    const currentTextOffset = (textBuffer.length - newTextPart.length);
                    const expandedOffset = new Uint32Array(offsetBuffer.length + newOffsetPart.length);
                    expandedOffset.set(offsetBuffer);
                    for (let i = 0; i < newOffsetPart.length; i += 2) {
                        newOffsetPart[i] += currentTextOffset;
                    }
                    expandedOffset.set(newOffsetPart, offsetBuffer.length);
                    offsetBuffer = expandedOffset;
                    rowCount += newRowsCount;
                }

                spacer.style.height = (rowCount * AVG_ROW_HEIGHT) + AVG_ROW_HEIGHT + 'px';
                requestRender();
            } else if (message.command === 'endData') {
                requestRender();
            }
        });

        table.addEventListener('mouseover', (event) => {
            let target = event.target;
            if (target.tagName !== 'TD' && target.tagName !== 'TH') {
                target = target.closest('td, th');
            }
            if (target && target.tagName === 'TD') {
                const row = parseInt(target.getAttribute('data-row') || '-1', 10);
                const col = parseInt(target.getAttribute('data-col') || '-1', 10);
                if (row !== -1 && col !== -1) {
                    vscode.postMessage({ command: 'updateSelection', row, col });
                }
            }
        });

        table.addEventListener('click', (event) => {
            if (event.ctrlKey || event.metaKey) {
                let target = event.target;
                if (target.tagName !== 'TD' && target.tagName !== 'TH') {
                    target = target.closest('td, th');
                }
                if (target && target.tagName === 'TD') {
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
