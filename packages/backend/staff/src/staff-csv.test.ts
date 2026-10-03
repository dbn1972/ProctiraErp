/**
 * G-918 staff CSV parser / payroll writer unit tests.
 */
import { describe, expect, it } from 'vitest';

import { CSV_MAX_ROWS, csvSafeCell, looksLikeXlsx, parseCsv, toCsv } from './staff-csv.js';

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
    const csv = toCsv(['staffId', 'name', 'salaryBand'], [['abc', 'Doe, Jane', 'L3']]);
    expect(csv).toBe('staffId,name,salaryBand\nabc,"Doe, Jane",L3\n');
  });
});

describe('PRC-M382 CSV injection guard and RFC 4180 parsing', () => {
  it('prefixes formula-leading text cells with a quote', () => {
    expect(toCsv(['a'], [['=1+1']]).split('\n')[1]).toBe("'=1+1");
    expect(toCsv(['n'], [['=HYPERLINK("http://x")']]).split('\n')[1]).toBe(
      '"\'=HYPERLINK(""http://x"")"',
    );
    for (const v of ['+1', '@SUM(A1)', '\tx', '-cmd']) {
      expect(csvSafeCell(v)).toBe(`'${v}`);
    }
  });

  it('leaves numbers alone', () => {
    expect(csvSafeCell(-12.5)).toBe('-12.5');
    expect(csvSafeCell('-300')).toBe('-300');
    expect(toCsv(['n'], [[42]]).split('\n')[1]).toBe('42');
  });

  it('quoted newline stays in one row', () => {
    const parsed = parseCsv('name,notes\nAda,"line one\nline two"\nAlan,x\n');
    expect(parsed.error).toBeUndefined();
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.values.notes).toBe('line one\nline two');
    expect(parsed.rows[1]).toEqual({ line: 4, values: { name: 'Alan', notes: 'x' } });
  });

  it('rejects duplicate headers, unterminated quotes and too many rows', () => {
    expect(parseCsv('a,a\n1,2').error).toMatch(/Duplicate/);
    expect(parseCsv('a,b\n"1,2').error).toMatch(/Unterminated/);
    expect(parseCsv(`a\n${'1\n'.repeat(CSV_MAX_ROWS + 1)}`).error).toMatch(/rows/);
  });
});
