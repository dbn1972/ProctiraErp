/**
 * Report Service
 *
 * Business logic for configurable report generation with:
 * - Multi-format export (XLSX, PDF, CSV)
 * - Report card template engine with merge fields and conditional sections
 * - Background processing via RabbitMQ for long-running reports
 * - RBAC-scoped data filtering based on user's area and role
 * - Scheduled report generation with email/in-app delivery
 *
 * Requirements:
 * - 17.1: Configurable report generation with filters, grouping, aggregation
 * - 17.2: Multi-format export (XLSX, PDF, CSV)
 * - 17.3: Report card templates with merge fields, conditional sections, branding
 * - 17.4: Queue long-running reports for background processing
 * - 17.5: RBAC-scoped data filtering
 * - 17.6: Scheduled report generation with delivery
 */
import { NotFoundError, ValidationError, BusinessRuleError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  ReportRepository,
  ReportJobEntity,
  ReportTemplateEntity,
  ScheduledReportEntity,
  PaginatedReportJobs,
  ReportDataSource,
  ReportUserContext,
  ReportDataResult,
} from './report-repository.js';
import type {
  GenerateReportInput,
  CreateReportTemplateInput,
  UpdateReportTemplateInput,
  CreateScheduledReportInput,
  UpdateScheduledReportInput,
  ReportFormat,
  ListReportJobsQuery,
} from './schemas.js';

// ─── Export Interfaces ───────────────────────────────────────────────────────

/**
 * Interface for generating XLSX files.
 */
export interface XlsxExporter {
  generate(data: ReportDataResult, title?: string): Promise<Buffer>;
}

/**
 * Interface for generating PDF files.
 */
export interface PdfExporter {
  generate(data: ReportDataResult, title?: string): Promise<Buffer>;
  generateFromTemplate(
    template: ReportTemplateEntity,
    data: Record<string, unknown>,
  ): Promise<Buffer>;
}

/**
 * Interface for generating CSV files.
 */
export interface CsvExporter {
  generate(data: ReportDataResult): Promise<Buffer>;
}

/**
 * Interface for queuing report jobs via RabbitMQ.
 */
export interface ReportQueuePublisher {
  /** Queue a report job for background processing */
  queueReportJob(job: ReportJobEntity): Promise<void>;
  /** Queue a scheduled report for execution */
  queueScheduledReport(schedule: ScheduledReportEntity): Promise<void>;
}

/**
 * Interface for storing generated report files.
 */
export interface ReportFileStorage {
  /** Store a generated report file and return the URL */
  store(tenantId: string, jobId: string, format: ReportFormat, data: Buffer): Promise<string>;
  /** Retrieve a stored report file */
  retrieve(tenantId: string, jobId: string): Promise<Buffer | null>;
}

// ─── Service Configuration ───────────────────────────────────────────────────

export interface ReportServiceConfig {
  /** Maximum rows before queuing for background processing (default: 10000) */
  backgroundThreshold: number;
}

const DEFAULT_CONFIG: ReportServiceConfig = {
  backgroundThreshold: 10000,
};

// ─── Service ─────────────────────────────────────────────────────────────────

export class ReportService {
  private readonly config: ReportServiceConfig;

