/**
 * PRC-M572: pure parser/validator for the results-entry CSV import.
 *
 * Every non-empty data row is accounted for: it either contributes score
 * entries or is listed in `rowErrors`. Nothing is dropped silently, so the
 * import can report rejected rows as failures.
 */
import { itemScoreError } from './score-range';

export interface ResultsCsvItem {
  id: string;
  name: string;
  minScore: number;
  maxScore: number;
}

export interface ResultsCsvEntry {
  studentId: string;
  assessmentItemId: string;
  score: number;
}

export interface ResultsCsvRowError {
  /** 1-based line number in the file (header is line 1). */
  row: number;
  field: string;
  message: string;
  value: string;
}

export interface ResultsCsvParseResult {
  headers: string[];
  /** Number of non-empty data rows (excluding the header). */
  totalRows: number;
  /** Data rows with no errors. */
  validRows: number;
  /** Line numbers of rows rejected (each row appears once). */
  rejectedRows: number[];
  rowErrors: ResultsCsvRowError[];
  /** Score entries from valid rows only. */
  entries: ResultsCsvEntry[];
  /** Parsed cells per data row keyed by header, for previews. */
  preview: Array<{ row: number; data: Record<string, string>; hasErrors: boolean }>;
}

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function parseResultsCsv(
  text: string,
  items: readonly ResultsCsvItem[],
): ResultsCsvParseResult {
  const lines = text.split(/\r?\n/).map((l, i) => ({ line: l.trim(), row: i + 1 }));
  const nonEmpty = lines.filter((l) => l.line.length > 0);
  const empty: ResultsCsvParseResult = {
    headers: [],
    totalRows: 0,
    validRows: 0,
    rejectedRows: [],
    rowErrors: [],
    entries: [],
    preview: [],
  };
  if (nonEmpty.length === 0) return empty;
  const headers = nonEmpty[0]!.line.split(',').map((s) => s.trim());
  const studentIdx = headers.indexOf('studentId');
  const columns = items
    .map((item) => ({ item, idx: headers.indexOf(item.name) }))
    .filter((c) => c.idx >= 0);
  const result: ResultsCsvParseResult = { ...empty, headers };
  for (const { line, row } of nonEmpty.slice(1)) {
    result.totalRows += 1;
    const cells = line.split(',').map((s) => s.trim());
    const data: Record<string, string> = {};
    headers.forEach((h, i) => {
      data[h] = cells[i] ?? '';
    });
    const errors: ResultsCsvRowError[] = [];
    const studentId = studentIdx >= 0 ? (cells[studentIdx] ?? '') : '';
    if (!UUID_REGEX.test(studentId)) {
      errors.push({
        row,
        field: 'studentId',
        message: 'Student id is not a recognised directory id',
        value: studentId,
      });
    }
    const rowEntries: ResultsCsvEntry[] = [];
    for (const { item, idx } of columns) {
      const raw = cells[idx] ?? '';
      if (raw === '') continue;
      const scoreError = itemScoreError(item, raw);
      if (scoreError) {
        errors.push({ row, field: item.name, message: scoreError, value: raw });
        continue;
      }
      rowEntries.push({ studentId, assessmentItemId: item.id, score: Number(raw) });
    }
    if (errors.length === 0 && rowEntries.length === 0) {
      errors.push({ row, field: '', message: 'Row has no scores', value: line });
    }
    result.preview.push({ row, data, hasErrors: errors.length > 0 });
    if (errors.length > 0) {
      result.rejectedRows.push(row);
      result.rowErrors.push(...errors);
    } else {
      result.validRows += 1;
      result.entries.push(...rowEntries);
    }
  }
  return result;
}
