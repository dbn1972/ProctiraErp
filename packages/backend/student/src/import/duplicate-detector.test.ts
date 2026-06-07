/**
 * Unit tests for duplicate-detector.
 *
 * Tests cover:
 * - National ID duplicate detection
 * - Name + DOB duplicate detection
 * - Priority: national ID match takes precedence over name+DOB
 * - No duplicates when records don't match
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { detectDuplicates } from './duplicate-detector.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import type { ImportStudentRow, StudentRecord } from './types.js';

const TENANT_ID = 'test-tenant-001';

function validRow(overrides: Partial<ImportStudentRow> = {}): ImportStudentRow {
  return {
    rowNumber: 2,
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '2005-03-15',
    ...overrides,
  };
}

function existingStudent(overrides: Partial<StudentRecord> = {}): StudentRecord {
  return {
    id: 'existing-student-001',
    tenantId: TENANT_ID,
    firstName: 'John',
    lastName: 'Doe',
    dateOfBirth: '2005-03-15',
    gender: 'Male',
    nationalId: 'NID-EXISTING-001',
    nationality: null,
    contactPhone: null,
    contactEmail: null,
    guardianName: null,
    guardianPhone: null,
    institutionCode: null,
    customData: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('detectDuplicates', () => {
  let repository: InMemoryStudentRepository;

  beforeEach(() => {
    repository = new InMemoryStudentRepository();
  });

  it('should detect duplicate by national ID', async () => {
    repository.seed([existingStudent({ nationalId: 'NID-001' })]);

    const rows = [validRow({ rowNumber: 2, nationalId: 'NID-001' })];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      rowNumber: 2,
      existingStudentId: 'existing-student-001',
      matchType: 'national_id',
      matchedFields: { national_id: 'NID-001' },
    });
  });

  it('should detect duplicate by name + DOB', async () => {
    repository.seed([
      existingStudent({
        id: 'student-xyz',
        firstName: 'Jane',
        lastName: 'Smith',
        dateOfBirth: '2006-07-20',
        nationalId: null,
      }),
    ]);

    const rows = [
      validRow({
        rowNumber: 3,
        firstName: 'Jane',
        lastName: 'Smith',
        dateOfBirth: '2006-07-20',
      }),
    ];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]).toMatchObject({
      rowNumber: 3,
      existingStudentId: 'student-xyz',
      matchType: 'name_dob',
      matchedFields: {
        first_name: 'Jane',
        last_name: 'Smith',
        date_of_birth: '2006-07-20',
      },
    });
  });

  it('should prioritize national ID match over name+DOB', async () => {
    repository.seed([
      existingStudent({
        id: 'student-nid',
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '2005-03-15',
        nationalId: 'NID-MATCH',
      }),
    ]);

    // Row matches both national ID and name+DOB
    const rows = [
      validRow({
        rowNumber: 2,
        firstName: 'John',
        lastName: 'Doe',
        dateOfBirth: '2005-03-15',
        nationalId: 'NID-MATCH',
      }),
    ];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    // Should only report one match (national_id takes priority)
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.matchType).toBe('national_id');
  });

  it('should return empty array when no duplicates found', async () => {
    repository.seed([existingStudent({ nationalId: 'NID-OTHER' })]);

    const rows = [validRow({ rowNumber: 2, nationalId: 'NID-NEW', firstName: 'Alice', lastName: 'Wonder' })];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(0);
  });

  it('should not match across different tenants', async () => {
    repository.seed([
      existingStudent({ tenantId: 'other-tenant', nationalId: 'NID-001' }),
    ]);

    const rows = [validRow({ rowNumber: 2, nationalId: 'NID-001' })];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(0);
  });

  it('should detect multiple duplicates in a batch', async () => {
    repository.seed([
      existingStudent({ id: 'student-1', nationalId: 'NID-A' }),
      existingStudent({
        id: 'student-2',
        firstName: 'Alice',
        lastName: 'Wonder',
        dateOfBirth: '2004-01-01',
        nationalId: null,
      }),
    ]);

    const rows = [
      validRow({ rowNumber: 2, nationalId: 'NID-A' }),
      validRow({ rowNumber: 3, firstName: 'Alice', lastName: 'Wonder', dateOfBirth: '2004-01-01' }),
      validRow({ rowNumber: 4, firstName: 'New', lastName: 'Student', dateOfBirth: '2007-06-01' }),
    ];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(2);
    expect(duplicates[0]!.rowNumber).toBe(2);
    expect(duplicates[1]!.rowNumber).toBe(3);
  });

  it('should handle rows without national ID (only check name+DOB)', async () => {
    repository.seed([
      existingStudent({
        id: 'student-no-nid',
        firstName: 'Bob',
        lastName: 'Builder',
        dateOfBirth: '2003-12-25',
        nationalId: null,
      }),
    ]);

    const rows = [
      validRow({
        rowNumber: 2,
        firstName: 'Bob',
        lastName: 'Builder',
        dateOfBirth: '2003-12-25',
        // no nationalId
      }),
    ];
    const duplicates = await detectDuplicates(TENANT_ID, rows, repository);

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]!.matchType).toBe('name_dob');
  });
});
