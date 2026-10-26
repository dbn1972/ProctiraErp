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

import {
  MAX_IMPORT_ROWS,
  MAX_IMPORT_UNCOMPRESSED_BYTES,
  MAX_IMPORT_ZIP_ENTRIES,
  type ImportParseLimits,
  type ImportStudentRow,
} from './types.js';

/**
 * Structural slice of an ExcelJS workbook used by the import parser.
 * Kept local so call sites do not depend on a specific exceljs export shape.
 */
export interface ExcelWorkbookLike {
  xlsx: {
    load(data: unknown): Promise<unknown>;
    writeBuffer(): Promise<ArrayBuffer>;
  };
  worksheets: ExcelWorksheetLike[];
  addWorksheet(name: string): ExcelWorksheetLike & {
    addRow(values: unknown[]): ExcelRowLike;
  };
}

interface ExcelWorksheetLike {
  getRow(rowNumber: number): ExcelRowLike;
  rowCount: number;
}

interface ExcelRowLike {
  eachCell(
    opts: { includeEmpty: true },
    cb: (cell: { value: unknown }, colNumber: number) => void,
  ): void;
  getCell(col: number): { value: unknown };
}

type WorkbookConstructor = new () => ExcelWorkbookLike;

/**
 * exceljs is CommonJS (`module.exports = { Workbook }`). Under this package's
 * ESM loader (Node `import()` and Vitest), the constructor may sit on the
 * namespace, on `.default`, or one more `.default` inside `Workbook`.
 * `new namespace.Workbook` then throws `ExcelJS.Workbook is not a constructor`.
 */
export function resolveExcelWorkbookConstructor(moduleNamespace: unknown): WorkbookConstructor {
  const candidates = collectWorkbookCandidates(moduleNamespace);
  for (const candidate of candidates) {
    const ctor = unwrapConstructor(candidate);
    if (ctor) return ctor;
  }
  throw new Error(
    'exceljs did not export a Workbook constructor. The package is CommonJS; ' +
      'dynamic import() can nest Workbook under .default. Check the exceljs install ' +
      'and the module loader interop.',
  );
}

function collectWorkbookCandidates(moduleNamespace: unknown): unknown[] {
  const record = asRecord(moduleNamespace);
  const fromDefault = asRecord(record?.default);
  const fromNestedDefault = asRecord(fromDefault?.default);
  return [record?.Workbook, fromDefault?.Workbook, fromNestedDefault?.Workbook, record?.default];
}

function unwrapConstructor(value: unknown, depth = 0): WorkbookConstructor | null {
  if (depth > 5 || value == null) return null;
  if (typeof value === 'function') return value as WorkbookConstructor;
  const record = asRecord(value);
  if (!record || !('default' in record)) return null;
  return unwrapConstructor(record.default, depth + 1);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value && (typeof value === 'object' || typeof value === 'function')) {
    return value as Record<string, unknown>;
  }
  return null;
}

/** Load exceljs and return a workbook instance that is safe to construct. */
export async function createExcelWorkbook(): Promise<ExcelWorkbookLike> {
  const imported = await import('exceljs');
  const Workbook = resolveExcelWorkbookConstructor(imported);
  return new Workbook();
}

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

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const EOCD_MIN_BYTES = 22;
const CENTRAL_HEADER_MIN_BYTES = 46;

/**
 * PRC-L589: zip-bomb pre-check on the archive's central directory, run before
 * exceljs inflates anything. Returns an error message, or null when the
 * declared bounds are fine (or the buffer is not a zip; exceljs reports that).
 * Declared sizes are trusted: a streaming inflate cap would need JSZip internals.
 */
