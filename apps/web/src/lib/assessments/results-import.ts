/**
 * Results CSV import: one parse + validate path shared by the preview and the
 * confirm step (PRC-M475).
 *
 * - CSV only. `.xlsx` is binary; reading it as text produced garbage rows, so it is
 *   rejected with a clear message instead of being "parsed".
 * - RFC 4180 quoting (commas, quotes and newlines inside quoted cells).
 * - Every row is validated (not just the first 200) and the 5,000-row cap is
 *   enforced before anything is submitted.
 * - Rejected rows are reported and counted, never silently dropped.
 */
import { itemScoreError, type ScoreRangeItem } from './score-range';

export const RESULTS_IMPORT_MAX_ROWS = 5000;

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export interface ResultsImportItem extends ScoreRangeItem {
  id: string;
}

export interface ResultsImportRowError {
  row: number;
  field: string;
  message: string;
  value: string;
}

export interface ResultsImportRow {
  /** 1-based line number in the file (header is row 1). */
  rowNumber: number;
  data: Record<string, string>;
  studentId: string;
  scores: Array<{ assessmentItemId: string; score: number }>;
  errors: ResultsImportRowError[];
}

export interface ResultsImportParse {
  headers: string[];
  rows: ResultsImportRow[];
  /** File-level problems (wrong type, too many rows, missing studentId column). */
  fileErrors: string[];
}

/** True when the file name looks like a spreadsheet we cannot parse as text. */
export function isUnsupportedSpreadsheet(fileName: string): boolean {
  return /\.(xlsx|xlsm|xls|ods)$/i.test(fileName.trim());
}

/** Minimal RFC 4180 CSV parser. Returns rows of cells; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows
    .map((cells) => cells.map((c) => c.trim()))
    .filter((cells) => cells.some((c) => c.length > 0));
}

export function parseResultsImport(
  fileName: string,
  text: string,
  items: ResultsImportItem[],
): ResultsImportParse {
  if (isUnsupportedSpreadsheet(fileName)) {
    return {
      headers: [],
      rows: [],
      fileErrors: [
        'Excel files are not supported. Save the sheet as CSV (UTF-8) and upload the .csv file.',
      ],
    };
  }
  const table = parseCsv(text);
  const headers = table[0] ?? [];
  const body = table.slice(1);
  const fileErrors: string[] = [];
  if (headers.length > 0 && !headers.includes('studentId')) {
    fileErrors.push('The file has no studentId column.');
  }
  if (body.length > RESULTS_IMPORT_MAX_ROWS) {
    fileErrors.push(
      `The file has ${body.length.toLocaleString()} rows; the limit is ${RESULTS_IMPORT_MAX_ROWS.toLocaleString()} per file. Split it and import each part.`,
    );
  }
  const columns = items
    .map((item) => ({ item, idx: headers.indexOf(item.name) }))
    .filter((c) => c.idx >= 0);
  const studentIdx = headers.indexOf('studentId');
  const rows: ResultsImportRow[] = body.map((cells, index) => {
    const rowNumber = index + 2;
    const data: Record<string, string> = {};
    headers.forEach((h, i) => {
      data[h] = cells[i] ?? '';
    });
    const errors: ResultsImportRowError[] = [];
    const studentId = studentIdx >= 0 ? (cells[studentIdx] ?? '') : '';
    if (!UUID_REGEX.test(studentId)) {
      errors.push({
        row: rowNumber,
        field: 'studentId',
        message: 'Student id is not a recognised directory id',
        value: studentId,
      });
    }
    const scores: ResultsImportRow['scores'] = [];
    for (const { item, idx } of columns) {
      const raw = cells[idx] ?? '';
      if (raw === '') continue;
      const problem = itemScoreError(item, raw);
      if (problem) {
        errors.push({
          row: rowNumber,
          field: item.name,
          message: `Score must be in [${item.minScore}, ${item.maxScore}]`,
          value: raw,
        });
        continue;
      }
      scores.push({ assessmentItemId: item.id, score: Number(raw) });
    }
    return { rowNumber, data, studentId, scores, errors };
  });
  return { headers, rows, fileErrors };
}
