/**
 * PRC-L061 — import page column list equals the downloadable template headers,
 * which equal the backend parser's EXPECTED_HEADERS.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('../_components/bulk-import-panel', () => ({ BulkImportPanel: () => null }));

import StudentBulkImportPage from '../page';
import { buildImportTemplate } from './build-template';
import { IMPORT_TEMPLATE_HEADERS } from './columns';

async function roundTrip(): Promise<ExcelJS.Workbook> {
  const buffer = await (await buildImportTemplate()).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as ArrayBuffer);
  return wb;
}

function rowValues(sheet: ExcelJS.Worksheet, n: number): string[] {
  const out: string[] = [];
  sheet.getRow(n).eachCell({ includeEmpty: true }, (cell, col) => {
    out[col - 1] = String(cell.value ?? '');
  });
  return out;
}

describe('student import template (PRC-L061)', () => {
  it('matches the backend parser EXPECTED_HEADERS', () => {
    const src = readFileSync(
      join(
        __dirname,
        '../../../../../../../../packages/backend/student/src/import/excel-parser.ts',
      ),
      'utf8',
    );
    const block = /EXPECTED_HEADERS = \[([\s\S]*?)\] as const/.exec(src)?.[1] ?? '';
    const backend = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(IMPORT_TEMPLATE_HEADERS).toEqual(backend);
  });

  it('first (imported) sheet has only the header row plus date/gender validation', async () => {
    const wb = await roundTrip();
    const data = wb.worksheets[0]!;
    expect(data.name).toBe('Students');
    expect(rowValues(data, 1)).toEqual([...IMPORT_TEMPLATE_HEADERS]);
    expect(rowValues(data, 2).filter(Boolean)).toEqual([]);
    const dobCol = IMPORT_TEMPLATE_HEADERS.indexOf('date_of_birth') + 1;
    const genderCol = IMPORT_TEMPLATE_HEADERS.indexOf('gender') + 1;
    expect(data.getCell(2, dobCol).dataValidation?.type).toBe('custom');
    expect(data.getCell(2, genderCol).dataValidation).toMatchObject({
      type: 'list',
      formulae: ['"male,female,other"'],
    });
    const example = wb.getWorksheet('Example')!;
    expect(rowValues(example, 2)[0]).toBe('Asha');
  });

  it('page column list equals template headers', () => {
    render(<StudentBulkImportPage />);
    const list = screen.getByTestId('import-template-columns');
    const keys = within(list)
      .getAllByRole('listitem')
      .map((li) => li.getAttribute('data-column'));
    expect(keys).toEqual([...IMPORT_TEMPLATE_HEADERS]);
  });
});
