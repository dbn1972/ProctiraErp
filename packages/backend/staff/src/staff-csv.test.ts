/**
 * G-918 staff CSV parser / payroll writer unit tests.
 */
import { describe, expect, it } from 'vitest';

import { looksLikeXlsx, parseCsv, toCsv } from './staff-csv.js';

describe('staff CSV (G-918)', () => {
  it('parses a quoted CSV with a header row', () => {
    const csv = `firstName,lastName,dateOfBirth,identityNumber,contactPhone,position
Ada,"Lovelace, Countess",1815-12-10,ID-1,+1555,Teacher`;
    const parsed = parseCsv(csv);
    expect(parsed.error).toBeUndefined();
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]!.values['lastName']).toBe('Lovelace, Countess');
  });

  it('rejects xlsx zip magic without attempting OOXML parse', () => {
    expect(looksLikeXlsx('PK\u0003\u0004workbook')).toBe(true);
    const parsed = parseCsv('PK\u0003\u0004fake-xlsx');
    expect(parsed.error).toMatch(/XLSX/);
    expect(parsed.rows).toHaveLength(0);
  });

  it('writes RFC4180-escaped payroll rows', () => {
    const csv = toCsv(
      ['staffId', 'name', 'salaryBand'],
      [['abc', 'Doe, Jane', 'L3']],
    );
    expect(csv).toBe('staffId,name,salaryBand\nabc,"Doe, Jane",L3\n');
  });
});
