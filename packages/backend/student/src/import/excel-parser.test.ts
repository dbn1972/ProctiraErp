/**
 * ExcelJS CJS/ESM interop and real xlsx parse path.
 *
 * CSV is not an accepted student-import format (routes allow .xlsx only),
 * so this file does not round-trip CSV.
 */
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import {
  createExcelWorkbook,
  inspectZipBounds,
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

/**
 * PRC-L589: a minimal one-entry zip whose central directory declares the given
 * uncompressed size (stored, no data). Enough for the archive pre-check.
 */
function craftedZip(declaredUncompressed: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(declaredUncompressed, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(declaredUncompressed, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length;
  const cdSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, central, name, eocd]);
}

/**
 * PRC-L589: a one-entry deflate zip whose central directory *declares* a tiny
 * uncompressed size while the stream really inflates to `realBytes`.
 */
function lyingDeflateZip(declaredUncompressed: number, realBytes: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml');
  const data = deflateRawSync(Buffer.alloc(realBytes, 0x41));
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredUncompressed, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredUncompressed, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + name.length + data.length;
  const cdSize = central.length + name.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, name, data, central, name, eocd]);
}

describe('inspectZipBounds real inflate (PRC-L589)', () => {
  it('rejects an entry that inflates past the cap although it declares 100 bytes', () => {
    const buffer = lyingDeflateZip(100, 2 * 1024 * 1024);
    const error = inspectZipBounds(buffer, { maxEntries: 10, maxUncompressedBytes: 1 << 20 });
    expect(error).toMatch(/uncompressed/i);
  });

  it('accepts the same archive when the real size is under the cap', () => {
    const buffer = lyingDeflateZip(100, 4096);
    expect(inspectZipBounds(buffer, { maxEntries: 10, maxUncompressedBytes: 1 << 20 })).toBeNull();
  });

  it('still parses a genuine small xlsx', async () => {
    const buffer = await workbookBuffer([
      ['first_name', 'last_name', 'date_of_birth'],
      ['Ada', 'Lovelace', '2008-12-10'],
    ]);
    expect(
      inspectZipBounds(buffer, { maxEntries: 1000, maxUncompressedBytes: 1 << 20 }),
    ).toBeNull();
    expect((await parseExcelBuffer(buffer)).rows).toHaveLength(1);
  });
});

async function workbookBuffer(rows: unknown[][], edit?: (sheet: unknown) => void) {
  const workbook = await createExcelWorkbook();
  const sheet = workbook.addWorksheet('Students');
  for (const row of rows) sheet.addRow(row);
  edit?.(sheet);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('parseExcelBuffer bounds and cell types (PRC-L589)', () => {
  it('rejects an archive whose declared uncompressed size is over the cap, without throwing', async () => {
    const parsed = await parseExcelBuffer(craftedZip(0x7fffffff));
    expect(parsed.rows).toEqual([]);
    expect(parsed.headerErrors.join(' ')).toMatch(/uncompressed/i);
  });

  it('rejects an archive with more entries than allowed', async () => {
    const buffer = await workbookBuffer([['first_name', 'last_name', 'date_of_birth']]);
    const parsed = await parseExcelBuffer(buffer, { maxEntries: 2 });
    expect(parsed.rows).toEqual([]);
    expect(parsed.headerErrors.join(' ')).toMatch(/entries/i);
  });

  it('caps the number of data rows', async () => {
    const buffer = await workbookBuffer([
      ['first_name', 'last_name', 'date_of_birth'],
      ['A', 'One', '2010-01-01'],
      ['B', 'Two', '2010-01-02'],
      ['C', 'Three', '2010-01-03'],
      ['D', 'Four', '2010-01-04'],
    ]);
    const parsed = await parseExcelBuffer(buffer, { maxRows: 3 });
    expect(parsed.rows).toEqual([]);
    expect(parsed.headerErrors.join(' ')).toMatch(/4 data rows.*maximum is 3/);
    expect((await parseExcelBuffer(buffer, { maxRows: 4 })).rows).toHaveLength(4);
  });

  it('reads formula results, rich text and hyperlink text as plain strings', async () => {
    const buffer = await workbookBuffer(
      [
        ['first_name', 'last_name', 'date_of_birth', 'contact_email'],
        ['', '', '2010-01-01', ''],
      ],
      (sheet) => {
        const row = (
          sheet as { getRow(n: number): { getCell(c: number): { value: unknown } } }
        ).getRow(2);
        row.getCell(1).value = { formula: 'CONCAT("A","da")', result: 'Ada' };
        row.getCell(2).value = { richText: [{ text: 'Love' }, { text: 'lace' }] };
        row.getCell(4).value = { text: 'ada@example.edu', hyperlink: 'mailto:ada@example.edu' };
      },
    );
    const parsed = await parseExcelBuffer(buffer);
    expect(parsed.headerErrors).toEqual([]);
    expect(parsed.rows).toEqual([
      expect.objectContaining({
        firstName: 'Ada',
        lastName: 'Lovelace',
        contactEmail: 'ada@example.edu',
      }),
    ]);
  });
});
