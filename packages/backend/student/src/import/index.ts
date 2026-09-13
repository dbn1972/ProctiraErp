/**
 * Student Bulk Import Module
 *
 * Provides Excel-based bulk import with:
 * - Row-level validation against mandatory field rules
 * - Duplicate detection on national ID and name+DOB
 * - Conflict resolution (skip, update, create)
 * - Error report with row numbers and specific failures
 * - Queue integration for large file background processing
 */

// Types
export type {
  ImportStudentRow,
  ImportRowError,
  DuplicateMatch,
  DuplicateResolution,
  ImportOptions,
  ImportResult,
  ImportProgress,
  StudentRecord,
  StudentRepository,
  ImportQueue,
} from './types.js';
export { MAX_IMPORT_FILE_SIZE, ASYNC_THRESHOLD_ROWS } from './types.js';

// Excel Parser
export { parseExcelBuffer, EXPECTED_HEADERS } from './excel-parser.js';
export type { ParseResult, HeaderName } from './excel-parser.js';

// Row Validator
export { validateRow, validateAllRows } from './row-validator.js';

// Duplicate Detector
export { detectDuplicates } from './duplicate-detector.js';

// Import Service
export { ImportService } from './import-service.js';
export type { ImportServiceDependencies } from './import-service.js';

// Routes
export { registerImportRoutes } from './import-routes.js';
export type { ImportRoutesOptions } from './import-routes.js';

// Schemas
export {
  ImportOptionsSchema,
  ImportProgressParamsSchema,
  ImportResultResponseSchema,
  ImportProgressResponseSchema,
} from './import-schemas.js';
export type {
  ImportOptionsInput,
  ImportProgressParams,
  ImportResultResponse,
  ImportProgressResponse,
} from './import-schemas.js';

// In-memory implementations (for testing)
export { InMemoryStudentRepository } from './in-memory-student-repository.js';
export { InMemoryImportQueue } from './in-memory-import-queue.js';

// Durable import queue spine (W2-JOB-06)
export { QueueImportQueue } from './queue-import-queue.js';
export type { StudentImportJobPayload } from './queue-import-queue.js';
export { createStudentImportWorker } from './student-import-worker.js';
export type {
  StudentImportWorker,
  StudentImportWorkerOptions,
  StudentImportProcessor,
} from './student-import-worker.js';
export { createStudentImportQueueFromEnv } from './import-queue-factory.js';
export type { StudentImportQueueHandle } from './import-queue-factory.js';
