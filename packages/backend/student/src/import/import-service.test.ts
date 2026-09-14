/**
 * Unit tests for ImportService.
 *
 * Tests cover:
 * - Synchronous import with valid rows
 * - Validation error reporting with row numbers
 * - Duplicate detection and resolution (skip, update, create)
 * - Async queueing for large imports
 * - Error report generation
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { ImportService } from './import-service.js';
import { InMemoryStudentRepository } from './in-memory-student-repository.js';
import { InMemoryImportQueue } from './in-memory-import-queue.js';
import type { ImportStudentRow, ImportResult, ImportProgress, StudentRecord } from './types.js';

const TENANT_ID = 'test-tenant-001';

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

describe('ImportService', () => {
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

  describe('processRows', () => {
    it('should import all valid rows successfully', async () => {
      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15' },
        { rowNumber: 3, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2006-03-20' },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(2);
      expect(result.errorCount).toBe(0);
      expect(result.duplicateCount).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.duplicates).toHaveLength(0);

      // Verify records were created
      const allStudents = repository.getAll();
      expect(allStudents).toHaveLength(2);
      expect(allStudents[0]!.firstName).toBe('Alice');
      expect(allStudents[1]!.firstName).toBe('Bob');
    });

    it('should report validation errors with row numbers', async () => {
      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15' },
        { rowNumber: 3, firstName: '', lastName: 'Jones', dateOfBirth: '2006-03-20' }, // invalid
        { rowNumber: 4, firstName: 'Charlie', lastName: '', dateOfBirth: 'bad-date' }, // 2 errors
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });

      expect(result.totalRows).toBe(3);
      expect(result.successCount).toBe(1); // only Alice
      expect(result.errorCount).toBe(3); // 1 from row 3, 2 from row 4
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]!.rowNumber).toBe(3);
      expect(result.errors[1]!.rowNumber).toBe(4);
      expect(result.errors[2]!.rowNumber).toBe(4);
    });

    it('should detect duplicates and skip them when resolution is "skip"', async () => {
      repository.seed([existingStudent({ nationalId: 'NID-001' })]);

      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'New', lastName: 'Student', dateOfBirth: '2007-06-01' },
        {
          rowNumber: 3,
          firstName: 'Dup',
          lastName: 'Student',
          dateOfBirth: '2005-03-15',
          nationalId: 'NID-001',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });

      expect(result.totalRows).toBe(2);
      expect(result.successCount).toBe(1); // only the new student
      expect(result.duplicateCount).toBe(1);
      expect(result.duplicates).toHaveLength(1);
      expect(result.duplicates[0]!.rowNumber).toBe(3);
      expect(result.duplicates[0]!.matchType).toBe('national_id');

      // Only 1 new record created (the non-duplicate)
      const allStudents = repository.getAll();
      expect(allStudents).toHaveLength(2); // 1 seeded + 1 new
    });

    it('should update existing records when resolution is "update"', async () => {
      repository.seed([existingStudent({ id: 'student-to-update', nationalId: 'NID-UPD' })]);

      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: 'Updated',
          lastName: 'Name',
          dateOfBirth: '2005-03-15',
          nationalId: 'NID-UPD',
          contactEmail: 'new@email.com',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'update' });

      expect(result.totalRows).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.duplicateCount).toBe(1);

      // Verify the existing record was updated
      const allStudents = repository.getAll();
      const updated = allStudents.find((s) => s.id === 'student-to-update');
      expect(updated).toBeDefined();
      expect(updated!.firstName).toBe('Updated');
      expect(updated!.contactEmail).toBe('new@email.com');
    });

    it('should create new records for duplicates when resolution is "create"', async () => {
      repository.seed([existingStudent({ nationalId: 'NID-CREATE' })]);

      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: 'Another',
          lastName: 'Record',
          dateOfBirth: '2005-03-15',
          nationalId: 'NID-CREATE',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'create' });

      expect(result.totalRows).toBe(1);
      expect(result.successCount).toBe(1);
      expect(result.duplicateCount).toBe(1);

      // Both the original and new record should exist
      const allStudents = repository.getAll();
      expect(allStudents).toHaveLength(2);
    });

    it('should not import invalid rows even if they are duplicates', async () => {
      repository.seed([existingStudent({ nationalId: 'NID-INVALID' })]);

      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: '', // invalid - missing required field
          lastName: 'Test',
          dateOfBirth: '2005-03-15',
          nationalId: 'NID-INVALID',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'update' });

      expect(result.totalRows).toBe(1);
      expect(result.successCount).toBe(0);
      expect(result.errorCount).toBe(1);
      expect(result.duplicateCount).toBe(0); // not checked because row is invalid
    });

    it('should handle empty row list', async () => {
      const result = await service.processRows(TENANT_ID, [], { duplicateResolution: 'skip' });

      expect(result.totalRows).toBe(0);
      expect(result.successCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.duplicateCount).toBe(0);
    });

    it('should detect name+DOB duplicates', async () => {
      repository.seed([
        existingStudent({
          id: 'student-namedob',
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '2004-11-30',
          nationalId: null,
        }),
      ]);

      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: 'Jane',
          lastName: 'Doe',
          dateOfBirth: '2004-11-30',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });

      expect(result.duplicateCount).toBe(1);
      expect(result.duplicates[0]!.matchType).toBe('name_dob');
      expect(result.successCount).toBe(0);
    });

    it('should trim whitespace from imported values', async () => {
      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: '  Alice  ',
          lastName: '  Smith  ',
          dateOfBirth: '2005-01-15',
          nationalId: '  NID-TRIM  ',
        },
      ];

      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });

      expect(result.successCount).toBe(1);
      const allStudents = repository.getAll();
      expect(allStudents[0]!.firstName).toBe('Alice');
      expect(allStudents[0]!.lastName).toBe('Smith');
      expect(allStudents[0]!.nationalId).toBe('NID-TRIM');
    });

    it('G-307 dry-run validates and reports row errors without writing', async () => {
      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15' },
        { rowNumber: 3, firstName: '', lastName: 'Broken', dateOfBirth: 'bad-date' },
      ];

      const result = await service.processRows(TENANT_ID, rows, {
        duplicateResolution: 'skip',
        dryRun: true,
      });

      expect(result.dryRun).toBe(true);
      expect(result.successCount).toBe(0);
      expect(result.errorCount).toBeGreaterThanOrEqual(1);
      expect(result.errors.some((e) => e.rowNumber === 3)).toBe(true);
      expect(repository.getAll()).toHaveLength(0);
    });

    it('G-307 commit path marks transactional on success', async () => {
      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15' },
      ];
      const result = await service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' });
      expect(result.transactional).toBe(true);
      expect(result.successCount).toBe(1);
    });
  });


    it('W2-JOB-12: mid-batch create failure rolls back prior creates', async () => {
      const rows: ImportStudentRow[] = [
        { rowNumber: 2, firstName: 'Alice', lastName: 'Smith', dateOfBirth: '2005-01-15', nationalId: 'NID-A' },
        { rowNumber: 3, firstName: 'Bob', lastName: 'Jones', dateOfBirth: '2005-02-20', nationalId: 'NID-B' },
        { rowNumber: 4, firstName: 'Carol', lastName: 'Lee', dateOfBirth: '2005-03-10', nationalId: 'NID-C' },
      ];

      let createCount = 0;
      const originalCreate = repository.create.bind(repository);
      repository.create = async (tenantId, data) => {
        createCount += 1;
        if (createCount === 3) {
          throw new Error('simulated DB failure on third create');
        }
        return originalCreate(tenantId, data);
      };

      await expect(
        service.processRows(TENANT_ID, rows, { duplicateResolution: 'skip' }),
      ).rejects.toThrow(/simulated DB failure/);

      expect(repository.getAll()).toHaveLength(0);
    });

    it('W2-JOB-12: mid-batch update failure restores prior snapshots and drops creates', async () => {
      const existing = await repository.create(TENANT_ID, {
        firstName: 'Prior',
        lastName: 'Student',
        dateOfBirth: '2004-01-01',
        gender: null,
        nationalId: 'NID-EXIST',
        nationality: null,
        contactPhone: null,
        contactEmail: null,
        guardianName: null,
        guardianPhone: null,
        institutionCode: null,
        customData: null,
      });

      const rows: ImportStudentRow[] = [
        {
          rowNumber: 2,
          firstName: 'New',
          lastName: 'Kid',
          dateOfBirth: '2005-01-15',
          nationalId: 'NID-NEW',
        },
        {
          rowNumber: 3,
          firstName: 'Updated',
          lastName: 'Student',
          dateOfBirth: '2004-01-01',
          nationalId: 'NID-EXIST',
        },
      ];

      const originalUpdate = repository.update.bind(repository);
      let updates = 0;
      repository.update = async (tenantId, id, data) => {
        updates += 1;
        if (updates === 1) {
          throw new Error('simulated update failure');
        }
        return originalUpdate(tenantId, id, data);
      };

      await expect(
        service.processRows(TENANT_ID, rows, { duplicateResolution: 'update' }),
      ).rejects.toThrow(/simulated update failure/);

      const remaining = repository.getAll();
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.id).toBe(existing.id);
      expect(remaining[0]!.firstName).toBe('Prior');
      expect(remaining[0]!.nationalId).toBe('NID-EXIST');
    });

  describe('processImport (async queueing)', () => {
    it('should queue large imports for background processing', async () => {
      // Create a valid Excel buffer using ExcelJS
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Students');

      // Add headers
      worksheet.addRow(['first_name', 'last_name', 'date_of_birth', 'national_id']);

      // Add enough rows to trigger async (> 1000 rows)
      for (let i = 0; i < 1001; i++) {
        worksheet.addRow([`Student${i}`, `Last${i}`, '2005-01-15', `NID-${i}`]);
      }

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.processImport(TENANT_ID, buffer, {
        duplicateResolution: 'skip',
      });

      // Should return progress info, not result (because > 1000 rows)
      expect('jobId' in result).toBe(true);
      const progress = result as ImportProgress;
      expect(progress.status).toBe('queued');
      expect(progress.jobId).toBeDefined();
      expect(progress.totalRows).toBe(1001);

      // Verify job was enqueued
      const jobs = queue.getEnqueuedJobs();
      expect(jobs.size).toBe(1);
      // Building + parsing a 1001-row workbook exceeds the 5s default while CI
      // runs every backend suite in parallel on a 2-core runner.
    }, 30_000);

    it('should queue when async option is explicitly set', async () => {
      // Create a small valid Excel buffer
      const ExcelJS = await import('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Students');
      worksheet.addRow(['first_name', 'last_name', 'date_of_birth']);
      worksheet.addRow(['Alice', 'Smith', '2005-01-15']);

      const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

      const result = await service.processImport(TENANT_ID, buffer, {
        duplicateResolution: 'skip',
        async: true,
      });

      // Should return progress info even for small file when async is forced
      expect('jobId' in result).toBe(true);
      const progress = result as ImportProgress;
      expect(progress.status).toBe('queued');
    });
  });

  describe('getImportProgress', () => {
    it('should return null for unknown job ID', async () => {
      const progress = await service.getImportProgress('non-existent-job');
      expect(progress).toBeNull();
    });

    it('should return progress for a queued job', async () => {
      // Simulate a queued job
      await queue.updateProgress('job-123', {
        jobId: 'job-123',
        status: 'processing',
        totalRows: 500,
        processedRows: 250,
        progressPercent: 50,
        startedAt: new Date().toISOString(),
      });

      const progress = await service.getImportProgress('job-123');
      expect(progress).toBeDefined();
      expect(progress!.status).toBe('processing');
      expect(progress!.progressPercent).toBe(50);
    });
  });
});
