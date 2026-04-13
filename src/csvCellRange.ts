export function findCsvCellRange(text: string, targetRow: number, targetCol: number, delimiter: string): { start: number; end: number } | undefined {
    let row = 0;
    let col = 0;
    let fieldStart = 0;
    let inQuotes = false;

    for (let i = 0; i <= text.length; i++) {
        const ch = i < text.length ? text[i] : undefined;
        const isDelimiter = ch === delimiter && !inQuotes;
        const isNewline = (ch === '\n' || ch === '\r') && !inQuotes;
        const isEnd = i === text.length;

        if (ch === '"') {
            if (inQuotes && i + 1 < text.length && text[i + 1] === '"') {
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (!(isDelimiter || isNewline || isEnd)) {
            continue;
        }

        if (row === targetRow && col === targetCol) {
            return { start: fieldStart, end: i };
        }

        if (isDelimiter) {
            col++;
            fieldStart = i + 1;
            continue;
        }

        if (isNewline) {
            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') {
                i++;
            }
            row++;
            col = 0;
            fieldStart = i + 1;
            continue;
        }

        if (isEnd) {
            break;
        }
    }

    return undefined;
}