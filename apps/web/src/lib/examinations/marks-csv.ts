/**
 * G-902 — client-safe helpers for the Results tab "Upload marks" flow.
 */
export interface MarksEntry {
  studentId: string;
  marks: Array<{ subjectId: string; score: number | null }>;
}

/**
 * Parses a marks CSV: header `studentId,<subjectCode>,<subjectCode>…` and one
 * row per student; a blank cell records an incomplete subject.
 */
export function parseMarksCsv(
  csv: string,
  subjects: Array<{ id: string; code: string }>,
): { entries: MarksEntry[]; errors: string[] } {
  const errors: string[] = [];
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return { entries: [], errors: ['CSV needs a header and at least one row'] };
  }
  const header = lines[0]!.split(',').map((h) => h.trim());
  if (header[0]?.toLowerCase() !== 'studentid') {
    errors.push('First column must be studentId');
  }
  const codeToId = new Map(subjects.map((s) => [s.code.toUpperCase(), s.id]));
  const columns = header.slice(1).map((code) => {
    const id = codeToId.get(code.toUpperCase());
    if (!id) errors.push(`Unknown subject code '${code}'`);
    return { code, id };
  });
  const entries = lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(',').map((c) => c.trim());
    const marks = columns.flatMap((column, i): MarksEntry['marks'] => {
      if (!column.id) return [];
      const raw = cells[i + 1] ?? '';
      if (raw === '') return [{ subjectId: column.id, score: null }];
      const score = Number(raw);
      if (Number.isNaN(score)) {
        errors.push(`Row ${rowIndex + 2}: '${raw}' is not a number for ${column.code}`);
        return [];
      }
      return [{ subjectId: column.id, score }];
    });
    return { studentId: cells[0] ?? '', marks };
  });
  return { entries, errors };
}

/** CSV template for the current examination subjects. */
export function marksCsvTemplate(subjects: Array<{ code: string }>): string {
  return ['studentId', ...subjects.map((s) => s.code)].join(',') + '\n';
}
