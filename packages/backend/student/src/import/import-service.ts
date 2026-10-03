/**
 * Student Bulk Import Service
 *
 * Orchestrates the full import pipeline:
 * 1. Parse Excel file
 * 2. Validate all rows
 * 3. Detect duplicates against existing records
 * 4. Apply duplicate resolution strategy (skip, update, create)
 * 5. Import valid, non-duplicate rows
 * 6. Return comprehensive error report
 *
 * For large files (>1000 rows), queues the import via RabbitMQ for background processing.
 *
 * Requirements:
 * - 6.7: Bulk import from Excel up to 50MB with row-level validation
 * - 6.8: Duplicate detection and resolution
 * - 19.1: Excel import with downloadable templates
 * - 19.2: Validate all rows and return detailed error report
 * - 19.4: Handle files up to 50MB with progress indication
 * - 19.5: Flag duplicates with skip/update/create options
 */

import { v4 as uuidv4 } from 'uuid';

import { detectDuplicates } from './duplicate-detector.js';
import { parseExcelBuffer } from './excel-parser.js';
import { QueueProgressStore } from './progress-store.js';
import { validateAllRows } from './row-validator.js';
import type {
  ImportCreateInput,
  ImportOptions,
  ImportProgress,
  ImportProgressStore,
  ImportQueue,
  ImportResult,
  ImportStudentRow,
  StudentRepository,
} from './types.js';

/**
 * PRC-M384: thrown when a non-transactional import failed AND compensation
 * could not fully undo it — the batch may be partially applied.
 */
