/**
 * ExcelJS CJS/ESM interop and real xlsx parse path.
 *
 * CSV is not an accepted student-import format (routes allow .xlsx only),
 * so this file does not round-trip CSV.
 */
import { describe, expect, it } from 'vitest';

import {
  createExcelWorkbook,
  parseExcelBuffer,
  resolveExcelWorkbookConstructor,
} from './excel-parser.js';

class FakeWorkbook {
  readonly marker = 'workbook';
}

describe('resolveExcelWorkbookConstructor', () => {
  it('accepts a direct Workbook export', () => {
    const ctor = resolveExcelWorkbookConstructor({ Workbook: FakeWorkbook });
    expect(new ctor()).toBeInstanceOf(FakeWorkbook);
  });

  it('accepts Workbook nested on the default export', () => {
    const ctor = resolveExcelWorkbookConstructor({ default: { Workbook: FakeWorkbook } });
    expect(new ctor()).toBeInstanceOf(FakeWorkbook);
  });

  it('unwraps a Workbook namespace whose constructor is on .default', () => {
    const ctor = resolveExcelWorkbookConstructor({ Workbook: { default: FakeWorkbook } });
    expect(new ctor()).toBeInstanceOf(FakeWorkbook);
  });

  it('accepts a double-wrapped default namespace', () => {
    const ctor = resolveExcelWorkbookConstructor({
      default: { default: { Workbook: FakeWorkbook } },
    });
    expect(new ctor()).toBeInstanceOf(FakeWorkbook);
  });

  it('rejects a non-constructable Workbook export', () => {
    expect(() => resolveExcelWorkbookConstructor({ Workbook: { not: 'a class' } })).toThrow(
      /Workbook constructor/i,
    );
  });
});

describe('parseExcelBuffer', () => {
  it('parses a small xlsx through the real exceljs path', async () => {
    const workbook = await createExcelWorkbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['first_name', 'last_name', 'date_of_birth', 'national_id', 'contact_email']);
    sheet.addRow(['Ada', 'Lovelace', '2008-12-10', 'NID-1', 'ada@example.edu']);
    sheet.addRow(['', '', '', '', '']);
    const dated = sheet.addRow(['Alan', 'Turing', '', 'NID-2', '']);
    dated.getCell(3).value = new Date('2007-06-23T00:00:00.000Z');

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseExcelBuffer(buffer);

    expect(parsed.headerErrors).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        firstName: 'Ada',
        lastName: 'Lovelace',
        dateOfBirth: '2008-12-10',
        nationalId: 'NID-1',
        contactEmail: 'ada@example.edu',
      }),
      expect.objectContaining({
        rowNumber: 4,
        firstName: 'Alan',
        lastName: 'Turing',
        dateOfBirth: '2007-06-23',
        nationalId: 'NID-2',
      }),
    ]);
  });

  it('reports a missing required header instead of throwing', async () => {
    const workbook = await createExcelWorkbook();
    const sheet = workbook.addWorksheet('Students');
    sheet.addRow(['nickname']);
    sheet.addRow(['Ada']);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseExcelBuffer(buffer);
    expect(parsed.rows).toEqual([]);
    expect(parsed.headerErrors.join(' ')).toMatch(/first_name/);
  });
});