export function inspectZipBounds(
  buffer: Buffer,
  limits: Pick<ImportParseLimits, 'maxEntries' | 'maxUncompressedBytes'>,
): string | null {
  if (buffer.length < EOCD_MIN_BYTES) return null;
  const searchFloor = Math.max(0, buffer.length - (EOCD_MIN_BYTES + 0xffff));
  let eocd = -1;
  for (let i = buffer.length - EOCD_MIN_BYTES; i >= searchFloor; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;
  const entries = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
    return 'ZIP64 archives are not supported for student import';
  }
  if (entries > limits.maxEntries) {
    return `File has ${entries} archive entries; the maximum is ${limits.maxEntries}`;
  }
  if (directoryOffset + directorySize > eocd) return 'File archive directory is corrupt';
  let total = 0;
  let pos = directoryOffset;
  for (let n = 0; n < entries; n++) {
    if (pos + CENTRAL_HEADER_MIN_BYTES > eocd) return 'File archive directory is corrupt';
    if (buffer.readUInt32LE(pos) !== CENTRAL_HEADER_SIGNATURE) {
      return 'File archive directory is corrupt';
    }
    const uncompressed = buffer.readUInt32LE(pos + 24);
    if (uncompressed === 0xffffffff) return 'ZIP64 archives are not supported for student import';
    total += uncompressed;
    if (total > limits.maxUncompressedBytes) {
      return `File declares over ${limits.maxUncompressedBytes} bytes uncompressed; the maximum is ${limits.maxUncompressedBytes}`;
    }
    const nameLength = buffer.readUInt16LE(pos + 28);
    const extraLength = buffer.readUInt16LE(pos + 30);
    const commentLength = buffer.readUInt16LE(pos + 32);
    pos += CENTRAL_HEADER_MIN_BYTES + nameLength + extraLength + commentLength;
  }
  return null;
}

/**
 * PRC-L589: plain text for any exceljs cell value. Formula cells use their
 * cached result; rich text and hyperlinks use their text; error cells are blank.
 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0] ?? '';
  if (typeof value === 'object') {
    const v = value as {
      result?: unknown;
      formula?: unknown;
      sharedFormula?: unknown;
      richText?: Array<{ text?: unknown }>;
      text?: unknown;
      error?: unknown;
    };
    if ('formula' in v || 'sharedFormula' in v || 'result' in v) return cellText(v.result);
    if (Array.isArray(v.richText)) {
      return v.richText
        .map((part) => String(part.text ?? ''))
        .join('')
        .trim();
    }
    if ('text' in v) return cellText(v.text);
    if ('error' in v) return '';
  }
  return String(value).trim();
}

/**
 * Parse an Excel buffer into student import rows.
 * Validates that the file has the expected headers and extracts data rows.
 *
 * @param buffer - The Excel file buffer
 * @param overrides - PRC-L589 parse bounds (defaults: MAX_IMPORT_* constants)
 * @returns Parsed rows and any header-level errors
 */
export async function parseExcelBuffer(
  buffer: Buffer,
  overrides: Partial<ImportParseLimits> = {},
): Promise<ParseResult> {
  const limits: ImportParseLimits = {
    maxRows: MAX_IMPORT_ROWS,
    maxUncompressedBytes: MAX_IMPORT_UNCOMPRESSED_BYTES,
    maxEntries: MAX_IMPORT_ZIP_ENTRIES,
    ...overrides,
  };
  const archiveError = inspectZipBounds(buffer, limits);
  if (archiveError) {
    return { rows: [], headerErrors: [archiveError] };
  }

  const workbook = await createExcelWorkbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { rows: [], headerErrors: ['No worksheet found in the Excel file'] };
  }

  const dataRows = Math.max(0, worksheet.rowCount - 1);
  if (dataRows > limits.maxRows) {
    return {
      rows: [],
      headerErrors: [`File has ${dataRows} data rows; the maximum is ${limits.maxRows}`],
    };
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
      return cellText(row.getCell(colIdx + 1).value);
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
    if (cellText(row.getCell(i).value) !== '') {
      return false;
    }
  }
  return true;
}
