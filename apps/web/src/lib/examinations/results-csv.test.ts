import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildResultsCsv, escapeCsvField } from './results-csv';

describe('results CSV (PRC-L236)', () => {
  it('escapes commas, quotes, newlines and neutralises formula prefixes', () => {
    expect(escapeCsvField('a,b')).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(escapeCsvField('plain')).toBe('plain');
  });

  it('builds header and rows with blanks for missing scores', () => {
    const csv = buildResultsCsv({
      subjects: [{ code: 'MATH' }, { code: 'SCI,1' }] as never,
      rows: [
        {
          studentId: 's1',
          subjects: [{ score: 80 }, { score: null }],
          totalScore: 80,
          status: 'PASS',
        },
      ] as never,
    });
    expect(csv).toBe('studentId,MATH,"SCI,1",total,status\ns1,80,,80,PASS');
  });

  it('results page no longer inlines the CSV; controls link to the download route', () => {
    const page = readFileSync(
      resolve(__dirname, '../../app/(dashboard)/examinations/[id]/results/page.tsx'),
      'utf8',
    );
    expect(page).not.toMatch(/csv=\{/);
    const controls = readFileSync(
      resolve(__dirname, '../../components/examinations/exam-ops-controls.tsx'),
      'utf8',
    );
    expect(controls).toContain('/results-csv');
    expect(controls).not.toContain('data:text/csv');
  });
});
