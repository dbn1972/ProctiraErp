/**
 * Results CSV import: one parse + validate path shared by the preview and the
 * confirm step (PRC-M475, PRC-M572).
 *
 * - CSV only. `.xlsx` is binary; reading it as text produced garbage rows, so it is
 *   rejected with a clear message instead of being "parsed".
 * - RFC 4180 quoting (commas, quotes and newlines inside quoted cells).
 * - Every row is validated (not just the first 200) and the 5,000-row cap is
 *   enforced before anything is submitted.
 * - Every data row is accounted for: it either contributes score entries or is
 *   rejected with at least one error (a row with any invalid cell, or with no
 *   scores at all, is rejected whole). Rejected rows are reported and counted as
 *   failed, never silently dropped. Only lines whose cells are all blank are skipped.
 */
import { itemScoreError, type ScoreRangeItem } from './score-range';
export const RESULTS_IMPORT_MAX_ROWS = 5000;
const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export interface ResultsImportItem extends ScoreRangeItem {
  id: string;
}
export interface ResultsImportRowError {
  /** 1-based line number in the file (header is line 1). */
  row: number;
  field: string;
  message: string;
  value: string;
}
export interface ResultsImportEntry {
  studentId: string;
  assessmentItemId: string;
  score: number;
}
export interface ResultsImportRow {
  /** 1-based line number in the file where the record starts (header is row 1). */
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
/** Row accounting derived from a parse; `validRows + rejectedRows.length === totalRows`. */
export interface ResultsImportSummary {
  totalRows: number;
  validRows: number;
  /** Line numbers of rejected rows (each row appears once). */
  rejectedRows: number[];
  rowErrors: ResultsImportRowError[];
  /** Score entries from valid rows only. */
  entries: ResultsImportEntry[];
}
/** True when the file name looks like a spreadsheet we cannot parse as text. */
export function isUnsupportedSpreadsheet(fileName: string): boolean {
  return /\.(xlsx|xlsm|xls|ods)$/i.test(fileName.trim());
}
interface CsvRecord {
  /** 1-based line on which the record starts. */
  line: number;
  cells: string[];
}
/** RFC 4180 records with their starting line; records whose cells are all blank are dropped. */
function parseCsvRecords(text: string): CsvRecord[] {
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let line = 1;
  let rowStart = 1;
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
        if (ch === '\n' || (ch === '\r' && source[i + 1] !== '\n')) line += 1;
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
      records.push({ line: rowStart, cells: row });
      line += 1;
      rowStart = line;
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  records.push({ line: rowStart, cells: row });
  return records
    .map((r) => ({ line: r.line, cells: r.cells.map((c) => c.trim()) }))
    .filter((r) => r.cells.some((c) => c.length > 0));
}
/** Minimal RFC 4180 CSV parser. Returns rows of cells; blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((r) => r.cells);
}
export function parseResultsImport(
  fileName: string,
  text: string,
  items: readonly ResultsImportItem[],
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
  const table = parseCsvRecords(text);
  const headers = table[0]?.cells ?? [];
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
  const rows: ResultsImportRow[] = body.map(({ line: rowNumber, cells }) => {
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
        errors.push({ row: rowNumber, field: item.name, message: problem, value: raw });
        continue;
      }
      scores.push({ assessmentItemId: item.id, score: Number(raw) });
    }
    // PRC-M572: a row that carries no scores is rejected, not skipped as "valid".
    if (errors.length === 0 && scores.length === 0) {
      errors.push({
        row: rowNumber,
        field: '',
        message: 'Row has no scores',
        value: cells.join(','),
      });
    }
    return { rowNumber, data, studentId, scores, errors };
  });
  return { headers, rows, fileErrors };
}
/**
 * Row accounting for the preview and the confirm step. Callers must surface
 * `fileErrors` (and submit nothing) before using this.
 */
export function summarizeResultsImport(parsed: ResultsImportParse): ResultsImportSummary {
  const summary: ResultsImportSummary = {
    totalRows: parsed.rows.length,
    validRows: 0,
    rejectedRows: [],
    rowErrors: [],
    entries: [],
  };
  for (const row of parsed.rows) {
    if (row.errors.length > 0) {
      summary.rejectedRows.push(row.rowNumber);
      summary.rowErrors.push(...row.errors);
      continue;
    }
    summary.validRows += 1;
    for (const s of row.scores) {
      summary.entries.push({
        studentId: row.studentId,
        assessmentItemId: s.assessmentItemId,
        score: s.score,
      });
    }
  }
  return summary;
}
