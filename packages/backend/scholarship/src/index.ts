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
export type { ScholarshipPluginOptions } from './scholarship-plugin.js';

// Service
export { ScholarshipService } from './scholarship-service.js';
export type { WorkflowEngineClient, ScholarshipServiceOptions } from './scholarship-service.js';

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

// In-memory repository (for testing)
export { InMemoryScholarshipRepository } from './in-memory-repository.js';

// Prisma repository (Postgres + RLS) + factory
export { PrismaScholarshipRepository } from './prisma-scholarship-repository.js';
export { createScholarshipRepository } from './repository-factory.js';
export type { ScholarshipRepositoryConfig } from './repository-factory.js';

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
