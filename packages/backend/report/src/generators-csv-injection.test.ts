/**
 * PRC-M382: report CSV export neutralises spreadsheet formulas.
 */
import { describe, expect, it } from 'vitest';

import { generateCsv } from './generators.js';

describe('generateCsv formula-injection guard (PRC-M382)', () => {
  it('prefixes formula-leading text; keeps numbers', () => {
    const csv = generateCsv({
      columns: [
        { name: 'name', label: 'Name' },
        { name: 'amount', label: 'Amount' },
      ],
      rows: [
        { name: '=HYPERLINK("http://x")', amount: -5 },
        { name: '@SUM(A1)', amount: '-12.5' },
      ],
    } as Parameters<typeof generateCsv>[0]).toString('utf8');
    const lines = csv.split('\n');
    expect(lines[1]).toBe('"\'=HYPERLINK(""http://x"")",-5');
    expect(lines[2]).toBe("'@SUM(A1),-12.5");
  });
});
