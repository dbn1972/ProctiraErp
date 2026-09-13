/**
 * Types for the student bulk import module.
 *
 * Requirements:
 * - 6.7: Bulk import from Excel up to 50MB with row-level validation
 * - 6.8: Duplicate detection on configured unique identifiers
 * - 19.1: Excel import for major entities with downloadable templates
 * - 19.2: Validate all rows and return detailed error report
 * - 19.4: Handle files up to 50MB with progress indication
 * - 19.5: Flag duplicates and allow skip, update, or reject
 */

/**
 * Represents a single student row parsed from an Excel file.
 */
export interface ImportStudentRow {
  /** Row number in the Excel file (1-based, excluding header) */
  rowNumber: number;
  /** First name (mandatory) */
  firstName: string;
  /** Last name (mandatory) */
  lastName: string;
  /** Date of birth (mandatory, ISO date string) */
  dateOfBirth: string;
  /** Gender */
  gender?: string;
  /** National ID (unique identifier for duplicate detection) */
  nationalId?: string;
  /** Nationality */
  nationality?: string;
  /** Contact phone */
  contactPhone?: string;
  /** Contact email */
  contactEmail?: string;
  /** Guardian name */
  guardianName?: string;
  /** Guardian phone */
  guardianPhone?: string;
  /** Institution code for enrollment */
  institutionCode?: string;
  /** Custom data as key-value pairs */
  customData?: Record<string, unknown>;
}

/**
 * Validation error for a specific row in the import file.
 */
export interface ImportRowError {
  /** Row number in the Excel file (1-based, excluding header) */
  rowNumber: number;
  /** Field that failed validation */
  field: string;
  /** Human-readable error message */
  message: string;
  /** Error code for programmatic handling */
  code: 'REQUIRED_FIELD' | 'INVALID_FORMAT' | 'DUPLICATE_IN_FILE' | 'UNIQUENESS_VIOLATION';
}

/**
 * Represents a detected duplicate match.
 */
export interface DuplicateMatch {
  /** Row number of the import row that matched */
  rowNumber: number;
  /** ID of the existing student record that matched */
  existingStudentId: string;
  /** Type of match that was detected */
  matchType: 'national_id' | 'name_dob';
  /** The matching field values */
  matchedFields: Record<string, string>;
}

/**
 * Options for how to handle duplicates during import.
 */
export type DuplicateResolution = 'skip' | 'update' | 'create';

/**
 * Options for the bulk import operation.
 */
export interface ImportOptions {
  /** How to handle detected duplicates */
  duplicateResolution: DuplicateResolution;
  /** Whether to queue for background processing (auto-determined for large files) */
  async?: boolean;
  /**
   * G-307 dry-run: validate + detect duplicates but do not write students.
   * When true, successCount stays 0 and dryRun is echoed on the result.
   */
  dryRun?: boolean;
}

/**
 * Result of a bulk import operation.
 */
export interface ImportResult {
  /** Total number of rows in the file (excluding header) */
  totalRows: number;
  /** Number of rows successfully imported */
  successCount: number;
  /** Number of rows that failed validation */
  errorCount: number;
  /** Number of duplicate rows detected */
  duplicateCount: number;
  /** Detailed errors for each failed row */
  errors: ImportRowError[];
  /** Detected duplicates */
  duplicates: DuplicateMatch[];
  /** Echoed when options.dryRun was true (G-307). */
  dryRun?: boolean;
  /** True when commit used all-or-nothing batch semantics (G-307). */
  transactional?: boolean;
}

/**
 * Progress tracking for async imports.
 */
export interface ImportProgress {
  /** Unique import job ID */
  jobId: string;
  /** Current status */
  status: 'queued' | 'processing' | 'completed' | 'failed';
  /** Total rows to process */
  totalRows: number;
  /** Rows processed so far */
  processedRows: number;
  /** Progress percentage (0-100) */
  progressPercent: number;
  /** Result (available when status is 'completed') */
  result?: ImportResult;
  /** Error message (available when status is 'failed') */
  errorMessage?: string;
  /** Timestamp when the import was started */
  startedAt: string;
  /** Timestamp when the import completed */
  completedAt?: string;
}

/**
 * Student record as stored in the repository (simplified for import context).
 */
export interface StudentRecord {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string | null;
  nationalId: string | null;
  nationality: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  guardianName: string | null;
  guardianPhone: string | null;
  institutionCode: string | null;
  customData: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Repository interface for student data access during import.
 */
export interface StudentRepository {
  /** Find a student by id within a tenant (W2-JOB-12 rollback snapshots) */
  findById(tenantId: string, id: string): Promise<StudentRecord | null>;

  /** Find a student by national ID within a tenant */
  findByNationalId(tenantId: string, nationalId: string): Promise<StudentRecord | null>;

  /** Find students by name and date of birth within a tenant */
  findByNameAndDob(
    tenantId: string,
    firstName: string,
    lastName: string,
    dateOfBirth: string,
  ): Promise<StudentRecord[]>;

  /** Create a new student record */
  create(
    tenantId: string,
    data: Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>,
  ): Promise<StudentRecord>;

  /** Update an existing student record */
  update(
    tenantId: string,
    id: string,
    data: Partial<Omit<StudentRecord, 'id' | 'tenantId' | 'createdAt' | 'updatedAt'>>,
  ): Promise<StudentRecord>;

  /** Check if a national ID already exists in the tenant */
  nationalIdExists(tenantId: string, nationalId: string): Promise<boolean>;

  /**
   * Delete a student (W2-JOB-12 compensating rollback after a mid-batch failure).
   * Required for transactional import semantics.
   */
  delete(tenantId: string, id: string): Promise<boolean>;
}

/**
 * Interface for the import job queue (RabbitMQ integration).
 */
export interface ImportQueue {
  /** Enqueue an import job for background processing */
  enqueue(
    tenantId: string,
    jobId: string,
    fileBuffer: Buffer,
    options: ImportOptions,
  ): Promise<void>;

  /** Get the progress of an import job */
  getProgress(jobId: string): Promise<ImportProgress | null>;

  /** Update the progress of an import job */
  updateProgress(jobId: string, progress: Partial<ImportProgress>): Promise<void>;
}

/** Maximum file size for import (50MB) */
export const MAX_IMPORT_FILE_SIZE = 50 * 1024 * 1024;

/** Threshold for async processing (rows) */
export const ASYNC_THRESHOLD_ROWS = 1000;
