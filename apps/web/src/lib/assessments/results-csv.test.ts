/**
 * PRC-M572: the results CSV parser accounts for every row; bad rows and
 * out-of-range marks are rejected, never silently dropped.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseResultsCsv, type ResultsCsvItem } from './results-csv';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const items: ResultsCsvItem[] = [
  { id: 'item-maths', name: 'Maths', minScore: 0, maxScore: 100 },
  { id: 'item-eng', name: 'English', minScore: 0, maxScore: 50 },
];

describe('parseResultsCsv', () => {
  it('maps valid rows to entries per item column', () => {
    const out = parseResultsCsv(`studentId,Maths,English\n${S1},80,40\n${S2},55,\n`, items);
    expect(out.totalRows).toBe(2);
    expect(out.validRows).toBe(2);
    expect(out.entries).toEqual([
      { studentId: S1, assessmentItemId: 'item-maths', score: 80 },
      { studentId: S1, assessmentItemId: 'item-eng', score: 40 },
      { studentId: S2, assessmentItemId: 'item-maths', score: 55 },
    ]);
  });
  it('rejects bad student ids, out-of-range and non-numeric marks with line numbers', () => {
    const csv = `studentId,Maths,English\nnot-a-uuid,10,10\n${S1},101,10\n${S2},abc,10\n`;
    const out = parseResultsCsv(csv, items);
    expect(out.validRows).toBe(0);
    expect(out.rejectedRows).toEqual([2, 3, 4]);
    expect(out.entries).toEqual([]);
    expect(out.rowErrors.map((e) => e.field)).toEqual(['studentId', 'Maths', 'Maths']);
  });
  it('rejects a row with no scores instead of skipping it', () => {
    const out = parseResultsCsv(`studentId,Maths\n${S1},\n`, items);
    expect(out.rejectedRows).toEqual([2]);
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
        const out = parseResultsCsv(['studentId,Maths,English', ...rows].join('\n'), items);
        const nonEmpty = rows.filter((r) => r.trim().length > 0).length;
        expect(out.totalRows).toBe(nonEmpty);
        expect(out.validRows + out.rejectedRows.length).toBe(out.totalRows);
        for (const e of out.entries) {
          const item = items.find((i) => i.id === e.assessmentItemId)!;
          expect(e.score).toBeGreaterThanOrEqual(item.minScore);
          expect(e.score).toBeLessThanOrEqual(item.maxScore);
        }
      }),
    );
  });
});
