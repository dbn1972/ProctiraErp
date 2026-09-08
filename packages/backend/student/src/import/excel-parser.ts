/**
 * Excel Parser for Student Bulk Import
 *
 * Parses Excel files (.xlsx) and extracts student rows with validation.
 * Uses ExcelJS for parsing.
 *
 * Requirements:
 * - 6.7: Parse Excel files up to 50MB
 * - 19.2: Validate all rows against entity rules
 */

import type { ImportStudentRow } from './types.js';

/**
 * Expected column headers in the import template.
 * Column order matters for mapping.
 */
export const EXPECTED_HEADERS = [
  'first_name',
  'last_name',
  'date_of_birth',
  'gender',
  'national_id',
  'nationality',
  'contact_phone',
  'contact_email',
  'guardian_name',
  'guardian_phone',
  'institution_code',
] as const;

export type HeaderName = (typeof EXPECTED_HEADERS)[number];

/**
 * Result of parsing an Excel file.
 */
export interface ParseResult {
  rows: ImportStudentRow[];
  headerErrors: string[];
}

/**
 * Parse an Excel buffer into student import rows.
 * Validates that the file has the expected headers and extracts data rows.
 *
 * @param buffer - The Excel file buffer
 * @returns Parsed rows and any header-level errors
 */
export async function parseExcelBuffer(buffer: Buffer): Promise<ParseResult> {
  // Dynamic import of exceljs to support environments where it may not be available
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { rows: [], headerErrors: ['No worksheet found in the Excel file'] };
  }

  // Validate headers (first row)
  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = String(cell.value ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '_');
  });

  const headerErrors: string[] = [];
  const mandatoryHeaders: HeaderName[] = ['first_name', 'last_name', 'date_of_birth'];
  for (const required of mandatoryHeaders) {
    if (!headers.includes(required)) {
      headerErrors.push(`Missing required column: ${required}`);
    }
  }

  if (headerErrors.length > 0) {
    return { rows: [], headerErrors };
  }

  // Build column index map
  const columnMap = new Map<HeaderName, number>();
  for (const header of EXPECTED_HEADERS) {
    const idx = headers.indexOf(header);
    if (idx !== -1) {
      columnMap.set(header, idx);
    }
  }

  // Parse data rows (starting from row 2)
  const rows: ImportStudentRow[] = [];
  const rowCount = worksheet.rowCount;

  for (let rowIdx = 2; rowIdx <= rowCount; rowIdx++) {
    const row = worksheet.getRow(rowIdx);

    // Skip completely empty rows
    if (isRowEmpty(row, headers.length)) {
      continue;
    }

    const getCellValue = (header: HeaderName): string => {
      const colIdx = columnMap.get(header);
      if (colIdx === undefined) return '';
      const cell = row.getCell(colIdx + 1);
      if (cell.value === null || cell.value === undefined) return '';
      if (cell.value instanceof Date) {
        return cell.value.toISOString().split('T')[0] ?? '';
      }
      return String(cell.value).trim();
    };

    const studentRow: ImportStudentRow = {
      rowNumber: rowIdx,
      firstName: getCellValue('first_name'),
      lastName: getCellValue('last_name'),
      dateOfBirth: getCellValue('date_of_birth'),
      gender: getCellValue('gender') || undefined,
      nationalId: getCellValue('national_id') || undefined,
      nationality: getCellValue('nationality') || undefined,
      contactPhone: getCellValue('contact_phone') || undefined,
      contactEmail: getCellValue('contact_email') || undefined,
      guardianName: getCellValue('guardian_name') || undefined,
      guardianPhone: getCellValue('guardian_phone') || undefined,
      institutionCode: getCellValue('institution_code') || undefined,
    };

    rows.push(studentRow);
  }

  return { rows, headerErrors: [] };
}

/**
 * Check if a worksheet row is completely empty.
 */
function isRowEmpty(
  row: { getCell: (col: number) => { value: unknown } },
  colCount: number,
): boolean {
  for (let i = 1; i <= colCount; i++) {
    const cell = row.getCell(i);
    if (cell.value !== null && cell.value !== undefined && String(cell.value).trim() !== '') {
      return false;
    }
  }
  return true;
}