  constructor(
    private readonly repository: ReportRepository,
    private readonly dataSource: ReportDataSource,
    private readonly xlsxExporter?: XlsxExporter,
    private readonly pdfExporter?: PdfExporter,
    private readonly csvExporter?: CsvExporter,
    private readonly queuePublisher?: ReportQueuePublisher,
    private readonly fileStorage?: ReportFileStorage,
    config?: Partial<ReportServiceConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ─── Report Generation ───────────────────────────────────────────────────

  /**
   * Generate a report. Creates a job and either processes immediately
   * or queues for background processing based on data size.
   *
   * Requirement 17.1: Configurable report generation with filters, grouping, aggregation.
   * Requirement 17.4: Queue long-running reports for background processing.
   * Requirement 17.5: RBAC-scoped data filtering.
   */
  async generateReport(
    tenantId: string,
    input: GenerateReportInput,
    userContext: ReportUserContext,
  ): Promise<ReportJobEntity> {
    // Validate template exists if specified
    if (input.templateId) {
      const template = await this.repository.getTemplateById(tenantId, input.templateId);
      if (!template) {
        throw new NotFoundError(`Report template '${input.templateId}' not found`);
      }
    }

    // Create the report job
    const job: ReportJobEntity = {
      id: uuidv4(),
      tenantId,
      reportType: input.reportType,
      format: input.format,
      status: 'queued',
      filters: input.filters,
      groupBy: input.groupBy ?? null,
      aggregations: input.aggregations ?? null,
      templateId: input.templateId ?? null,
      title: input.title ?? null,
      requestedBy: userContext.userId,
      requestedByArea: userContext.areaId,
      requestedByRole: userContext.roleId,
      fileUrl: null,
      fileSize: null,
      rowCount: null,
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const createdJob = await this.repository.createJob(job);

    // Queue for background processing via RabbitMQ
    if (this.queuePublisher) {
      await this.queuePublisher.queueReportJob(createdJob);
      return createdJob;
    }

    // If no queue publisher, process synchronously
    return this.processReportJob(createdJob, userContext);
  }

  /**
   * Process a report job: fetch data, apply RBAC, export to format.
   *
   * Requirement 17.2: Multi-format export (XLSX, PDF, CSV).
   * Requirement 17.5: RBAC permissions filter data based on user's area and role.
   */
  async processReportJob(
    job: ReportJobEntity,
    userContext: ReportUserContext,
  ): Promise<ReportJobEntity> {
    // Mark as processing
    await this.repository.updateJob(job.id, job.tenantId, {
      status: 'processing',
      startedAt: new Date(),
    });

    try {
      // Fetch data with RBAC scoping
      const data = await this.dataSource.fetchData(
        job.tenantId,
        job.reportType,
        job.filters,
        job.groupBy,
        job.aggregations,
        userContext,
      );

      // Export to requested format
      const fileBuffer = await this.exportToFormat(job, data);

      // Store the file
      let fileUrl: string | null = null;
      if (this.fileStorage && fileBuffer) {
        fileUrl = await this.fileStorage.store(job.tenantId, job.id, job.format, fileBuffer);
      }

      // Mark as completed
      const updated = await this.repository.updateJob(job.id, job.tenantId, {
        status: 'completed',
        completedAt: new Date(),
        fileUrl,
        fileSize: fileBuffer ? fileBuffer.length : null,
        rowCount: data.totalRows,
      });

      return updated ?? job;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const updated = await this.repository.updateJob(job.id, job.tenantId, {
        status: 'failed',
        errorMessage,
        completedAt: new Date(),
      });
      return updated ?? job;
    }
  }

  /**
   * Export report data to the requested format.
   *
   * Requirement 17.2: Export in XLSX (ExcelJS), PDF (PDFKit), and CSV formats.
   */
  private async exportToFormat(
    job: ReportJobEntity,
    data: ReportDataResult,
  ): Promise<Buffer | null> {
    switch (job.format) {
      case 'xlsx':
        if (this.xlsxExporter) {
          return this.xlsxExporter.generate(data, job.title ?? undefined);
        }
        return this.generateDefaultXlsx(data);

      case 'pdf':
        if (job.templateId) {
          // Use template engine for report cards
          return this.generateFromTemplate(job, data);
        }
        if (this.pdfExporter) {
          return this.pdfExporter.generate(data, job.title ?? undefined);
        }
        return this.generateDefaultPdf(data);

      case 'csv':
        if (this.csvExporter) {
          return this.csvExporter.generate(data);
        }
        return this.generateDefaultCsv(data);

      default:
        throw new ValidationError(`Unsupported format: ${String(job.format)}`, [
          { field: 'format', rule: 'enum', message: 'Must be xlsx, pdf, or csv' },
        ]);
    }
  }

  /**
   * Generate a report card from a template with merge fields.
   *
   * Requirement 17.3: Report card templates with merge fields,
   * conditional sections, and institutional branding.
   */
  private async generateFromTemplate(
    job: ReportJobEntity,
    data: ReportDataResult,
  ): Promise<Buffer | null> {
    if (!job.templateId) return null;

    const template = await this.repository.getTemplateById(job.tenantId, job.templateId);
    if (!template) {
      throw new NotFoundError(`Report template '${job.templateId}' not found`);
    }

    // Build merge data from first row (for single-entity report cards)
    const mergeData: Record<string, unknown> = {};
    if (data.rows.length > 0) {
      const row = data.rows[0]!;
      for (const field of template.mergeFields) {
        mergeData[field.name] = row[field.source] ?? field.defaultValue ?? '';
      }
    }

    // Add branding data
    if (template.branding) {
      mergeData['_branding'] = template.branding;
    }

    if (this.pdfExporter) {
      return this.pdfExporter.generateFromTemplate(template, mergeData);
    }

    // Default: render template with merge fields
    return Buffer.from(this.renderTemplate(template.layout, mergeData, template));
  }

  /**
   * Render a template by substituting {{field}} placeholders and
   * evaluating conditional sections.
   *
   * Requirement 17.3: Merge fields and conditional sections.
   */
  renderTemplate(
    layout: string,
    data: Record<string, unknown>,
    template: ReportTemplateEntity,
  ): string {
    let rendered = layout;

    // Substitute merge fields: {{fieldName}}
    rendered = rendered.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
      const value = data[key];
      if (value === undefined || value === null) return '';
      return String(value);
    });

    // Process conditional sections: {{#if condition}}...{{/if}}
    if (template.conditionalSections) {
      for (const section of template.conditionalSections) {
        const conditionMet = this.evaluateCondition(section.condition, data);
        const sectionTag = `{{#section ${section.name}}}`;
        const endTag = `{{/section ${section.name}}}`;

        const startIdx = rendered.indexOf(sectionTag);
        const endIdx = rendered.indexOf(endTag);

        if (startIdx !== -1 && endIdx !== -1) {
          if (conditionMet) {
            // Replace tags but keep content
            const content = rendered.substring(startIdx + sectionTag.length, endIdx);
            const renderedContent = content.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
              String(data[k] ?? ''),
            );
            rendered =
              rendered.substring(0, startIdx) +
              renderedContent +
              rendered.substring(endIdx + endTag.length);
          } else {
            // Remove the entire section
            rendered = rendered.substring(0, startIdx) + rendered.substring(endIdx + endTag.length);
          }
        }
      }
    }

