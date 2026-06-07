/**
 * Property-based tests for Bulk Import Validation and Duplicate Detection.
 *
 * Property 15: Bulk Import Row-Level Validation
 * For any Excel import file containing a mix of valid and invalid rows, the system
 * SHALL import all valid rows, reject all invalid rows without importing them, and
 * produce an error report listing each failed row with its row number and the specific
 * validation failure.
 *
 * Property 16: Duplicate Detection on Import
 * For any import row matching an existing record on configured unique identifiers
 * (national ID, or name + DOB combination), the system SHALL flag the duplicate and
 * present options to skip, update, or create a new record.
 *
 * **Validates: Requirements 6.7, 6.8, 19.2, 19.5**
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fc from 'fast-check';

import { validateRow, validateAllRows } from './row-validator.js';
import { detectDuplicates } from './duplicate-detector.js';
import { ImportService } from './import-service.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import type { ImportStudentRow, ImportRowError, StudentRecord } from './types.js';

// --- Arbitraries ---

/**
 * Generates a valid ISO date string (YYYY-MM-DD) that represents a real date.
 */
const validDateArb: fc.Arbitrary<string> = fc
  .record({
    year: fc.integer({ min: 1950, max: 2020 }),
    month: fc.integer({ min: 1, max: 12 }),
    day: fc.integer({ min: 1, max: 28 }), // Use 28 to avoid invalid day-of-month
  })
  .map(({ year, month, day }) => {
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${year}-${m}-${d}`;
  });

/**
 * Generates a non-empty name string (letters and spaces only).
 */
const nameArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')),
  { minLength: 1, maxLength: 30 },
);

/**
 * Generates a valid gender value.
 */
const validGenderArb: fc.Arbitrary<string> = fc.constantFrom(
  'Male', 'Female', 'Other', 'male', 'female', 'other', 'M', 'F', 'O', 'm', 'f', 'o',
);

/**
 * Generates a valid email address.
 */
const validEmailArb: fc.Arbitrary<string> = fc
  .record({
    local: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')),
      { minLength: 1, maxLength: 10 },
    ),
    domain: fc.stringOf(
      fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
      { minLength: 2, maxLength: 10 },
    ),
  })
  .map(({ local, domain }) => `${local}@${domain}.com`);

/**
 * Generates a national ID string.
 */
const nationalIdArb: fc.Arbitrary<string> = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-'.split('')),
  { minLength: 3, maxLength: 20 },
);

/**
 * Generates a valid import row (all mandatory fields present and correctly formatted).
 */
const validImportRowArb: fc.Arbitrary<ImportStudentRow> = fc
  .record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: nameArb,
    dateOfBirth: validDateArb,
    gender: fc.option(validGenderArb, { nil: undefined }),
    nationalId: fc.option(nationalIdArb, { nil: undefined }),
    contactEmail: fc.option(validEmailArb, { nil: undefined }),
  })
  .map((r) => ({
    rowNumber: r.rowNumber,
    firstName: r.firstName,
    lastName: r.lastName,
    dateOfBirth: r.dateOfBirth,
    gender: r.gender,
    nationalId: r.nationalId,
    contactEmail: r.contactEmail,
  }));

/**
 * Generates an invalid import row (at least one mandatory field is missing or malformed).
 */
const invalidImportRowArb: fc.Arbitrary<ImportStudentRow> = fc.oneof(
  // Missing firstName
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: fc.constant(''),
    lastName: nameArb,
    dateOfBirth: validDateArb,
  }).map((r) => ({ ...r } as ImportStudentRow)),
  // Missing lastName
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: fc.constant(''),
    dateOfBirth: validDateArb,
  }).map((r) => ({ ...r } as ImportStudentRow)),
  // Missing dateOfBirth
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: nameArb,
    dateOfBirth: fc.constant(''),
  }).map((r) => ({ ...r } as ImportStudentRow)),
  // Invalid date format
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: nameArb,
    dateOfBirth: fc.constantFrom('15/03/2005', '2005-13-45', 'not-a-date', '01-01-2000', '2005/03/15'),
  }).map((r) => ({ ...r } as ImportStudentRow)),
  // Invalid email format
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: nameArb,
    dateOfBirth: validDateArb,
    contactEmail: fc.constantFrom('not-an-email', 'missing@', '@nodomain', 'spaces in@email.com'),
  }).map((r) => ({ ...r } as ImportStudentRow)),
  // Invalid gender
  fc.record({
    rowNumber: fc.integer({ min: 2, max: 10000 }),
    firstName: nameArb,
    lastName: nameArb,
    dateOfBirth: validDateArb,
    gender: fc.constantFrom('unknown', 'X', 'nonbinary', 'invalid', '123'),
  }).map((r) => ({ ...r } as ImportStudentRow)),
);

/**
 * Generates a tenant ID.
 */
const tenantIdArb: fc.Arbitrary<string> = fc.uuid();

// --- Property 15: Bulk Import Row-Level Validation ---

describe('Property 15: Bulk Import Row-Level Validation', () => {
  // **Validates: Requirements 6.7, 19.2**

  let repository: InMemoryStudentRepository;
  let queue: InMemoryImportQueue;
  let service: ImportService;

  beforeEach(() => {
    repository = new InMemoryStudentRepository();
    queue = new InMemoryImportQueue();
    service = new ImportService({
      studentRepository: repository,
      importQueue: queue,
    });
  });

  it('every invalid row produces at least one error with its row number and specific validation failure', () => {
    fc.assert(
      fc.property(
        invalidImportRowArb,
        (invalidRow) => {
          const errors = validateRow(invalidRow);

          // Every invalid row must produce at least one error
          expect(errors.length).toBeGreaterThanOrEqual(1);

          // Each error must reference the correct row number
          for (const error of errors) {
            expect(error.rowNumber).toBe(invalidRow.rowNumber);
            // Each error must have a specific field
            expect(error.field).toBeTruthy();
            // Each error must have a human-readable message
            expect(error.message).toBeTruthy();
            expect(error.message.length).toBeGreaterThan(0);
            // Each error must have a valid error code
            expect(['REQUIRED_FIELD', 'INVALID_FORMAT', 'DUPLICATE_IN_FILE', 'UNIQUENESS_VIOLATION']).toContain(error.code);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('valid rows produce zero validation errors', () => {
    fc.assert(
      fc.property(
        validImportRowArb,
        (validRow) => {
          const errors = validateRow(validRow);
          expect(errors).toHaveLength(0);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('for any mix of valid and invalid rows, only valid rows are imported and all invalid rows appear in the error report', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        fc.array(validImportRowArb, { minLength: 0, maxLength: 10 }),
        fc.array(invalidImportRowArb, { minLength: 1, maxLength: 10 }),
        async (tenantId, validRows, invalidRows) => {
          // Assign unique row numbers to avoid conflicts
          let rowNum = 2;
          const numberedValidRows = validRows.map((r) => ({ ...r, rowNumber: rowNum++ }));
          const numberedInvalidRows = invalidRows.map((r) => ({ ...r, rowNumber: rowNum++ }));

          // Ensure valid rows have unique national IDs to avoid in-file duplicate errors
          const usedNationalIds = new Set<string>();
          const deduplicatedValidRows = numberedValidRows.map((r) => {
            if (r.nationalId) {
              const normalized = r.nationalId.trim().toLowerCase();
              if (usedNationalIds.has(normalized)) {
                // Remove national ID to avoid in-file duplicate
                return { ...r, nationalId: undefined };
              }
              usedNationalIds.add(normalized);
            }
            return r;
          });

          // Interleave valid and invalid rows
          const allRows: ImportStudentRow[] = [...deduplicatedValidRows, ...numberedInvalidRows];

          const result = await service.processRows(tenantId, allRows, { duplicateResolution: 'skip' });

          // All invalid rows must appear in the error report
          const errorRowNumbers = new Set(result.errors.map((e) => e.rowNumber));
          for (const invalidRow of numberedInvalidRows) {
            expect(errorRowNumbers.has(invalidRow.rowNumber)).toBe(true);
          }

          // Each error must have row number and specific failure message
          for (const error of result.errors) {
            expect(error.rowNumber).toBeGreaterThanOrEqual(2);
            expect(error.field).toBeTruthy();
            expect(error.message).toBeTruthy();
            expect(error.code).toBeTruthy();
          }

          // Valid rows should be imported (success count matches valid row count)
          expect(result.successCount).toBe(deduplicatedValidRows.length);

          // Error count should cover all errors from invalid rows
          expect(result.errorCount).toBeGreaterThanOrEqual(numberedInvalidRows.length);

          // Total rows should match input
          expect(result.totalRows).toBe(allRows.length);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('in-file duplicate national IDs are detected and reported with row numbers', () => {
    fc.assert(
      fc.property(
        nationalIdArb,
        fc.integer({ min: 2, max: 100 }),
        fc.integer({ min: 3, max: 200 }),
        (nationalId, firstRowNum, secondRowNum) => {
          // Ensure different row numbers
          const adjustedSecondRow = secondRowNum === firstRowNum ? secondRowNum + 1 : secondRowNum;

          const rows: ImportStudentRow[] = [
            {
              rowNumber: firstRowNum,
              firstName: 'Alice',
              lastName: 'Smith',
              dateOfBirth: '2005-01-15',
              nationalId,
            },
            {
              rowNumber: adjustedSecondRow,
              firstName: 'Bob',
              lastName: 'Jones',
              dateOfBirth: '2006-03-20',
              nationalId, // same national ID
            },
          ];

          const errors = validateAllRows(rows);

          // The second occurrence should be flagged as a duplicate
          const duplicateErrors = errors.filter((e) => e.code === 'DUPLICATE_IN_FILE');
          expect(duplicateErrors.length).toBeGreaterThanOrEqual(1);
          expect(duplicateErrors[0]!.rowNumber).toBe(adjustedSecondRow);
          expect(duplicateErrors[0]!.field).toBe('national_id');
        },
      ),
      { numRuns: 100 },
    );
  });
});

// --- Property 16: Duplicate Detection on Import ---

describe('Property 16: Duplicate Detection on Import', () => {
  // **Validates: Requirements 6.8, 19.5**

  let repository: InMemoryStudentRepository;
  let queue: InMemoryImportQueue;
  let service: ImportService;

  beforeEach(() => {
    repository = new InMemoryStudentRepository();
    queue = new InMemoryImportQueue();
    service = new ImportService({
      studentRepository: repository,
      importQueue: queue,
    });
  });

  it('any import row matching an existing record by national ID is detected as a duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nationalIdArb,
        nameArb,
        nameArb,
        validDateArb,
        fc.integer({ min: 2, max: 10000 }),
        async (tenantId, nationalId, firstName, lastName, dob, rowNumber) => {
          // Seed an existing student with the national ID
          repository.clear();
          repository.seed([{
            id: 'existing-student-001',
            tenantId,
            firstName: 'Existing',
            lastName: 'Student',
            dateOfBirth: '2000-01-01',
            gender: 'Male',
            nationalId,
            nationality: null,
            contactPhone: null,
            contactEmail: null,
            guardianName: null,
            guardianPhone: null,
            institutionCode: null,
            customData: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);

          // Import row with the same national ID
          const rows: ImportStudentRow[] = [{
            rowNumber,
            firstName,
            lastName,
            dateOfBirth: dob,
            nationalId,
          }];

          const duplicates = await detectDuplicates(tenantId, rows, repository);

          // The duplicate must be detected
          expect(duplicates.length).toBe(1);
          expect(duplicates[0]!.rowNumber).toBe(rowNumber);
          expect(duplicates[0]!.matchType).toBe('national_id');
          expect(duplicates[0]!.existingStudentId).toBe('existing-student-001');
          expect(duplicates[0]!.matchedFields).toHaveProperty('national_id');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('any import row matching an existing record by name+DOB is detected as a duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nameArb,
        nameArb,
        validDateArb,
        fc.integer({ min: 2, max: 10000 }),
        async (tenantId, firstName, lastName, dob, rowNumber) => {
          // Seed an existing student with the same name and DOB
          repository.clear();
          repository.seed([{
            id: 'existing-student-002',
            tenantId,
            firstName,
            lastName,
            dateOfBirth: dob,
            gender: null,
            nationalId: null, // no national ID so name+DOB check is used
            nationality: null,
            contactPhone: null,
            contactEmail: null,
            guardianName: null,
            guardianPhone: null,
            institutionCode: null,
            customData: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);

          // Import row with the same name and DOB (no national ID)
          const rows: ImportStudentRow[] = [{
            rowNumber,
            firstName,
            lastName,
            dateOfBirth: dob,
          }];

          const duplicates = await detectDuplicates(tenantId, rows, repository);

          // The duplicate must be detected
          expect(duplicates.length).toBe(1);
          expect(duplicates[0]!.rowNumber).toBe(rowNumber);
          expect(duplicates[0]!.matchType).toBe('name_dob');
          expect(duplicates[0]!.existingStudentId).toBe('existing-student-002');
          expect(duplicates[0]!.matchedFields).toHaveProperty('first_name');
          expect(duplicates[0]!.matchedFields).toHaveProperty('last_name');
          expect(duplicates[0]!.matchedFields).toHaveProperty('date_of_birth');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('duplicate resolution "skip" does not import the duplicate row', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nationalIdArb,
        nameArb,
        nameArb,
        validDateArb,
        async (tenantId, nationalId, firstName, lastName, dob) => {
          repository.clear();
          repository.seed([{
            id: 'existing-skip',
            tenantId,
            firstName: 'Original',
            lastName: 'Record',
            dateOfBirth: '2000-01-01',
            gender: null,
            nationalId,
            nationality: null,
            contactPhone: null,
            contactEmail: null,
            guardianName: null,
            guardianPhone: null,
            institutionCode: null,
            customData: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);

          const rows: ImportStudentRow[] = [{
            rowNumber: 2,
            firstName,
            lastName,
            dateOfBirth: dob,
            nationalId,
          }];

          const result = await service.processRows(tenantId, rows, { duplicateResolution: 'skip' });

          // Duplicate is detected
          expect(result.duplicateCount).toBe(1);
          // Row is not imported (skipped)
          expect(result.successCount).toBe(0);
          // Only the original record exists
          const allStudents = repository.getAll();
          expect(allStudents).toHaveLength(1);
          expect(allStudents[0]!.id).toBe('existing-skip');
        },
      ),
      { numRuns: 100 },
    );
  });

  it('duplicate resolution "update" updates the existing record', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nationalIdArb,
        nameArb,
        nameArb,
        validDateArb,
        async (tenantId, nationalId, firstName, lastName, dob) => {
          repository.clear();
          repository.seed([{
            id: 'existing-update',
            tenantId,
            firstName: 'Original',
            lastName: 'Name',
            dateOfBirth: '2000-01-01',
            gender: null,
            nationalId,
            nationality: null,
            contactPhone: null,
            contactEmail: null,
            guardianName: null,
            guardianPhone: null,
            institutionCode: null,
            customData: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);

          const rows: ImportStudentRow[] = [{
            rowNumber: 2,
            firstName,
            lastName,
            dateOfBirth: dob,
            nationalId,
          }];

          const result = await service.processRows(tenantId, rows, { duplicateResolution: 'update' });

          // Duplicate is detected and updated
          expect(result.duplicateCount).toBe(1);
          expect(result.successCount).toBe(1);
          // The existing record should be updated with new data
          const allStudents = repository.getAll();
          expect(allStudents).toHaveLength(1);
          expect(allStudents[0]!.id).toBe('existing-update');
          expect(allStudents[0]!.firstName).toBe(firstName.trim());
          expect(allStudents[0]!.lastName).toBe(lastName.trim());
        },
      ),
      { numRuns: 100 },
    );
  });

  it('duplicate resolution "create" creates a new record despite the duplicate', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nationalIdArb,
        nameArb,
        nameArb,
        validDateArb,
        async (tenantId, nationalId, firstName, lastName, dob) => {
          repository.clear();
          repository.seed([{
            id: 'existing-create',
            tenantId,
            firstName: 'Original',
            lastName: 'Record',
            dateOfBirth: '2000-01-01',
            gender: null,
            nationalId,
            nationality: null,
            contactPhone: null,
            contactEmail: null,
            guardianName: null,
            guardianPhone: null,
            institutionCode: null,
            customData: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          }]);

          const rows: ImportStudentRow[] = [{
            rowNumber: 2,
            firstName,
            lastName,
            dateOfBirth: dob,
            nationalId,
          }];

          const result = await service.processRows(tenantId, rows, { duplicateResolution: 'create' });

          // Duplicate is detected but a new record is created
          expect(result.duplicateCount).toBe(1);
          expect(result.successCount).toBe(1);
          // Both the original and new record should exist
          const allStudents = repository.getAll();
          expect(allStudents).toHaveLength(2);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('all duplicates in a batch are detected regardless of match type', async () => {
    await fc.assert(
      fc.asyncProperty(
        tenantIdArb,
        nationalIdArb,
        nameArb,
        nameArb,
        validDateArb,
        nameArb,
        nameArb,
        validDateArb,
        async (tenantId, nationalId, firstName1, lastName1, dob1, firstName2, lastName2, dob2) => {
          repository.clear();
          // Seed two existing students: one with national ID, one with name+DOB
          repository.seed([
            {
              id: 'student-nid-match',
              tenantId,
              firstName: 'Other',
              lastName: 'Person',
              dateOfBirth: '1999-01-01',
              gender: null,
              nationalId,
              nationality: null,
              contactPhone: null,
              contactEmail: null,
              guardianName: null,
              guardianPhone: null,
              institutionCode: null,
              customData: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
            {
              id: 'student-namedob-match',
              tenantId,
              firstName: firstName2,
              lastName: lastName2,
              dateOfBirth: dob2,
              gender: null,
              nationalId: null, // no national ID
              nationality: null,
              contactPhone: null,
              contactEmail: null,
              guardianName: null,
              guardianPhone: null,
              institutionCode: null,
              customData: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ]);

          // Import rows that match both existing records
          const rows: ImportStudentRow[] = [
            {
              rowNumber: 2,
              firstName: firstName1,
              lastName: lastName1,
              dateOfBirth: dob1,
              nationalId, // matches first existing student
            },
            {
              rowNumber: 3,
              firstName: firstName2,
              lastName: lastName2,
              dateOfBirth: dob2,
              // no nationalId, matches second existing student by name+DOB
            },
          ];

          const duplicates = await detectDuplicates(tenantId, rows, repository);

          // Both duplicates should be detected
          expect(duplicates.length).toBe(2);

          const nidMatch = duplicates.find((d) => d.matchType === 'national_id');
          const nameDobMatch = duplicates.find((d) => d.matchType === 'name_dob');

          expect(nidMatch).toBeDefined();
          expect(nidMatch!.rowNumber).toBe(2);
          expect(nidMatch!.existingStudentId).toBe('student-nid-match');

          expect(nameDobMatch).toBeDefined();
          expect(nameDobMatch!.rowNumber).toBe(3);
          expect(nameDobMatch!.existingStudentId).toBe('student-namedob-match');
        },
      ),
      { numRuns: 100 },
    );
  });
});
