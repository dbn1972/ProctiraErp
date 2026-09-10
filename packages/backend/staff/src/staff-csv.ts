/**
 * Minimal CSV parser / writer for staff bulk import and payroll export (G-918).
 * No third-party xlsx library — OOXML workbooks are rejected with a clear error.
 */

export interface CsvRow {
  line: number;
  values: Record<string, string>;
}

export interface ParseCsvResult {
  headers: string[];
  rows: CsvRow[];
  error?: string;
}

const XLSX_ZIP_MAGIC = 'PK';

export function looksLikeXlsx(input: string): boolean {
  const trimmed = input.replace(/^\uFEFF/, '');
  return trimmed.startsWith(XLSX_ZIP_MAGIC);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

export function parseCsv(input: string): ParseCsvResult {
  if (looksLikeXlsx(input)) {
    return {
      headers: [],
      rows: [],
      error:
        'XLSX workbooks are not parsed in this slice (no OOXML library). Export the first sheet as CSV and upload that file.',
    };
  }

  const text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], error: 'CSV is empty' };
  }

  const headers = splitCsvLine(lines[0]!).map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    return { headers: [], rows: [], error: 'CSV header row is empty' };
  }

  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]!);
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      if (!key) continue;
      values[key] = cells[c] ?? '';
    }
    rows.push({ line: i + 1, values });
  }
  return { headers, rows };
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
): string {
  const lines = [
    headers.map(escapeCsvCell).join(','),
    ...rows.map((row) => row.map(escapeCsvCell).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export const STAFF_IMPORT_REQUIRED_HEADERS = [
  'firstName',
  'lastName',
  'dateOfBirth',
  'identityNumber',
  'contactPhone',
  'position',
] as const;

export const STAFF_IMPORT_OPTIONAL_HEADERS = [
  'contactEmail',
  'contractType',
  'startDate',
  'endDate',
  'salaryBand',
] as const;
