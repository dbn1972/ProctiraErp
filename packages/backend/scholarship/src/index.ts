/**
 * @proctira/backend-scholarship - Scholarship domain service
 *
 * Provides scholarship program management with:
 * - Program CRUD with eligibility criteria, application periods, and slots
 * - Application submission with documents, academic records, and financial info
 * - Workflow Engine integration for configurable approval routing
 * - Disbursement tracking with payment status and schedules
 * - Recipient compliance monitoring
 * - Utilization reports by program, area, gender, and institution
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */

// Plugin
export { scholarshipPlugin } from './scholarship-plugin.js';
export { parentScholarshipPlugin } from './parent-scholarship-routes.js';
export type { ScholarshipPluginOptions } from './scholarship-plugin.js';
export type { ApplicantStudentLookup } from './application-intake.js';
export { isPlaceholderId } from './application-intake.js';

// Service
export { ScholarshipService } from './scholarship-service.js';
export type { FeeOutboxDrainResult } from './scholarship-service.js';
export {
  InMemoryScholarshipFeeOutbox,
  PgScholarshipFeeOutbox,
  outboxBackoffMs,
} from './scholarship-fee-outbox.js';
export type {
  ScholarshipFeeOutbox,
  ScholarshipFeeOutboxRow,
  ScholarshipFeeOutboxEvent,
  ScholarshipTxClient,
} from './scholarship-fee-outbox.js';
export type {
  WorkflowEngineClient,
  ScholarshipServiceOptions,
  ApplicationDecision,
} from './scholarship-service.js';

// Repository
export type {
  ScholarshipProgramEntity,
  ScholarshipApplicationEntity,
  DisbursementEntity,
  ComplianceRecordEntity,
  ProgramFilter,
  ApplicationFilter,
  DisbursementFilter,
  UtilizationReportFilter,
  UtilizationReportData,
  UtilizationBreakdownItem,
  ScholarshipRepository,
  ProgramStatus,
  DisbursementFrequency,
  ApplicationStatus,
  PaymentStatus,
  PaymentMethod,
  ComplianceType,
  ComplianceStatus,
} from './scholarship-repository.js';

// In-memory repository (for testing / gateway demo seed)
export { InMemoryScholarshipRepository } from './in-memory-repository.js';

// Postgres factory (G-204)
export {
  createScholarshipFeeOutbox,
  createScholarshipRepository,
  isPgScholarshipEnabled,
} from './create-scholarship-repository.js';
export {
  PgScholarshipRepository,
  getSharedScholarshipPool,
  ensureScholarshipSchema,
} from './pg-scholarship-repository.js';

// Cached repository decorator
export { CachedScholarshipRepository } from './cached-scholarship-repository.js';

// Schemas
export {
  CreateScholarshipProgramSchema,
  UpdateScholarshipProgramSchema,
  CreateApplicationSchema,
  CreateDisbursementSchema,
  UpdateDisbursementSchema,
  RecipientComplianceSchema,
  UtilizationReportQuerySchema,
  ScholarshipParamsSchema,
  ScholarshipListQuerySchema,
  EligibilityCriteriaSchema,
  AcademicRecordSchema,
  FinancialInfoSchema,
  ApplicationDocumentSchema,
  ScholarshipProgramResponseSchema,
  ApplicationResponseSchema,
  DisbursementResponseSchema,
  UtilizationReportResponseSchema,
} from './schemas.js';
export type {
  CreateScholarshipProgramInput,
  UpdateScholarshipProgramInput,
  CreateApplicationInput,
  CreateDisbursementInput,
  UpdateDisbursementInput,
  RecipientComplianceInput,
  UtilizationReportQuery,
  ScholarshipParams,
  ScholarshipListQuery,
  EligibilityCriteria,
  AcademicRecord,
  FinancialInfo,
  ApplicationDocument,
  ScholarshipProgramResponse,
  ApplicationResponse,
  DisbursementResponse,
  UtilizationReportResponse,
} from './schemas.js';

// Routes
export { registerScholarshipRoutes } from './routes.js';
export type { ScholarshipRoutesOptions } from './routes.js';

// RBAC (W1-SEC-02 residual)
export {
  assertScholarshipAccess,
  hasScholarshipAccess,
  normalizeScholarshipRoles,
} from './scholarship-access.js';
export type { ScholarshipAction } from './scholarship-access.js';
export { requireScholarshipAction } from './scholarship-http-guard.js';

export { InMemoryScholarshipDocumentStore } from './document-store.js';
export type { ScholarshipApplicationDocument, ScholarshipDocumentStore } from './document-store.js';
export { createScholarshipDocumentStore, PgScholarshipDocumentStore } from './pg-document-store.js';
export { linkedStudentIdsForParent } from './parent-links.js';
export {
  createScholarshipDocumentBlobStore,
  InMemoryScholarshipDocumentBlobStore,
} from './document-blob-store.js';
export { PLACEHOLDER_PDF, PLACEHOLDER_PDF_SHA256, sha256Hex } from './document-bytes.js';
export {
  createDownloadTokenReplayGuard,
  DownloadTokenReplayGuard,
  RedisDownloadTokenReplayGuard,
} from './document-bytes.js';
export type {
  DownloadTokenReplayStore,
  RedisLikeForDownloadReplay,
  ScholarshipDocumentDownloadAuditEvent,
  ScholarshipDocumentDownloadAuditRecorder,
} from './document-bytes.js';
