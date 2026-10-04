/**
 * G-902 — client-safe helpers for the Results tab "Upload marks" flow.
 */
export interface MarksEntry {
  studentId: string;
  marks: Array<{ subjectId: string; score: number | null }>;
}

/** Non-negative decimal with at most two fractional digits (no exponent/hex/Infinity). */
const SCORE_RE = /^\d+(\.\d{1,2})?$/;

/**
 * Minimal RFC 4180 line splitter: supports double-quoted cells containing
 * commas and escaped quotes (`""`). Multi-line quoted cells are not used in
 * marks files and are rejected as malformed by the column-count check.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell.trim() === '') {
      cell = '';
      quoted = true;
    } else if (ch === ',') {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell.trim());
  return cells;
}

/**
 * Parses a marks CSV: header `studentId,<subjectCode>,<subjectCode>…` and one
 * row per student; a blank cell records an incomplete subject.
 *
 * Scores must be plain decimals within `0..maxScore` (when supplied). Blank or
 * duplicate student ids, duplicate/unknown headers and ragged rows are
 * errors. When any error exists `entries` is empty so nothing can be posted.
 */
export function parseMarksCsv(
  csv: string,
  subjects: Array<{ id: string; code: string; maxScore?: number }>,
): { entries: MarksEntry[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { entries: [], errors: ['CSV needs a header and at least one row'] };
  }
  const header = splitCsvLine(lines[0]!);
  if (header[0]?.toLowerCase() !== 'studentid') {
    errors.push('First column must be studentId');
  }
  const bySubjectCode = new Map(subjects.map((s) => [s.code.toUpperCase(), s]));
  const seenCodes = new Set<string>();
  const columns = header.slice(1).map((code) => {
    const key = code.toUpperCase();
    if (seenCodes.has(key)) errors.push(`Duplicate subject column '${code}'`);
    seenCodes.add(key);
    const subject = bySubjectCode.get(key);
    if (!subject) errors.push(`Unknown subject code '${code}'`);
    return { code, id: subject?.id, maxScore: subject?.maxScore };
  });
  const seenStudents = new Set<string>();
  const entries = lines.slice(1).map((line, rowIndex) => {
    const rowNo = rowIndex + 2;
    const cells = splitCsvLine(line);
    if (cells.length > header.length) {
      errors.push(`Row ${rowNo}: expected ${header.length} columns, found ${cells.length}`);
    }
    const studentId = cells[0] ?? '';
    if (studentId === '') {
      errors.push(`Row ${rowNo}: studentId is required`);
    } else if (seenStudents.has(studentId)) {
      errors.push(`Row ${rowNo}: duplicate studentId ${studentId}`);
    }
    seenStudents.add(studentId);
    const marks = columns.flatMap((column, i): MarksEntry['marks'] => {
      if (!column.id) return [];
      const raw = cells[i + 1] ?? '';
      if (raw === '') return [{ subjectId: column.id, score: null }];
      if (!SCORE_RE.test(raw)) {
        errors.push(`Row ${rowNo}: '${raw}' is not a number for ${column.code}`);
        return [];
      }
      const score = Number(raw);
      if (column.maxScore !== undefined && score > column.maxScore) {
        errors.push(`Row ${rowNo}: ${raw} is outside 0–${column.maxScore} for ${column.code}`);
        return [];
      }
      return [{ subjectId: column.id, score }];
    });
    return { studentId, marks };
  });
  return { entries: errors.length > 0 ? [] : entries, errors };
}

/** CSV template for the current examination subjects. */
export function marksCsvTemplate(subjects: Array<{ code: string }>): string {
  return ['studentId', ...subjects.map((s) => s.code)].join(',') + '\n';
}
