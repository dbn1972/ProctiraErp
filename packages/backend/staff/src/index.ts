/**
 * @proctira/backend-staff - Staff domain service
 *
 * Provides CRUD operations for staff records with:
 * - Typebox schema validation
 * - Required field enforcement (name, DOB, identity number, contact, position)
 * - Unique identity number enforcement (global)
 * - Custom fields via JSONB custom_data column
 * - Full-text search on staff name and identity number
 *
 * Staff Assignments (Requirements 7.2, 7.5):
 * - Assignment routes with institution, subject, class, start/end dates
 * - Overlapping assignment prevention for same institution-subject-class
 * - Allocation percentage tracking with total ≤ 100% enforcement
 */

// Plugin
export { staffPlugin } from './staff-plugin.js';
export type { StaffPluginOptions } from './staff-plugin.js';

// Service
export { StaffService } from './staff-service.js';

// Repository
export type { StaffEntity, StaffFilter, StaffRepository } from './staff-repository.js';

// In-memory repository (for testing)
export { InMemoryStaffRepository } from './in-memory-repository.js';

// Schemas
export {
  CreateStaffSchema,
  UpdateStaffSchema,
  StaffListQuerySchema,
  StaffParamsSchema,
  StaffResponseSchema,
  StaffListResponseSchema,
} from './schemas.js';
export type {
  CreateStaffInput,
  UpdateStaffInput,
  StaffListQuery,
  StaffParams,
  StaffResponse,
  StaffListResponse,
} from './schemas.js';

// Routes
export { registerStaffRoutes } from './routes.js';
export type { StaffRoutesOptions } from './routes.js';

// --- Staff Assignments ---

// Assignment Service
export { StaffAssignmentService } from './assignment-service.js';

// Assignment Repository
export type {
  StaffAssignmentEntity,
  StaffAssignmentFilter,
  StaffAssignmentRepository,
} from './assignment-repository.js';

