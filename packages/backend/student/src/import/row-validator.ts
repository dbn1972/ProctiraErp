/**
 * Row-level Validator for Student Import
 *
 * Validates each parsed row against mandatory field rules and format constraints.
 * Returns structured errors with row number and specific validation failure.
 *
 * Requirements:
 * - 6.7: Validate each row against mandatory field rules and uniqueness constraints
 * - 19.2: Return detailed error report for invalid rows
 */

import type { ImportStudentRow, ImportRowError } from './types.js';

/** ISO date pattern: YYYY-MM-DD */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Email pattern (basic) */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate a single import row against mandatory field rules and format constraints.
 *
 * @param row - The parsed student row
 * @returns Array of validation errors (empty if valid)
 */
export function validateRow(row: ImportStudentRow): ImportRowError[] {
  const errors: ImportRowError[] = [];

  // Mandatory field: firstName
  if (!row.firstName || row.firstName.trim().length === 0) {
    errors.push({
      rowNumber: row.rowNumber,
      field: 'first_name',
      message: 'First name is required',
      code: 'REQUIRED_FIELD',
    });
  }

  // Mandatory field: lastName
  if (!row.lastName || row.lastName.trim().length === 0) {
    errors.push({
      rowNumber: row.rowNumber,
      field: 'last_name',
      message: 'Last name is required',
      code: 'REQUIRED_FIELD',
    });
  }

  // Mandatory field: dateOfBirth
  if (!row.dateOfBirth || row.dateOfBirth.trim().length === 0) {
    errors.push({
      rowNumber: row.rowNumber,
      field: 'date_of_birth',
      message: 'Date of birth is required',
      code: 'REQUIRED_FIELD',
    });
  } else if (!ISO_DATE_PATTERN.test(row.dateOfBirth)) {
    errors.push({
      rowNumber: row.rowNumber,
      field: 'date_of_birth',
      message: 'Date of birth must be in YYYY-MM-DD format',
      code: 'INVALID_FORMAT',
    });
  } else {
    // Validate it's a real date
    const date = new Date(row.dateOfBirth);
    if (isNaN(date.getTime())) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'date_of_birth',
        message: 'Date of birth is not a valid date',
        code: 'INVALID_FORMAT',
      });
    }
  }

  // Optional field format: contactEmail
  if (row.contactEmail && !EMAIL_PATTERN.test(row.contactEmail)) {
    errors.push({
      rowNumber: row.rowNumber,
      field: 'contact_email',
      message: 'Contact email is not a valid email address',
      code: 'INVALID_FORMAT',
    });
  }

  // Optional field format: gender (if provided, must be one of known values)
  if (row.gender) {
    const validGenders = ['male', 'female', 'other', 'm', 'f', 'o'];
    if (!validGenders.includes(row.gender.toLowerCase())) {
      errors.push({
        rowNumber: row.rowNumber,
        field: 'gender',
        message: 'Gender must be one of: Male, Female, Other',
        code: 'INVALID_FORMAT',
      });
    }
  }

  return errors;
}

/**
 * Validate all rows and check for in-file duplicates on national ID.
 *
 * @param rows - All parsed student rows
 * @returns Array of all validation errors including in-file duplicates
 */
export function validateAllRows(rows: ImportStudentRow[]): ImportRowError[] {
  const allErrors: ImportRowError[] = [];
  const seenNationalIds = new Map<string, number>(); // nationalId -> first row number

  for (const row of rows) {
    // Per-row validation
    const rowErrors = validateRow(row);
    allErrors.push(...rowErrors);

    // In-file duplicate detection on national ID
    if (row.nationalId) {
      const normalizedId = row.nationalId.trim().toLowerCase();
      const firstRow = seenNationalIds.get(normalizedId);
      if (firstRow !== undefined) {
        allErrors.push({
          rowNumber: row.rowNumber,
          field: 'national_id',
          message: `Duplicate national ID '${row.nationalId}' - same as row ${firstRow}`,
          code: 'DUPLICATE_IN_FILE',
        });
      } else {
        seenNationalIds.set(normalizedId, row.rowNumber);
      }
    }
  }

  return allErrors;
}
