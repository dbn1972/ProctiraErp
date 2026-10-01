/**
 * PRC-L236 — results CSV built on demand by the download route (not inlined
 * into the page as a prop). Fields are RFC 4180-escaped and formula-leading
 * characters are neutralised so a spreadsheet never evaluates cell content.
 */
import type { ExaminationResultsView } from '@/lib/api/examinations';

export function escapeCsvField(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildResultsCsv(view: Pick<ExaminationResultsView, 'rows' | 'subjects'>): string {
  const header = ['studentId', ...view.subjects.map((s) => s.code), 'total', 'status'];
  const lines = view.rows.map((row) => [
    row.studentId,
    ...row.subjects.map((s) => (s.score === null ? '' : String(s.score))),
    row.totalScore === null ? '' : String(row.totalScore),
    row.status,
  ]);
  return [header, ...lines].map((cells) => cells.map(escapeCsvField).join(',')).join('\n');
}
