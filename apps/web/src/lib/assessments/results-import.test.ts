import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  parseCsv,
  parseResultsImport,
  RESULTS_IMPORT_MAX_ROWS,
  summarizeResultsImport,
  type ResultsImportItem,
} from './results-import';
const ITEM = { id: 'item-1', name: 'Quiz', minScore: 0, maxScore: 10 };
const SID = '11111111-1111-4111-8111-111111111111';
function csv(rows: number, bad?: number): string {
  const lines = ['studentId,Quiz'];
  for (let i = 1; i <= rows; i += 1) lines.push(`${SID},${i === bad ? 99 : 5}`);
  return lines.join('\n');
}
describe('PRC-M475 results import parsing', () => {
  it('validates every row: a bad score on row 250 of 300 is reported', () => {
    const parsed = parseResultsImport('r.csv', csv(300, 250), [ITEM]);
    const bad = parsed.rows.filter((r) => r.errors.length > 0);
    expect(parsed.rows).toHaveLength(300);
    expect(bad).toHaveLength(1);
    expect(bad[0]!.rowNumber).toBe(251);
  });
  it('rejects .xlsx with a clear message', () => {
    const parsed = parseResultsImport('results.xlsx', 'PK\u0003\u0004binary', [ITEM]);
    expect(parsed.fileErrors[0]).toMatch(/Excel files are not supported/);
    expect(parsed.rows).toHaveLength(0);
  });
  it('rejects more than 5,000 rows', () => {
    const parsed = parseResultsImport('r.csv', csv(RESULTS_IMPORT_MAX_ROWS + 1), [ITEM]);
    expect(parsed.fileErrors.join(' ')).toMatch(/limit is 5,000/);
  });
  it('parses quoted cells containing commas and quotes', () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
  });
  it('flags a missing studentId column', () => {
    const parsed = parseResultsImport('r.csv', 'Quiz\n5', [ITEM]);
    expect(parsed.fileErrors.join(' ')).toMatch(/no studentId column/);
  });
});
/**
 * PRC-M572: every row is accounted for; bad rows and out-of-range marks are
 * rejected, never silently dropped.
 */
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const items: ResultsImportItem[] = [
  { id: 'item-maths', name: 'Maths', minScore: 0, maxScore: 100 },
  { id: 'item-eng', name: 'English', minScore: 0, maxScore: 50 },
];
function summarize(text: string) {
  const parsed = parseResultsImport('results.csv', text, items);
  expect(parsed.fileErrors).toEqual([]);
  return summarizeResultsImport(parsed);
}
describe('PRC-M572 results import row accounting', () => {
  it('maps valid rows to entries per item column', () => {
    const out = summarize(`studentId,Maths,English\n${S1},80,40\n${S2},55,\n`);
    expect(out.totalRows).toBe(2);
    expect(out.validRows).toBe(2);
    expect(out.rejectedRows).toEqual([]);
    expect(out.entries).toEqual([
      { studentId: S1, assessmentItemId: 'item-maths', score: 80 },
      { studentId: S1, assessmentItemId: 'item-eng', score: 40 },
      { studentId: S2, assessmentItemId: 'item-maths', score: 55 },
    ]);
  });
  it('rejects bad student ids, out-of-range and non-numeric marks with line numbers', () => {
    const out = summarize(
      `studentId,Maths,English\nnot-a-uuid,10,10\n${S1},101,10\n${S2},abc,10\n`,
    );
    expect(out.validRows).toBe(0);
    expect(out.rejectedRows).toEqual([2, 3, 4]);
    expect(out.entries).toEqual([]);
    expect(out.rowErrors.map((e) => e.field)).toEqual(['studentId', 'Maths', 'Maths']);
    expect(out.rowErrors[1]!.message).toMatch(/outside the item range \[0, 100\]/);
    expect(out.rowErrors[2]!.message).toMatch(/must be a number/);
  });
  it('rejects a whole row when any cell is invalid (valid cells are not submitted)', () => {
    const out = summarize(`studentId,Maths,English\n${S1},80,51\n`);
    expect(out.rejectedRows).toEqual([2]);
    expect(out.entries).toEqual([]);
  });
  it('rejects a row with no scores instead of skipping it', () => {
    const out = summarize(`studentId,Maths\n${S1},\n`);
    expect(out.rejectedRows).toEqual([2]);
    expect(out.rowErrors[0]!.message).toBe('Row has no scores');
  });
  it('reports physical line numbers across blank lines and quoted newlines', () => {
    const out = summarize(`studentId,Maths\n\n"${S1}",80\n"bad\nid",10\n${S2},200\n`);
    expect(out.totalRows).toBe(3);
    expect(out.validRows).toBe(1);
    expect(out.rejectedRows).toEqual([4, 6]);
  });
  it('property: every data row is either valid or rejected (no silent drops)', () => {
    const cell = fc.oneof(
      fc.constant(''),
      fc.integer({ min: -20, max: 150 }).map(String),
      fc.constantFrom('x', '1e9', 'NaN'),
    );
    const sid = fc.constantFrom(S1, S2, 'bad-id', '');
    const row = fc.tuple(sid, cell, cell).map((cols) => cols.join(','));
    fc.assert(
      fc.property(fc.array(row, { minLength: 1, maxLength: 40 }), (rows) => {
        const out = summarize(['studentId,Maths,English', ...rows].join('\n'));
        // A data row is any line with at least one non-blank cell; only all-blank
        // lines (e.g. ",," spreadsheet padding) carry no data and are skipped.
        const dataRows = rows.filter((r) => r.split(',').some((c) => c.trim().length > 0)).length;
        expect(out.totalRows).toBe(dataRows);
        expect(out.validRows + out.rejectedRows.length).toBe(out.totalRows);
        expect(new Set(out.rejectedRows).size).toBe(out.rejectedRows.length);
        for (const e of out.entries) {
          const item = items.find((i) => i.id === e.assessmentItemId)!;
          expect(e.score).toBeGreaterThanOrEqual(item.minScore);
          expect(e.score).toBeLessThanOrEqual(item.maxScore);
        }
      }),
    );
  });
});