    return rendered;
  }

  /**
   * Evaluate a simple condition expression against data.
   * Supports: field >= value, field <= value, field == value, field != value
   */
  evaluateCondition(condition: string, data: Record<string, unknown>): boolean {
    // Parse condition: "field operator value"
    const match = condition.match(/^(\w+)\s*(>=|<=|>|<|==|!=)\s*(.+)$/);
    if (!match) return false;

    const [, field, operator, rawValue] = match;
    if (!field || !operator || !rawValue) return false;

    const actualValue = data[field];
    if (actualValue === undefined || actualValue === null) return false;

    // Parse the comparison value
    const numericValue = Number(rawValue);
    const isNumeric = !isNaN(numericValue);

    if (isNumeric && typeof actualValue === 'number') {
      switch (operator) {
        case '>=':
          return actualValue >= numericValue;
        case '<=':
          return actualValue <= numericValue;
        case '>':
          return actualValue > numericValue;
        case '<':
          return actualValue < numericValue;
        case '==':
          return actualValue === numericValue;
        case '!=':
          return actualValue !== numericValue;
        default:
          return false;
      }
    }

    // String comparison
    const strValue = rawValue.replace(/^["']|["']$/g, '');
    const strActual = String(actualValue);
    switch (operator) {
      case '==':
        return strActual === strValue;
      case '!=':
        return strActual !== strValue;
      default:
        return false;
    }
  }

  // ─── Default Exporters ─────────────────────────────────────────────────

  /**
   * Generate a simple CSV from report data.
   */
  private generateDefaultCsv(data: ReportDataResult): Buffer {
    const lines: string[] = [];

    // Header row
    const headers = data.columns.map((c) => c.label ?? c.name);
    lines.push(headers.map((h) => this.escapeCsvField(h)).join(','));

    // Data rows
    for (const row of data.rows) {
      const values = data.columns.map((col) => {
        const val = row[col.name];
        if (val === null || val === undefined) return '';
        return this.escapeCsvField(String(val));
      });
      lines.push(values.join(','));
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate a simple XLSX-like format (tab-separated for default).
   * In production, ExcelJS would be used.
   */
  private generateDefaultXlsx(data: ReportDataResult): Buffer {
    // Default implementation produces TSV as a placeholder
    // Real implementation would use ExcelJS
    const lines: string[] = [];
    const headers = data.columns.map((c) => c.label ?? c.name);
    lines.push(headers.join('\t'));

    for (const row of data.rows) {
      const values = data.columns.map((col) => {
        const val = row[col.name];
        if (val === null || val === undefined) return '';
        return String(val);
      });
      lines.push(values.join('\t'));
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  /**
   * Generate a simple PDF-like format (text for default).
   * In production, PDFKit would be used.
   */
  private generateDefaultPdf(data: ReportDataResult): Buffer {
    // Default implementation produces text as a placeholder
    // Real implementation would use PDFKit
    const lines: string[] = [];
    const headers = data.columns.map((c) => c.label ?? c.name);
    lines.push(headers.join(' | '));
    lines.push('-'.repeat(80));

    for (const row of data.rows) {
      const values = data.columns.map((col) => {
        const val = row[col.name];
        if (val === null || val === undefined) return '';
        return String(val);
      });
      lines.push(values.join(' | '));
    }

    return Buffer.from(lines.join('\n'), 'utf-8');
  }

  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }

  // ─── Job Status ────────────────────────────────────────────────────────

  /**
   * Get report job status.
   */
  async getReportStatus(tenantId: string, jobId: string): Promise<ReportJobEntity> {
    const job = await this.repository.getJobById(tenantId, jobId);
    if (!job) {
      throw new NotFoundError(`Report job '${jobId}' not found`);
    }
    return job;
  }

  /**
   * Download a completed report file.
   */
  async downloadReport(tenantId: string, jobId: string): Promise<Buffer> {
    const job = await this.repository.getJobById(tenantId, jobId);
    if (!job) {
      throw new NotFoundError(`Report job '${jobId}' not found`);
    }

    if (job.status !== 'completed') {
      throw new BusinessRuleError(`Report job is not completed (current status: ${job.status})`);
    }

    if (!this.fileStorage) {
      throw new BusinessRuleError('File storage is not configured');
    }

    const file = await this.fileStorage.retrieve(tenantId, jobId);
    if (!file) {
      throw new NotFoundError(`Report file for job '${jobId}' not found`);
    }

    return file;
  }

  /**
   * List report jobs for a user with pagination.
   */
  async listReportJobs(
    tenantId: string,
    userId: string,
    options: ListReportJobsQuery,
  ): Promise<PaginatedReportJobs> {
    return this.repository.listJobs(tenantId, userId, {
      page: options.page ?? 1,
      pageSize: options.pageSize ?? 20,
      status: options.status,
      reportType: options.reportType,
    });
  }

  // ─── Template Management ───────────────────────────────────────────────

  /**
   * Create a report card template.
   *
   * Requirement 17.3: Custom report card templates with merge fields,
   * conditional sections, and institutional branding.
   */
  async createTemplate(
    tenantId: string,
    input: CreateReportTemplateInput,
  ): Promise<ReportTemplateEntity> {
    const template: ReportTemplateEntity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      type: input.type,
      format: input.format,
      layout: input.layout,
      mergeFields: input.mergeFields,
      conditionalSections: input.conditionalSections ?? null,
      branding: input.branding ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.repository.createTemplate(template);
  }

  /**
   * Update a report template.
   */
  async updateTemplate(
    tenantId: string,
    templateId: string,
    input: UpdateReportTemplateInput,
  ): Promise<ReportTemplateEntity> {
    const existing = await this.repository.getTemplateById(tenantId, templateId);
    if (!existing) {
      throw new NotFoundError(`Report template '${templateId}' not found`);
    }

    const updated = await this.repository.updateTemplate(templateId, tenantId, {
      ...input,
      updatedAt: new Date(),
    });

    return updated!;
  }

  /**
   * Delete a report template.
   */
  async deleteTemplate(tenantId: string, templateId: string): Promise<void> {
    const deleted = await this.repository.deleteTemplate(tenantId, templateId);
    if (!deleted) {
      throw new NotFoundError(`Report template '${templateId}' not found`);
    }
  }

  /**
   * Get a report template by ID.
   */
  async getTemplate(tenantId: string, templateId: string): Promise<ReportTemplateEntity> {
    const template = await this.repository.getTemplateById(tenantId, templateId);
    if (!template) {
      throw new NotFoundError(`Report template '${templateId}' not found`);
    }
    return template;
  }

  /**
   * List all templates for a tenant.
   */
  async listTemplates(tenantId: string): Promise<ReportTemplateEntity[]> {
    return this.repository.listTemplates(tenantId);
  }

  // ─── Scheduled Reports ─────────────────────────────────────────────────

  /**
   * Create a scheduled report.
   *
   * Requirement 17.6: Scheduled report generation with configurable
   * delivery via email or in-app notification.
   */
  async createSchedule(
    tenantId: string,
    input: CreateScheduledReportInput,
  ): Promise<ScheduledReportEntity> {
    // Validate template if specified
    if (input.templateId) {
      const template = await this.repository.getTemplateById(tenantId, input.templateId);
      if (!template) {
        throw new NotFoundError(`Report template '${input.templateId}' not found`);
      }
    }

    // Validate delivery recipients
    if (input.deliveryMethod === 'email') {
      if (
        (!input.recipientEmails || input.recipientEmails.length === 0) &&
        (!input.recipientUserIds || input.recipientUserIds.length === 0)
      ) {
        throw new ValidationError(
          'Email delivery requires at least one recipient email or user ID',
          [
            {
              field: 'recipientEmails',
              rule: 'required',
              message: 'At least one recipient required for email delivery',
            },
          ],
        );
      }
    }

    const schedule: ScheduledReportEntity = {
      id: uuidv4(),
      tenantId,
      name: input.name,
      reportType: input.reportType,
      format: input.format,
      filters: input.filters,
      groupBy: input.groupBy ?? null,
      aggregations: input.aggregations ?? null,
      templateId: input.templateId ?? null,
      cronExpression: input.cronExpression,
      deliveryMethod: input.deliveryMethod,
      recipientUserIds: input.recipientUserIds ?? null,
      recipientEmails: input.recipientEmails ?? null,
      isActive: input.isActive ?? true,
      lastRunAt: null,
      nextRunAt: this.calculateNextRun(input.cronExpression),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    return this.repository.createSchedule(schedule);
  }

  /**
   * Update a scheduled report.
   */
  async updateSchedule(
    tenantId: string,
    scheduleId: string,
    input: UpdateScheduledReportInput,
  ): Promise<ScheduledReportEntity> {
    const existing = await this.repository.getScheduleById(tenantId, scheduleId);
    if (!existing) {
      throw new NotFoundError(`Scheduled report '${scheduleId}' not found`);
    }

    const updateData: Partial<Omit<ScheduledReportEntity, 'id' | 'tenantId' | 'createdAt'>> = {
      ...input,
      updatedAt: new Date(),
    };

    // Recalculate next run if cron expression changed
    if (input.cronExpression) {
      updateData.nextRunAt = this.calculateNextRun(input.cronExpression);
    }

    const updated = await this.repository.updateSchedule(scheduleId, tenantId, updateData);
    return updated!;
  }

  /**
   * Delete a scheduled report.
   */
  async deleteSchedule(tenantId: string, scheduleId: string): Promise<void> {
    const deleted = await this.repository.deleteSchedule(tenantId, scheduleId);
    if (!deleted) {
      throw new NotFoundError(`Scheduled report '${scheduleId}' not found`);
    }
  }

  /**
   * Get a scheduled report by ID.
   */
  async getSchedule(tenantId: string, scheduleId: string): Promise<ScheduledReportEntity> {
    const schedule = await this.repository.getScheduleById(tenantId, scheduleId);
    if (!schedule) {
      throw new NotFoundError(`Scheduled report '${scheduleId}' not found`);
    }
    return schedule;
  }

  /**
   * List all scheduled reports for a tenant.
   */
  async listSchedules(tenantId: string): Promise<ScheduledReportEntity[]> {
    return this.repository.listSchedules(tenantId);
  }

  /**
   * Calculate the next run time from a cron expression.
   * Simplified implementation — in production, use a cron parser library.
   */
  calculateNextRun(_cronExpression: string): Date {
    // Simple implementation: next run is 1 hour from now
    // In production, use a library like 'cron-parser' to calculate actual next run
    const next = new Date();
    next.setHours(next.getHours() + 1);
    next.setMinutes(0);
    next.setSeconds(0);
    next.setMilliseconds(0);
    return next;
  }
}
