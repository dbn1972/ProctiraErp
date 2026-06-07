/**
 * Unit tests for row-validator.
 *
 * Tests cover:
 * - Mandatory field validation (firstName, lastName, dateOfBirth)
 * - Date format validation
 * - Email format validation
 * - Gender validation
 * - In-file duplicate detection on national ID
 */
import { describe, it, expect } from 'vitest';

import { validateRow, validateAllRows } from './row-validator.js';
import type { ImportStudentRow } from './types.js';

function validRow(overrides: Partial<ImportStudentRow> = {}): ImportStudentRow {
  return {
    rowNumber: 2,
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '2005-03-15',
    ...overrides,
  };
}

describe('validateRow', () => {
  it('should return no errors for a valid row', () => {
    const errors = validateRow(validRow());
    expect(errors).toHaveLength(0);
  });

  it('should return error when firstName is empty', () => {
    const errors = validateRow(validRow({ firstName: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      rowNumber: 2,
      field: 'first_name',
      code: 'REQUIRED_FIELD',
    });
  });

  it('should return error when lastName is empty', () => {
    const errors = validateRow(validRow({ lastName: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      rowNumber: 2,
      field: 'last_name',
      code: 'REQUIRED_FIELD',
    });
  });

  it('should return error when dateOfBirth is empty', () => {
    const errors = validateRow(validRow({ dateOfBirth: '' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      rowNumber: 2,
      field: 'date_of_birth',
      code: 'REQUIRED_FIELD',
    });
  });

  it('should return error when dateOfBirth has invalid format', () => {
    const errors = validateRow(validRow({ dateOfBirth: '15/03/2005' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      rowNumber: 2,
      field: 'date_of_birth',
      code: 'INVALID_FORMAT',
      message: 'Date of birth must be in YYYY-MM-DD format',
    });
  });

  it('should return error when dateOfBirth is not a real date', () => {
    const errors = validateRow(validRow({ dateOfBirth: '2005-13-45' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: 'date_of_birth',
      code: 'INVALID_FORMAT',
    });
  });

  it('should return error when contactEmail has invalid format', () => {
    const errors = validateRow(validRow({ contactEmail: 'not-an-email' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: 'contact_email',
      code: 'INVALID_FORMAT',
    });
  });

  it('should accept valid email format', () => {
    const errors = validateRow(validRow({ contactEmail: 'john@example.com' }));
    expect(errors).toHaveLength(0);
  });

  it('should return error when gender is invalid', () => {
    const errors = validateRow(validRow({ gender: 'unknown' }));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      field: 'gender',
      code: 'INVALID_FORMAT',
    });
  });

  it('should accept valid gender values (case-insensitive)', () => {
    for (const gender of ['Male', 'female', 'OTHER', 'M', 'f', 'O']) {
      const errors = validateRow(validRow({ gender }));
      expect(errors).toHaveLength(0);
    }
  });

  it('should return multiple errors for multiple invalid fields', () => {
    const errors = validateRow(validRow({ firstName: '', lastName: '', dateOfBirth: '' }));
    expect(errors).toHaveLength(3);
  });

  it('should include correct row number in errors', () => {
    const errors = validateRow(validRow({ rowNumber: 42, firstName: '' }));
    expect(errors[0]!.rowNumber).toBe(42);
  });
});

describe('validateAllRows', () => {
  it('should validate all rows and aggregate errors', () => {
    const rows: ImportStudentRow[] = [
      validRow({ rowNumber: 2 }),
      validRow({ rowNumber: 3, firstName: '' }),
      validRow({ rowNumber: 4, dateOfBirth: 'bad-date' }),
    ];

    const errors = validateAllRows(rows);
    expect(errors).toHaveLength(2);
    expect(errors[0]!.rowNumber).toBe(3);
    expect(errors[1]!.rowNumber).toBe(4);
  });

  it('should detect in-file duplicate national IDs', () => {
    const rows: ImportStudentRow[] = [
      validRow({ rowNumber: 2, nationalId: 'NID-001' }),
      validRow({ rowNumber: 3, nationalId: 'NID-002' }),
      validRow({ rowNumber: 4, nationalId: 'NID-001' }), // duplicate
    ];

    const errors = validateAllRows(rows);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      rowNumber: 4,
      field: 'national_id',
      code: 'DUPLICATE_IN_FILE',
    });
  });

  it('should detect in-file duplicates case-insensitively', () => {
    const rows: ImportStudentRow[] = [
      validRow({ rowNumber: 2, nationalId: 'ABC123' }),
      validRow({ rowNumber: 3, nationalId: 'abc123' }), // same, different case
    ];

    const errors = validateAllRows(rows);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.rowNumber).toBe(3);
  });

  it('should return empty array for all valid rows with unique IDs', () => {
    const rows: ImportStudentRow[] = [
      validRow({ rowNumber: 2, nationalId: 'NID-001' }),
      validRow({ rowNumber: 3, nationalId: 'NID-002' }),
      validRow({ rowNumber: 4, nationalId: 'NID-003' }),
    ];

    const errors = validateAllRows(rows);
    expect(errors).toHaveLength(0);
  });

  it('should not flag rows without national IDs as duplicates', () => {
    const rows: ImportStudentRow[] = [
      validRow({ rowNumber: 2 }), // no nationalId
      validRow({ rowNumber: 3 }), // no nationalId
    ];

    const errors = validateAllRows(rows);
    expect(errors).toHaveLength(0);
  });
});
