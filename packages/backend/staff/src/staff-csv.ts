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

/** PRC-M382: input caps (the route schema also caps the body at 1 MB). */
export const CSV_MAX_BYTES = 1_000_000;
export const CSV_MAX_ROWS = 5_000;

interface CsvRecord {
  line: number;
  cells: string[];
}

/**
 * PRC-M382: RFC 4180 state-machine tokenizer over the whole input, so quoted
 * cells may contain commas, quotes ("") and newlines. Returns an error for an
 * unterminated quote instead of silently misaligning columns.
 */
function tokenizeCsv(text: string): { records: CsvRecord[]; error?: string } {
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let current = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const endRecord = () => {
    cells.push(current.trim());
    if (cells.some((c) => c.length > 0)) records.push({ line: recordLine, cells });
    cells = [];
    current = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current.trim());
      current = '';
    } else if (ch === '\n') {
      endRecord();
      line += 1;
      recordLine = line;
    } else {
      current += ch;
    }
  }
  if (inQuotes)
    return { records, error: `Unterminated quoted cell starting on line ${recordLine}` };
  endRecord();
  return { records };
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
  if (Buffer.byteLength(input, 'utf8') > CSV_MAX_BYTES) {
    return { headers: [], rows: [], error: `CSV exceeds ${CSV_MAX_BYTES} bytes` };
  }
  const text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const { records, error } = tokenizeCsv(text);
  if (error) return { headers: [], rows: [], error };
  if (records.length === 0) {
    return { headers: [], rows: [], error: 'CSV is empty' };
  }
  const headers = records[0]!.cells.map((h) => h.trim());
  if (headers.length === 0 || headers.every((h) => h.length === 0)) {
    return { headers: [], rows: [], error: 'CSV header row is empty' };
  }
  const seen = new Set<string>();
  for (const h of headers) {
    if (h && seen.has(h)) {
      return { headers: [], rows: [], error: `Duplicate CSV header '${h}'` };
    }
    seen.add(h);
  }
  if (records.length - 1 > CSV_MAX_ROWS) {
    return { headers: [], rows: [], error: `CSV exceeds ${CSV_MAX_ROWS} data rows` };
  }
  const rows: CsvRow[] = [];
  for (let i = 1; i < records.length; i++) {
    const { cells, line } = records[i]!;
    const values: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const key = headers[c]!;
      if (!key) continue;
      values[key] = cells[c] ?? '';
    }
    rows.push({ line, values });
  }
  return { headers, rows };
}

const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

/**
 * PRC-M382: OWASP CSV-injection guard. Text cells starting with = + - @ tab or
 * CR are prefixed with a single quote so spreadsheets treat them as text.
 * Numbers (and plain numeric strings such as "-12.5") are left untouched.
 */
export function csvSafeCell(value: string | number | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'number') return String(value);
  if (PLAIN_NUMBER.test(value)) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function escapeCsvCell(value: string | number | null | undefined): string {
  const text = csvSafeCell(value);
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