// In-memory assignment repository (for testing)
export { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';

// Assignment Schemas
export {
  CreateAssignmentSchema,
  UpdateAssignmentSchema,
  AssignmentListQuerySchema,
  AssignmentParamsSchema,
  AssignmentResponseSchema,
  AssignmentListResponseSchema,
} from './assignment-schemas.js';
export type {
  CreateAssignmentInput,
  UpdateAssignmentInput,
  AssignmentListQuery,
  AssignmentParams,
  AssignmentResponse,
  AssignmentListResponse,
} from './assignment-schemas.js';

// Assignment Routes
export { registerAssignmentRoutes } from './assignment-routes.js';
export type { AssignmentRoutesOptions } from './assignment-routes.js';

// ─── Staff Appraisals (Requirements 7.3) ──────────────────────────────

// Appraisal Service
export { AppraisalService } from './appraisal-service.js';
export type { WorkflowIntegration } from './appraisal-service.js';

// Appraisal Repository
export type {
  AppraisalCriterionEntity,
  AppraisalTemplateEntity,
  AppraisalScoreEntity,
  AppraisalEntity,
  AppraisalFilter,
  AppraisalTemplateRepository,
  AppraisalRepository,
} from './appraisal-repository.js';

// Appraisal In-Memory Repositories (for testing)
export {
  InMemoryAppraisalTemplateRepository,
  InMemoryAppraisalRepository,
} from './in-memory-appraisal-repository.js';

// Appraisal / training Postgres repositories + factories (G-717)
export { PgAppraisalTemplateRepository, PgAppraisalRepository } from './pg-appraisal-repository.js';
export {
  PgTrainingProgramRepository,
  PgTrainingSessionRepository,
  PgTrainingAttendanceRepository,
  PgCertificationRepository,
} from './pg-training-repository.js';
export {
  createAppraisalRepositories,
  createTrainingRepositories,
} from './create-hr-repositories.js';
export type { AppraisalRepositories, TrainingRepositories } from './create-hr-repositories.js';
export { ensureHrSchema } from './pg-hr-schema.js';

// Appraisal Schemas
export {
  AppraisalStatus,
  CreateAppraisalTemplateSchema,
  CreateAppraisalSchema,
  SubmitAppraisalSchema,
  AppraisalParamsSchema,
  AppraisalTemplateParamsSchema,
  AppraisalListQuerySchema,
  AppraisalResponseSchema,
  AppraisalTemplateResponseSchema,
} from './appraisal-schemas.js';
export type {
  CreateAppraisalTemplateInput,
  CreateAppraisalInput,
  SubmitAppraisalInput,
  AppraisalParams,
  AppraisalTemplateParams,
  AppraisalListQuery,
  AppraisalResponse,
  AppraisalTemplateResponse,
} from './appraisal-schemas.js';

// Appraisal Routes
export { registerAppraisalRoutes } from './appraisal-routes.js';
export type { AppraisalRoutesOptions } from './appraisal-routes.js';

// ─── Staff Training (Requirements 7.4, 7.8) ───────────────────────────

// Training Service
export { TrainingService } from './training-service.js';
export type { NotificationIntegration } from './training-service.js';

// Training Repository
export type {
  TrainingProgramEntity,
  TrainingSessionEntity,
  TrainingAttendanceEntity,
  CertificationEntity,
  CertificationFilter,
  TrainingProgramRepository,
  TrainingSessionRepository,
  TrainingAttendanceRepository,
  CertificationRepository,
} from './training-repository.js';

// Training In-Memory Repositories (for testing)
export {
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryCertificationRepository,
} from './in-memory-training-repository.js';

// Training Schemas
export {
  CertificationStatus,
  TrainingAttendanceStatus,
  CreateTrainingProgramSchema,
  UpdateTrainingProgramSchema,
  CreateTrainingSessionSchema,
  RecordTrainingAttendanceSchema,
  IssueCertificationSchema,
  TrainingProgramParamsSchema,
  TrainingSessionParamsSchema,
  CertificationParamsSchema,
  TrainingProgramListQuerySchema,
  CertificationListQuerySchema,
  TrainingProgramResponseSchema,
  TrainingSessionResponseSchema,
  TrainingAttendanceResponseSchema,
  CertificationResponseSchema,
} from './training-schemas.js';
export type {
  CreateTrainingProgramInput,
  UpdateTrainingProgramInput,
  CreateTrainingSessionInput,
  RecordTrainingAttendanceInput,
  IssueCertificationInput,
  TrainingProgramParams,
  TrainingSessionParams,
  CertificationParams,
  TrainingProgramListQuery,
  CertificationListQuery,
  TrainingProgramResponse,
  TrainingSessionResponse,
  TrainingAttendanceResponse,
  CertificationResponse,
} from './training-schemas.js';

// Training Routes
export { registerTrainingRoutes } from './training-routes.js';
export type { TrainingRoutesOptions } from './training-routes.js';

// ─── Staff Leave (HR leave v1) ────────────────────────────────────────

export { StaffLeaveService } from './leave-service.js';
export type {
  StaffLeaveBalanceEntity,
  StaffLeaveEntity,
  StaffLeaveRepository,
  StaffLeaveStatus,
  StaffLeaveType,
} from './leave-repository.js';
export { InsufficientLeaveBalanceError } from './leave-repository.js';
export { InMemoryStaffLeaveRepository } from './in-memory-leave-repository.js';
export {
  CreateStaffLeaveSchema,
  DecideStaffLeaveSchema,
  StaffLeaveParamsSchema,
} from './leave-schemas.js';
export type {
  CreateStaffLeaveInput,
  DecideStaffLeaveInput,
  StaffLeaveParams,
} from './leave-schemas.js';
export { registerStaffLeaveRoutes } from './leave-routes.js';
export type { StaffLeaveRoutesOptions } from './leave-routes.js';
export { inclusiveLeaveDays } from './leave-service.js';
export {
  createStaffLeaveRepository,
  ensureStaffLeaveSchema,
  isPgStaffLeaveEnabled,
  PgStaffLeaveRepository,
} from './pg-leave-repository.js';

// ─── Staff / HR ops (G-918) ───────────────────────────────────────────

export {
  StaffHrService,
  payableDays,
  withRenewalAlert,
  CONTRACT_RENEWAL_WINDOW_DAYS,
} from './hr-service.js';
export type {
  AttendanceSummaryRow,
  ContractView,
  ImportCommitResult,
  ImportDryRunResult,
  PayrollExportResult,
  PayrollRow,
} from './hr-service.js';
export type {
  StaffAttendanceRecord,
  StaffContractRecord,
  StaffHrStore,
  StaffQualificationRecord,
} from './hr-store.js';
export { InMemoryStaffHrStore } from './hr-store.js';
export { PgStaffHrStore, ensureStaffHrSchema } from './pg-hr-ops-store.js';
export { createStaffHrStore } from './create-staff-hr-store.js';
export { registerStaffHrRoutes } from './hr-routes.js';
export {
  CreateContractSchema,
  CreateQualificationSchema,
  MarkAttendanceSchema,
  StaffImportSchema,
  PayrollExportQuerySchema,
} from './hr-schemas.js';
export { parseCsv, toCsv } from './staff-csv.js';

// Persistence: Prisma repository + env-driven factory
export { PrismaStaffRepository } from './prisma-staff-repository.js';
export { PrismaAssignmentRepository } from './prisma-assignment-repository.js';
export { createStaffRepository, createAssignmentRepository } from './repository-factory.js';
export type { StaffRepositoryConfig } from './repository-factory.js';

export { assertStaffAccess, hasStaffAccess, normalizeStaffRoles } from './staff-access.js';
export type { StaffAction } from './staff-access.js';

// ─── Thin offboard status stub (P1-HR S0/S1) ─────────────────────────
export {
  OffboardStaffSchema,
  OffboardStaffParamsSchema,
  OffboardStatusResponseSchema,
} from './offboard-schemas.js';
export type {
  OffboardStaffInput,
  OffboardStaffParams,
  OffboardStatusResponse,
} from './offboard-schemas.js';
export { OFFBOARD_CUSTOM_DATA_KEY, readOffboardMeta, writeOffboardMeta } from './offboard-meta.js';
export type { StaffOffboardMeta } from './offboard-meta.js';
export type { StaffOffboardStatusView } from './staff-service.js';
