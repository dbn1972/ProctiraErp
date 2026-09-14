/**
 * @proctira/backend-student - Student domain service
 *
 * Provides:
 * - Student record CRUD with custom fields
 * - Enrollment lifecycle (enroll, transfer, withdraw, graduate)
 * - Bulk import/export via Excel
 * - Duplicate detection
 * - Complete audit trail
 * - Tenant-scoped student data
 */

// Core service
export { StudentService } from './student-service.js';

// Core repository types (main student repository interface)
export type {
  StudentEntity,
  StudentContact,
  StudentGuardian,
  IdentityDocument,
  StudentFilter,
  StudentRepository as CoreStudentRepository,
} from './student-repository.js';

// Repository implementations
export { PrismaStudentRepository } from './prisma-student-repository.js';

// Repository composition (env-driven selection)
export { createStudentRepository } from './repository-factory.js';
export type { StudentRepositoryConfig } from './repository-factory.js';

// Cached repository decorator
export { CachedStudentRepository } from './cached-student-repository.js';

// Fastify plugin (for in-process registration in the API gateway / monolith)
export { studentPlugin } from './student-plugin.js';
export type { StudentPluginOptions } from './student-plugin.js';

// Enrollment module (G-701: mounted by studentPlugin under /enrollments)
export {
  EnrollmentService,
  InMemoryEnrollmentRepository,
  registerEnrollmentRoutes,
} from './enrollment/index.js';
export type {
  EnrollmentEntity,
  EnrollmentHistoryEntity,
  TransferRecordEntity,
  EnrollmentFilter,
  EnrollmentRepository,
  EnrollmentRoutesOptions,
} from './enrollment/index.js';
export { PgEnrollmentRepository } from './enrollment/pg-enrollment-repository.js';
export { createEnrollmentRepository } from './enrollment/create-enrollment-repository.js';

export {
  Students360Service,
  registerStudents360Routes,
  InMemoryStudents360Store,
  PgStudents360Store,
  createStudents360Store,
  InMemoryStudentBlobStore,
  createStudentBlobStore,
  aggregateAttendanceHeatmap,
  bindAttendanceHeatmapSource,
} from './students-360/index.js';
export type {
  AttendanceHeatmapSource,
  Students360Store,
  StudentBlobStore,
} from './students-360/index.js';

// Import module
export {
  ImportService,
  parseExcelBuffer,
  validateRow,
  validateAllRows,
  detectDuplicates,
  registerImportRoutes,
  InMemoryStudentRepository,
  InMemoryImportQueue,
  QueueImportQueue,
  createStudentImportWorker,
  createStudentImportQueueFromEnv,
  EXPECTED_HEADERS,
  MAX_IMPORT_FILE_SIZE,
  ASYNC_THRESHOLD_ROWS,
  ImportOptionsSchema,
  ImportProgressParamsSchema,
  ImportResultResponseSchema,
  ImportProgressResponseSchema,
} from './import/index.js';

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
  ImportServiceDependencies,
  ImportRoutesOptions,
  ParseResult,
  HeaderName,
  ImportOptionsInput,
  ImportProgressParams,
  ImportResultResponse,
  ImportProgressResponse,
  StudentImportJobPayload,
  StudentImportWorker,
  StudentImportWorkerOptions,
  StudentImportProcessor,
  StudentImportQueueHandle,
} from './import/index.js';

// W2-REC-01 lifecycle certificates
export {
  LifecycleCertificateService,
  InMemoryLifecycleCertificateRepository,
  registerLifecycleCertificateRoutes,
} from './certificates/index.js';
export type {
  LifecycleCertificate,
  LifecycleCertificateType,
  LifecycleCertificateStatus,
  IssueLifecycleCertificateInput,
  LifecycleCertificateRepository,
} from './certificates/index.js';
