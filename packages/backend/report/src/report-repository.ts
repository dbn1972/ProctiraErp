/**
 * Report Repository Interface
 *
 * Defines the data access contract for the report engine.
 * Implementations can target PostgreSQL, in-memory (testing), etc.
 *
 * Requirements:
 * - 17.1: Configurable report generation with filters, grouping, aggregation
 * - 17.2: Multi-format export (XLSX, PDF, CSV)
 * - 17.3: Report card templates with merge fields
 * - 17.4: Queue long-running reports for background processing
 * - 17.5: RBAC-scoped data filtering
 * - 17.6: Scheduled report generation with delivery
 */
import type {
  ReportFormat,
  ReportJobStatus,
  AggregationConfig,
  MergeField,
  ConditionalSection,
  BrandingConfig,
  DeliveryMethod,
} from './schemas.js';

// ─── Entities ────────────────────────────────────────────────────────────────

/**
 * A report job tracking the generation of a single report.
 */
export interface ReportJobEntity {
  id: string;
  tenantId: string;
  reportType: string;
  format: ReportFormat;
  status: ReportJobStatus;
  filters: Record<string, unknown>;
  groupBy: string[] | null;
  aggregations: AggregationConfig[] | null;
  templateId: string | null;
  title: string | null;
  requestedBy: string;
  requestedByArea: string | null;
  requestedByRole: string | null;
  fileUrl: string | null;
  fileSize: number | null;
  rowCount: number | null;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A report card template with merge fields and conditional sections.
 */
export interface ReportTemplateEntity {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  format: ReportFormat;
  layout: string;
  mergeFields: MergeField[];
  conditionalSections: ConditionalSection[] | null;
  branding: BrandingConfig | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A scheduled report configuration.
 */
export interface ScheduledReportEntity {
  id: string;
  tenantId: string;
  name: string;
  reportType: string;
  format: ReportFormat;
  filters: Record<string, unknown>;
  groupBy: string[] | null;
  aggregations: AggregationConfig[] | null;
  templateId: string | null;
  cronExpression: string;
  deliveryMethod: DeliveryMethod;
  recipientUserIds: string[] | null;
  recipientEmails: string[] | null;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Query Types ─────────────────────────────────────────────────────────────

export interface ReportJobQueryOptions {
  page: number;
  pageSize: number;
  status?: ReportJobStatus;
  reportType?: string;
}

export interface PaginatedReportJobs {
  data: ReportJobEntity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── RBAC Context ────────────────────────────────────────────────────────────

/**
 * User context for RBAC-scoped data filtering.
 */
export interface ReportUserContext {
  userId: string;
  tenantId: string;
  roleId: string | null;
  areaId: string | null;
  institutionIds: string[];
  /** Descendant area IDs the user has access to */
  accessibleAreaIds: string[];
}

// ─── Data Source Interface ───────────────────────────────────────────────────

/**
 * Interface for fetching report data from various modules.
 * Implementations query the appropriate module's data with RBAC filtering.
 */
export interface ReportDataSource {
  /**
   * Fetch report data with filters, grouping, and aggregation.
   * Applies RBAC scoping based on user context.
   */
  fetchData(
    tenantId: string,
    reportType: string,
    filters: Record<string, unknown>,
    groupBy: string[] | null,
    aggregations: AggregationConfig[] | null,
    userContext: ReportUserContext,
  ): Promise<ReportDataResult>;
}

export interface ReportDataResult {
  rows: Record<string, unknown>[];
  columns: ReportColumn[];
  totalRows: number;
}

export interface ReportColumn {
  name: string;
  type: 'string' | 'number' | 'date' | 'boolean';
  label?: string;
}

// ─── Repository Interface ────────────────────────────────────────────────────

export interface ReportRepository {
  // ─── Report Jobs ─────────────────────────────────────────────────────────

  /** Create a new report job */
  createJob(entity: ReportJobEntity): Promise<ReportJobEntity>;

  /** Get a report job by ID */
  getJobById(tenantId: string, id: string): Promise<ReportJobEntity | null>;

  /** Update a report job */
  updateJob(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportJobEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportJobEntity | null>;

  /** List report jobs for a tenant with pagination and filtering */
  listJobs(
    tenantId: string,
    requestedBy: string,
    options: ReportJobQueryOptions,
  ): Promise<PaginatedReportJobs>;

  // ─── Report Templates ──────────────────────────────────────────────────

  /** Create a report template */
  createTemplate(entity: ReportTemplateEntity): Promise<ReportTemplateEntity>;

  /** Get a template by ID */
  getTemplateById(tenantId: string, id: string): Promise<ReportTemplateEntity | null>;

  /** Update a report template */
  updateTemplate(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportTemplateEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportTemplateEntity | null>;

  /** Delete a report template */
  deleteTemplate(tenantId: string, id: string): Promise<boolean>;

  /** List all templates for a tenant */
  listTemplates(tenantId: string): Promise<ReportTemplateEntity[]>;

  // ─── Scheduled Reports ─────────────────────────────────────────────────

  /** Create a scheduled report */
  createSchedule(entity: ScheduledReportEntity): Promise<ScheduledReportEntity>;

  /** Get a scheduled report by ID */
  getScheduleById(tenantId: string, id: string): Promise<ScheduledReportEntity | null>;

  /** Update a scheduled report */
  updateSchedule(
    id: string,
    tenantId: string,
    update: Partial<Omit<ScheduledReportEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ScheduledReportEntity | null>;

  /** Delete a scheduled report */
  deleteSchedule(tenantId: string, id: string): Promise<boolean>;

  /** List all scheduled reports for a tenant */
  listSchedules(tenantId: string): Promise<ScheduledReportEntity[]>;

  /** Get active schedules that are due for execution */
  getDueSchedules(currentTime: Date): Promise<ScheduledReportEntity[]>;
}
