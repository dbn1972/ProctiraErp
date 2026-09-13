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

export { reportCataloguePlugin } from './catalogue-plugin.js';
export type { ReportCataloguePluginOptions } from './catalogue-plugin.js';
export { CatalogueService } from './catalogue-service.js';
export { createReportStore, resetSharedReportStoreForTests } from './create-report-store.js';
export { InMemoryReportStore } from './report-store.js';
export { InMemoryReportBlobStore, createReportBlobStore } from './blob-store.js';
export { computeNextRunAt, createReportScheduler } from './scheduler.js';
export { REPORT_CATALOGUE, resolveReportKey } from './catalogue.js';
export type { CatalogueReportKey, CatalogueReportFormat, CatalogueEntry } from './catalogue.js';
export { registerCatalogueRoutes } from './catalogue-routes.js';
export { sha256Hex } from './generators.js';
export { createReportDownloadToken, verifyReportDownloadToken } from './signed-download.js';
export { buildRoleDashboard, inferDashboardRole } from './dashboards.js';
export type { DashboardRole, RoleDashboard } from './dashboards.js';

export {
  InMemoryScheduleDelivery,
  NoopScheduleDelivery,
} from './schedule-delivery.js';
export type { ScheduleDeliveryPort, ScheduleDeliveryRequest } from './schedule-delivery.js';
export { REPORT_SCHEDULE_LEASE_MS, REPORT_SCHEDULE_RETRY_MS } from './catalogue-service.js';
