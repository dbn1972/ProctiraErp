/**
 * Enrollment module - manages student enrollment lifecycle and transfers.
 *
 * Requirements: 6.2, 6.3, 6.4
 */

// Service
export { EnrollmentService } from './enrollment-service.js';

// Repository
export type {
  EnrollmentEntity,
  EnrollmentHistoryEntity,
  TransferRecordEntity,
  EnrollmentFilter,
  EnrollmentRepository,
  InstitutionLookup,
} from './enrollment-repository.js';

// In-memory repository (for testing)
export { InMemoryEnrollmentRepository } from './in-memory-enrollment-repository.js';

// Routes
export { registerEnrollmentRoutes } from './enrollment-routes.js';
export type { EnrollmentRoutesOptions } from './enrollment-routes.js';

// Schemas
export {
  CreateEnrollmentSchema,
  UpdateEnrollmentStatusSchema,
  BulkUpdateEnrollmentStatusSchema,
  StudentTransferSchema,
  EnrollmentParamsSchema,
  StudentParamsSchema,
  EnrollmentListQuerySchema,
  EnrollmentResponseSchema,
  EnrollmentHistoryEntrySchema,
  TransferRecordResponseSchema,
} from './schemas.js';
export type {
  CreateEnrollmentInput,
  UpdateEnrollmentStatusInput,
  BulkUpdateEnrollmentStatusInput,
  StudentTransferInput,
  EnrollmentParams,
  StudentParams,
  EnrollmentListQuery,
  EnrollmentResponse,
  EnrollmentHistoryEntry,
  TransferRecordResponse,
} from './schemas.js';
