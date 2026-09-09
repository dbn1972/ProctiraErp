/**
 * @proctira/backend-attendance - Attendance domain service
 *
 * Provides student and staff attendance recording with:
 * - Configurable recording mode per institution (class, subject, period)
 * - Pre-populated student roster from active enrollment
 * - Date validation (current or past within active academic period)
 * - Staff attendance with configurable leave type categories
 * - Audit trail for attendance modifications
 *
 * Requirements: 9.1, 9.2, 9.3, 9.7
 */

// Plugin
export { attendancePlugin } from './attendance-plugin.js';
export type { AttendancePluginOptions } from './attendance-plugin.js';

// Service
export { AttendanceService } from './attendance-service.js';
export type {
  BulkAttendanceResult,
  RosterWithAttendance,
  AttendanceEventPublisher,
  AbsenceThresholdExceededEvent,
} from './attendance-service.js';

// Repository
export type {
  AttendanceRepository,
  StudentAttendanceEntity,
  StaffAttendanceEntity,
  StudentRosterEntry,
  AcademicPeriodInfo,
  InstitutionAttendanceConfig,
  LeaveTypeConfig,
  AttendanceAuditEntry,
  RecordingMode,
  AttendancePercentageQuery,
  AttendancePercentageResult,
  AbsenceThresholdConfig,
  ThresholdCheckResult,
} from './attendance-repository.js';

// In-memory repository (for testing)
export { InMemoryAttendanceRepository } from './in-memory-repository.js';

// Cached repository decorator
export { CachedAttendanceRepository } from './cached-attendance-repository.js';

// Prisma repository (Postgres + RLS) + factory
export { PrismaAttendanceRepository } from './prisma-attendance-repository.js';
export { createAttendanceRepository, createAttendanceOpsStore } from './repository-factory.js';
export type { AttendanceRepositoryConfig } from './repository-factory.js';

export { AttendanceOpsService, EARLY_DEPARTURE_PRESENT_WEIGHT } from './ops-service.js';
export { registerAttendanceOpsRoutes } from './ops-routes.js';
export { InMemoryAttendanceOpsStore, hashDeviceApiKey, mintDeviceApiKey } from './ops-store.js';
export type { AttendanceOpsStore } from './ops-store.js';

// Bulk attendance producer (queue-first pattern)
export { BulkAttendanceProducer } from './bulk-attendance-producer.js';
export type {
  AttendanceRecord,
  BulkAttendancePayload,
  BulkAttendanceJobRef,
} from './bulk-attendance-producer.js';

// Schemas
export {
  RecordStudentAttendanceSchema,
  RecordBulkStudentAttendanceSchema,
  RecordStaffAttendanceSchema,
  ClassRosterQuerySchema,
  AttendanceParamsSchema,
  StudentAttendanceResponseSchema,
  StaffAttendanceResponseSchema,
  RosterEntryResponseSchema,
  AttendanceConfigResponseSchema,
  AttendancePercentageQuerySchema,
  AttendancePercentageResponseSchema,
  AbsenceThresholdCheckQuerySchema,
  AbsenceThresholdCheckResponseSchema,
  AttendanceAuditQuerySchema,
} from './schemas.js';
export type {
  RecordStudentAttendanceInput,
  RecordBulkStudentAttendanceInput,
  RecordStaffAttendanceInput,
  ClassRosterQuery,
  AttendanceParams,
  StudentAttendanceResponse,
  StaffAttendanceResponse,
  RosterEntryResponse,
  AttendanceConfigResponse,
  AttendancePercentageQueryInput,
  AttendancePercentageResponse,
  AbsenceThresholdCheckQueryInput,
  AbsenceThresholdCheckResponse,
  AttendanceAuditQueryInput,
} from './schemas.js';

// Routes
export { registerAttendanceRoutes } from './routes.js';
export type { AttendanceRoutesOptions } from './routes.js';
