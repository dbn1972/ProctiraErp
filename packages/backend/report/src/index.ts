/**
 * @proctira/backend-report - Report Engine domain service
 *
 * Provides configurable report generation with:
 * - Configurable filters, grouping, and aggregation across all modules
 * - Multi-format export (XLSX via ExcelJS, PDF via PDFKit, CSV)
 * - Report card template engine with merge fields, conditional sections, branding
 * - Background processing via RabbitMQ for long-running reports
 * - RBAC-scoped data filtering based on user's area and role
 * - Scheduled report generation with email/in-app delivery
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6
 */

// Plugin
export { reportPlugin } from './report-plugin.js';
export type { ReportPluginOptions } from './report-plugin.js';

// Service
export { ReportService } from './report-service.js';
export type {
  XlsxExporter,
  PdfExporter,
  CsvExporter,
  ReportQueuePublisher,
  ReportFileStorage,
  ReportServiceConfig,
} from './report-service.js';

// Repository
export type {
  ReportRepository,
  ReportJobEntity,
  ReportTemplateEntity,
  ScheduledReportEntity,
  ReportJobQueryOptions,
  PaginatedReportJobs,
  ReportDataSource,
  ReportUserContext,
  ReportDataResult,
  ReportColumn,
} from './report-repository.js';

// In-memory repository (for testing)
export { InMemoryReportRepository } from './in-memory-repository.js';

// Prisma repository (Postgres + RLS) + factory
export { PrismaReportRepository } from './prisma-report-repository.js';
export { createReportRepository } from './repository-factory.js';
export type { ReportRepositoryConfig } from './repository-factory.js';

// Cross-module analytical data source (per-schema queries + in-memory UUID joins)
export {
  CrossModuleReportDataSource,
  createReportDataSource,
} from './cross-module-report-data-source.js';
export type {
  CrossModuleReportDataSourceDeps,
  ReportStudentPort,
  ReportEnrollmentPort,
  ReportInstitutionPort,
  ReportAttendancePort,
  ReportExaminationPort,
  ReportExaminationResultPort,
  ReportScholarshipPort,
} from './cross-module-report-data-source.js';

// Schemas
export {
  ReportFormatSchema,
  ReportJobStatusSchema,
  AggregationTypeSchema,
  AggregationConfigSchema,
  DeliveryMethodSchema,
  GenerateReportSchema,
  MergeFieldSchema,
  ConditionalSectionSchema,
  BrandingConfigSchema,
  CreateReportTemplateSchema,
  UpdateReportTemplateSchema,
  CreateScheduledReportSchema,
  UpdateScheduledReportSchema,
  ReportJobIdParamsSchema,
  TemplateIdParamsSchema,
  ScheduleIdParamsSchema,
  ListReportJobsQuerySchema,
  ReportJobResponseSchema,
  ReportTemplateResponseSchema,
  ScheduledReportResponseSchema,
} from './schemas.js';
export type {
  ReportFormat,
  ReportJobStatus,
  AggregationType,
  AggregationConfig,
  DeliveryMethod,
  GenerateReportInput,
  MergeField,
  ConditionalSection,
  BrandingConfig,
  CreateReportTemplateInput,
  UpdateReportTemplateInput,
  CreateScheduledReportInput,
  UpdateScheduledReportInput,
  ReportJobIdParams,
  TemplateIdParams,
  ScheduleIdParams,
  ListReportJobsQuery,
  ReportJobResponse,
  ReportTemplateResponse,
  ScheduledReportResponse,
} from './schemas.js';

// Routes
export { registerReportRoutes } from './routes.js';
export type { ReportRoutesOptions } from './routes.js';
