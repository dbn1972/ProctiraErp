import { describe, expect, it } from 'vitest';
import { parseCsv, parseResultsImport, RESULTS_IMPORT_MAX_ROWS } from './results-import';

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