export class ImportRollbackError extends Error {
  constructor(
    public readonly original: unknown,
    public readonly rollbackFailures: string[],
  ) {
    super(
      `Import failed (${errorMessage(original)}) and ${rollbackFailures.length} compensation step(s) failed; batch may be partially applied`,
    );
    this.name = 'ImportRollbackError';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createData(row: ImportStudentRow): ImportCreateInput {
  return {
    firstName: row.firstName.trim(),
    lastName: row.lastName.trim(),
    dateOfBirth: row.dateOfBirth,
    gender: normalizeGender(row.gender) ?? null,
    nationalId: row.nationalId?.trim() ?? null,
    nationality: row.nationality?.trim() ?? null,
    contactPhone: row.contactPhone?.trim() ?? null,
    contactEmail: row.contactEmail?.trim() ?? null,
    guardianName: row.guardianName?.trim() ?? null,
    guardianPhone: row.guardianPhone?.trim() ?? null,
    institutionCode: row.institutionCode?.trim() ?? null,
    customData: row.customData ?? null,
  };
}

function updateData(row: ImportStudentRow): Partial<ImportCreateInput> {
  const data: Partial<ImportCreateInput> = {};
  if (row.firstName) data.firstName = row.firstName.trim();
  if (row.lastName) data.lastName = row.lastName.trim();
  if (row.dateOfBirth) data.dateOfBirth = row.dateOfBirth;
  if (row.gender) data.gender = normalizeGender(row.gender) ?? null;
  if (row.nationalId) data.nationalId = row.nationalId.trim();
  if (row.nationality) data.nationality = row.nationality.trim();
  if (row.contactPhone) data.contactPhone = row.contactPhone.trim();
  if (row.contactEmail) data.contactEmail = row.contactEmail.trim();
  if (row.guardianName) data.guardianName = row.guardianName.trim();
  if (row.guardianPhone) data.guardianPhone = row.guardianPhone.trim();
  if (row.institutionCode) data.institutionCode = row.institutionCode.trim();
  return data;
}

export interface ImportServiceDependencies {
  studentRepository: StudentRepository;
  importQueue: ImportQueue;
  /** PRC-H092: persisted, tenant-scoped progress (Postgres in the gateway). */
  progressStore?: ImportProgressStore;
}

/**
 * Student Bulk Import Service.
 * Handles synchronous and asynchronous import flows.
 */
export class ImportService {
  private readonly repository: StudentRepository;
  private readonly queue: ImportQueue;
  private readonly progress: ImportProgressStore;

  constructor(deps: ImportServiceDependencies) {
    this.repository = deps.studentRepository;
    this.queue = deps.importQueue;
    this.progress = deps.progressStore ?? new QueueProgressStore(deps.importQueue);
  }

  /**
   * Process a bulk import from an Excel file buffer.
   *
   * For small files (<= 1000 rows), processes synchronously.
   * For large files (> 1000 rows), queues for background processing.
   *
   * @param tenantId - Tenant context
   * @param fileBuffer - Excel file buffer
   * @param options - Import options including duplicate resolution strategy
   * @returns Import result (sync) or progress info (async)
   */
  async processImport(
    tenantId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<ImportResult | ImportProgress> {
    // Parse the Excel file
    const parseResult = await parseExcelBuffer(fileBuffer);

    if (parseResult.headerErrors.length > 0) {
      return {
        totalRows: 0,
        successCount: 0,
        errorCount: parseResult.headerErrors.length,
        duplicateCount: 0,
        errors: parseResult.headerErrors.map((msg) => ({
          rowNumber: 1,
          field: 'header',
          message: msg,
          code: 'INVALID_FORMAT' as const,
        })),
        duplicates: [],
      };
    }

    const rows = parseResult.rows;

    // Determine if we should process async
    if (options.async || rows.length > 1000) {
      const jobId = uuidv4();
      const progress: ImportProgress = {
        jobId,
        status: 'queued',
        totalRows: rows.length,
        processedRows: 0,
        progressPercent: 0,
        startedAt: new Date().toISOString(),
      };

      // PRC-H092: record `queued` before enqueue so a fast consumer's
      // processing/completed progress is never overwritten back to `queued`.
      await this.progress.update(tenantId, jobId, progress);
      await this.queue.enqueue(tenantId, jobId, fileBuffer, options);

      return progress;
    }

    // Process synchronously
    return this.processRows(tenantId, rows, options);
  }

  /**
   * Process parsed rows synchronously.
   * Used for small imports and by the background worker for queued imports.
   *
   * W2-JOB-12: commit is all-or-nothing. Mid-batch failures compensate by
   * deleting created rows and restoring updated snapshots before rethrowing.
   */
  async processRows(
    tenantId: string,
    rows: ImportStudentRow[],
    options: ImportOptions,
  ): Promise<ImportResult> {
    // Step 1: Validate all rows
    const validationErrors = validateAllRows(rows);

    // Separate valid rows from invalid ones
    const invalidRowNumbers = new Set(validationErrors.map((e) => e.rowNumber));
    const validRows = rows.filter((r) => !invalidRowNumbers.has(r.rowNumber));

    // Step 2: Detect duplicates on valid rows
    const duplicates = await detectDuplicates(tenantId, validRows, this.repository);

    // G-307 dry-run: return row errors + duplicates without writing
    if (options.dryRun) {
      return {
        totalRows: rows.length,
        successCount: 0,
        errorCount: validationErrors.length,
        duplicateCount: duplicates.length,
        errors: validationErrors,
        duplicates,
        dryRun: true,
      };
    }

    // Step 3: Apply duplicate resolution and import (transactional = all-or-nothing batch)
    const duplicateRowNumbers = new Set(duplicates.map((d) => d.rowNumber));

    const toCreate: ImportStudentRow[] = [];
    const toUpdate: Array<{ studentId: string; row: ImportStudentRow }> = [];

    const nonDuplicateRows = validRows.filter((r) => !duplicateRowNumbers.has(r.rowNumber));
    toCreate.push(...nonDuplicateRows);

    for (const dup of duplicates) {
      const row = validRows.find((r) => r.rowNumber === dup.rowNumber);
      if (!row) continue;
      switch (options.duplicateResolution) {
        case 'skip':
          break;
        case 'update':
          toUpdate.push({ studentId: dup.existingStudentId, row });
          break;
        case 'create':
          toCreate.push(row);
          break;
      }
    }

    // PRC-M384: single DB transaction when the store supports it.
    if (this.repository.bulkImport) {
      const { createdIds } = await this.repository.bulkImport(tenantId, {
        creates: toCreate.map((row) => createData(row)),
        updates: toUpdate.map((item) => ({ id: item.studentId, data: updateData(item.row) })),
      });
      return {
        totalRows: rows.length,
        successCount: createdIds.length + toUpdate.length,
        errorCount: validationErrors.length,
        duplicateCount: duplicates.length,
        errors: validationErrors,
        duplicates,
        transactional: true,
      };
    }

    // Fallback (store without bulkImport): best-effort compensation. Never
    // claimed as transactional; compensation failures are surfaced.
    const createdIds: string[] = [];
    const updateSnapshots: Array<{
      studentId: string;
      before: Record<string, unknown>;
    }> = [];
    try {
      for (const row of toCreate) {
        const created = await this.repository.create(tenantId, createData(row));
        createdIds.push(created.id);
      }
      for (const item of toUpdate) {
        const snapshot = await this.snapshotStudentForUpdate(tenantId, item.studentId);
        updateSnapshots.push({ studentId: item.studentId, before: snapshot });
        await this.repository.update(tenantId, item.studentId, updateData(item.row));
      }
    } catch (error) {
      const rollbackFailures = await this.rollbackImportBatch(
        tenantId,
        createdIds,
        updateSnapshots,
      );
      if (rollbackFailures.length > 0) {
        throw new ImportRollbackError(error, rollbackFailures);
      }
      throw error;
    }

    return {
      totalRows: rows.length,
      successCount: createdIds.length + toUpdate.length,
      errorCount: validationErrors.length,
      duplicateCount: duplicates.length,
      errors: validationErrors,
      duplicates,
      transactional: false,
    };
  }

  /** Snapshot mutable fields before an update (W2-JOB-12). */
  private async snapshotStudentForUpdate(
    tenantId: string,
    studentId: string,
  ): Promise<Record<string, unknown>> {
    const current = await this.repository.findById(tenantId, studentId);
    if (!current) return {};
    return {
      firstName: current.firstName,
      lastName: current.lastName,
      dateOfBirth: current.dateOfBirth,
      gender: current.gender,
      nationalId: current.nationalId,
      nationality: current.nationality,
      contactPhone: current.contactPhone,
      contactEmail: current.contactEmail,
      guardianName: current.guardianName,
      guardianPhone: current.guardianPhone,
      institutionCode: current.institutionCode,
      customData: current.customData,
    };
  }

  private async rollbackImportBatch(
    tenantId: string,
    createdIds: string[],
    updateSnapshots: Array<{ studentId: string; before: Record<string, unknown> }>,
  ): Promise<string[]> {
    const failures: string[] = [];
    for (const snap of [...updateSnapshots].reverse()) {
      if (Object.keys(snap.before).length === 0) continue;
      try {
        await this.repository.update(tenantId, snap.studentId, snap.before);
      } catch (error) {
        failures.push(`restore ${snap.studentId}: ${errorMessage(error)}`);
      }
    }
    for (const id of [...createdIds].reverse()) {
      try {
        // PRC-M384: delete is a soft delete; release the national ID first so
        // the rolled-back row does not keep reserving it.
        await this.repository.update(tenantId, id, { nationalId: null });
        await this.repository.delete(tenantId, id);
      } catch (error) {
        failures.push(`remove ${id}: ${errorMessage(error)}`);
      }
    }
    return failures;
  }

  /**
   * Get the progress of an async import job.
   */
  async getImportProgress(jobId: string, tenantId?: string): Promise<ImportProgress | null> {
    // PRC-H092: tenant-scoped lookup; the legacy unscoped form reads the process snapshot.
    if (tenantId) return this.progress.get(tenantId, jobId);
    return this.queue.getProgress(jobId);
  }

  /**
   * Idempotent handler for durable queue consumers (W2-JOB-06).
   *
   * Re-parses the Excel buffer and runs processRows, updating progress along
   * the way. Safe to re-run after crash when the repository write path is
   * idempotent enough for the duplicate strategy in options.
   */
  async processQueuedImport(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<ImportResult> {
    await this.progress.update(tenantId, jobId, {
      jobId,
      status: 'processing',
      totalRows: 0,
      processedRows: 0,
      progressPercent: 0,
      startedAt: new Date().toISOString(),
    });

    let parseResult: Awaited<ReturnType<typeof parseExcelBuffer>>;
    try {
      parseResult = await parseExcelBuffer(fileBuffer);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Excel parse failed';
      await this.progress.update(tenantId, jobId, {
        status: 'failed',
        progressPercent: 100,
        errorMessage: message,
        completedAt: new Date().toISOString(),
      });
      return {
        totalRows: 0,
        successCount: 0,
        errorCount: 1,
        duplicateCount: 0,
        errors: [
          {
            rowNumber: 1,
            field: 'file',
            message,
            code: 'INVALID_FORMAT' as const,
          },
        ],
        duplicates: [],
      };
    }

    if (parseResult.headerErrors.length > 0) {
      const failed: ImportResult = {
        totalRows: 0,
        successCount: 0,
        errorCount: parseResult.headerErrors.length,
        duplicateCount: 0,
        errors: parseResult.headerErrors.map((msg) => ({
          rowNumber: 1,
          field: 'header',
          message: msg,
          code: 'INVALID_FORMAT' as const,
        })),
        duplicates: [],
      };
      await this.progress.update(tenantId, jobId, {
        status: 'failed',
        progressPercent: 100,
        completedAt: new Date().toISOString(),
      });
      return failed;
    }

    await this.progress.update(tenantId, jobId, {
      totalRows: parseResult.rows.length,
      progressPercent: 10,
    });

    const result = await this.processRows(tenantId, parseResult.rows, options);

    await this.progress.update(tenantId, jobId, {
      status: 'completed',
      processedRows: result.totalRows,
      progressPercent: 100,
      completedAt: new Date().toISOString(),
    });

    return result;
  }
}

/**
 * Normalize gender values to a standard format.
 */
function normalizeGender(gender: string | undefined): string | null {
  if (!gender) return null;
  const lower = gender.toLowerCase().trim();
  switch (lower) {
    case 'male':
    case 'm':
      return 'Male';
    case 'female':
    case 'f':
      return 'Female';
    case 'other':
    case 'o':
      return 'Other';
    default:
      return gender;
  }
}
