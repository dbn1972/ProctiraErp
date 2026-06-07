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

import { parseExcelBuffer } from './excel-parser.js';
import { validateAllRows } from './row-validator.js';
import { detectDuplicates } from './duplicate-detector.js';
import type {
  ImportOptions,
  ImportResult,
  ImportProgress,
  ImportStudentRow,
  ImportRowError,
  DuplicateMatch,
  StudentRepository,
  ImportQueue,
  MAX_IMPORT_FILE_SIZE,
  ASYNC_THRESHOLD_ROWS,
} from './types.js';

export interface ImportServiceDependencies {
  studentRepository: StudentRepository;
  importQueue: ImportQueue;
}

/**
 * Student Bulk Import Service.
 * Handles synchronous and asynchronous import flows.
 */
export class ImportService {
  private readonly repository: StudentRepository;
  private readonly queue: ImportQueue;

  constructor(deps: ImportServiceDependencies) {
    this.repository = deps.studentRepository;
    this.queue = deps.importQueue;
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
        errors: parseResult.headerErrors.map((msg, idx) => ({
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

      await this.queue.enqueue(tenantId, jobId, fileBuffer, options);
      await this.queue.updateProgress(jobId, progress);

      return progress;
    }

    // Process synchronously
    return this.processRows(tenantId, rows, options);
  }

  /**
   * Process parsed rows synchronously.
   * Used for small imports and by the background worker for queued imports.
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

    // Step 3: Apply duplicate resolution and import
    const duplicateRowNumbers = new Set(duplicates.map((d) => d.rowNumber));
    let successCount = 0;

    // Import non-duplicate valid rows
    const nonDuplicateRows = validRows.filter((r) => !duplicateRowNumbers.has(r.rowNumber));
    for (const row of nonDuplicateRows) {
      await this.createStudent(tenantId, row);
      successCount++;
    }

    // Handle duplicates based on resolution strategy
    for (const dup of duplicates) {
      const row = validRows.find((r) => r.rowNumber === dup.rowNumber);
      if (!row) continue;

      switch (options.duplicateResolution) {
        case 'skip':
          // Do nothing - skip the duplicate row
          break;

        case 'update':
          // Update the existing record with new data
          await this.updateStudent(tenantId, dup.existingStudentId, row);
          successCount++;
          break;

        case 'create':
          // Create a new record despite the duplicate
          await this.createStudent(tenantId, row);
          successCount++;
          break;
      }
    }

    return {
      totalRows: rows.length,
      successCount,
      errorCount: validationErrors.length,
      duplicateCount: duplicates.length,
      errors: validationErrors,
      duplicates,
    };
  }

  /**
   * Create a new student record from an import row.
   */
  private async createStudent(tenantId: string, row: ImportStudentRow): Promise<void> {
    await this.repository.create(tenantId, {
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
    });
  }

  /**
   * Update an existing student record from an import row.
   */
  private async updateStudent(
    tenantId: string,
    studentId: string,
    row: ImportStudentRow,
  ): Promise<void> {
    const updateData: Record<string, unknown> = {};

    if (row.firstName) updateData.firstName = row.firstName.trim();
    if (row.lastName) updateData.lastName = row.lastName.trim();
    if (row.dateOfBirth) updateData.dateOfBirth = row.dateOfBirth;
    if (row.gender) updateData.gender = normalizeGender(row.gender);
    if (row.nationalId) updateData.nationalId = row.nationalId.trim();
    if (row.nationality) updateData.nationality = row.nationality.trim();
    if (row.contactPhone) updateData.contactPhone = row.contactPhone.trim();
    if (row.contactEmail) updateData.contactEmail = row.contactEmail.trim();
    if (row.guardianName) updateData.guardianName = row.guardianName.trim();
    if (row.guardianPhone) updateData.guardianPhone = row.guardianPhone.trim();
    if (row.institutionCode) updateData.institutionCode = row.institutionCode.trim();

    await this.repository.update(tenantId, studentId, updateData);
  }

  /**
   * Get the progress of an async import job.
   */
  async getImportProgress(jobId: string): Promise<ImportProgress | null> {
    return this.queue.getProgress(jobId);
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
