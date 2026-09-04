/**
 * Prisma Report Repository
 *
 * Production implementation of {@link ReportRepository} backed by PostgreSQL
 * via Prisma. Tenant-scoped reads/writes run inside
 * {@link withTenantTransaction} (tenantId also kept in every `where` clause).
 *
 * Persistence covers ReportJob, ReportTemplate, and ScheduledReport — the
 * full {@link ReportRepository} surface. Cross-module analytical queries live
 * on {@link ReportDataSource}, not this repository.
 *
 * `getDueSchedules` has no tenantId in its signature. It iterates active
 * platform tenants and runs a tenant-scoped query for each so RLS remains
 * enforced. Empty tenant lists yield an empty result.
 */
import { withTenantTransaction } from '@proctira/database';
import type { Prisma, PrismaClient } from '@proctira/database';

import type {
  PaginatedReportJobs,
  ReportJobEntity,
  ReportJobQueryOptions,
  ReportRepository,
  ReportTemplateEntity,
  ScheduledReportEntity,
} from './report-repository.js';
import type {
  AggregationConfig,
  BrandingConfig,
  ConditionalSection,
  DeliveryMethod,
  MergeField,
  ReportFormat,
  ReportJobStatus,
} from './schemas.js';

interface ReportJobRow {
  id: string;
  tenantId: string;
  reportType: string;
  format: string;
  status: string;
  filters: unknown;
  groupBy: unknown;
  aggregations: unknown;
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

interface ReportTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  format: string;
  layout: string;
  mergeFields: unknown;
  conditionalSections: unknown;
  branding: unknown;
  createdAt: Date;
  updatedAt: Date;
}

interface ScheduledReportRow {
  id: string;
  tenantId: string;
  name: string;
  reportType: string;
  format: string;
  filters: unknown;
  groupBy: unknown;
  aggregations: unknown;
  templateId: string | null;
  cronExpression: string;
  deliveryMethod: string;
  recipientUserIds: unknown;
  recipientEmails: unknown;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function asStringArray(value: unknown): string[] | null {
  if (value == null) return null;
  return Array.isArray(value) ? value.map((v) => String(v)) : null;
}

function asAggregations(value: unknown): AggregationConfig[] | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value as AggregationConfig[]) : null;
}

function asMergeFields(value: unknown): MergeField[] {
  return Array.isArray(value) ? (value as MergeField[]) : [];
}

function asConditionalSections(value: unknown): ConditionalSection[] | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value as ConditionalSection[]) : null;
}

function asBranding(value: unknown): BrandingConfig | null {
  if (value == null) return null;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as BrandingConfig;
  }
  return null;
}

function toJob(row: ReportJobRow): ReportJobEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    reportType: row.reportType,
    format: row.format as ReportFormat,
    status: row.status as ReportJobStatus,
    filters: asObject(row.filters),
    groupBy: asStringArray(row.groupBy),
    aggregations: asAggregations(row.aggregations),
    templateId: row.templateId,
    title: row.title,
    requestedBy: row.requestedBy,
    requestedByArea: row.requestedByArea,
    requestedByRole: row.requestedByRole,
    fileUrl: row.fileUrl,
    fileSize: row.fileSize,
    rowCount: row.rowCount,
    errorMessage: row.errorMessage,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toTemplate(row: ReportTemplateRow): ReportTemplateEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    type: row.type,
    format: row.format as ReportFormat,
    layout: row.layout,
    mergeFields: asMergeFields(row.mergeFields),
    conditionalSections: asConditionalSections(row.conditionalSections),
    branding: asBranding(row.branding),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toSchedule(row: ScheduledReportRow): ScheduledReportEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    reportType: row.reportType,
    format: row.format as ReportFormat,
    filters: asObject(row.filters),
    groupBy: asStringArray(row.groupBy),
    aggregations: asAggregations(row.aggregations),
    templateId: row.templateId,
    cronExpression: row.cronExpression,
    deliveryMethod: row.deliveryMethod as DeliveryMethod,
    recipientUserIds: asStringArray(row.recipientUserIds),
    recipientEmails: asStringArray(row.recipientEmails),
    isActive: row.isActive,
    lastRunAt: row.lastRunAt,
    nextRunAt: row.nextRunAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Report Jobs ─────────────────────────────────────────────────────────

  async createJob(entity: ReportJobEntity): Promise<ReportJobEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.reportJob.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          reportType: entity.reportType,
          format: entity.format,
          status: entity.status,
          filters: entity.filters as Prisma.InputJsonValue,
          groupBy: entity.groupBy as Prisma.InputJsonValue | undefined,
          aggregations: entity.aggregations as Prisma.InputJsonValue | undefined,
          templateId: entity.templateId,
          title: entity.title,
          requestedBy: entity.requestedBy,
          requestedByArea: entity.requestedByArea,
          requestedByRole: entity.requestedByRole,
          fileUrl: entity.fileUrl,
          fileSize: entity.fileSize,
          rowCount: entity.rowCount,
          errorMessage: entity.errorMessage,
          startedAt: entity.startedAt,
          completedAt: entity.completedAt,
        },
      })) as ReportJobRow;
      return toJob(row);
    });
  }

  async getJobById(tenantId: string, id: string): Promise<ReportJobEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.reportJob.findFirst({
        where: { id, tenantId },
      })) as ReportJobRow | null;
      return row ? toJob(row) : null;
    });
  }

  async updateJob(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportJobEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportJobEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.reportJob.findFirst({
        where: { id, tenantId },
      })) as ReportJobRow | null;
      if (!existing) return null;

      const data: Prisma.ReportJobUpdateInput = {};
      if (update.reportType !== undefined) data.reportType = update.reportType;
      if (update.format !== undefined) data.format = update.format;
      if (update.status !== undefined) data.status = update.status;
      if (update.filters !== undefined) {
        data.filters = update.filters as Prisma.InputJsonValue;
      }
      if (update.groupBy !== undefined) {
        data.groupBy = update.groupBy as Prisma.InputJsonValue;
      }
      if (update.aggregations !== undefined) {
        data.aggregations = update.aggregations as Prisma.InputJsonValue;
      }
      if (update.templateId !== undefined) data.templateId = update.templateId;
      if (update.title !== undefined) data.title = update.title;
      if (update.requestedBy !== undefined) data.requestedBy = update.requestedBy;
      if (update.requestedByArea !== undefined) {
        data.requestedByArea = update.requestedByArea;
      }
      if (update.requestedByRole !== undefined) {
        data.requestedByRole = update.requestedByRole;
      }
      if (update.fileUrl !== undefined) data.fileUrl = update.fileUrl;
      if (update.fileSize !== undefined) data.fileSize = update.fileSize;
      if (update.rowCount !== undefined) data.rowCount = update.rowCount;
      if (update.errorMessage !== undefined) data.errorMessage = update.errorMessage;
      if (update.startedAt !== undefined) data.startedAt = update.startedAt;
      if (update.completedAt !== undefined) data.completedAt = update.completedAt;

      const row = (await tx.reportJob.update({
        where: { id },
        data,
      })) as ReportJobRow;
      return toJob(row);
    });
  }

  async listJobs(
    tenantId: string,
    requestedBy: string,
    options: ReportJobQueryOptions,
  ): Promise<PaginatedReportJobs> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const where: Prisma.ReportJobWhereInput = { tenantId, requestedBy };
      if (options.status) where.status = options.status;
      if (options.reportType) where.reportType = options.reportType;

      const total = await tx.reportJob.count({ where });
      const totalPages = Math.ceil(total / options.pageSize) || 0;
      const rows = (await tx.reportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (options.page - 1) * options.pageSize,
        take: options.pageSize,
      })) as ReportJobRow[];

      return {
        data: rows.map(toJob),
        total,
        page: options.page,
        pageSize: options.pageSize,
        totalPages,
      };
    });
  }

  // ─── Report Templates ──────────────────────────────────────────────────

  async createTemplate(entity: ReportTemplateEntity): Promise<ReportTemplateEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.reportTemplate.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          type: entity.type,
          format: entity.format,
          layout: entity.layout,
          mergeFields: entity.mergeFields as Prisma.InputJsonValue,
          conditionalSections: entity.conditionalSections as
            | Prisma.InputJsonValue
            | undefined,
          branding: entity.branding as Prisma.InputJsonValue | undefined,
        },
      })) as ReportTemplateRow;
      return toTemplate(row);
    });
  }

  async getTemplateById(
    tenantId: string,
    id: string,
  ): Promise<ReportTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.reportTemplate.findFirst({
        where: { id, tenantId },
      })) as ReportTemplateRow | null;
      return row ? toTemplate(row) : null;
    });
  }

  async updateTemplate(
    id: string,
    tenantId: string,
    update: Partial<Omit<ReportTemplateEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ReportTemplateEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.reportTemplate.findFirst({
        where: { id, tenantId },
      })) as ReportTemplateRow | null;
      if (!existing) return null;

      const data: Prisma.ReportTemplateUpdateInput = {};
      if (update.name !== undefined) data.name = update.name;
      if (update.type !== undefined) data.type = update.type;
      if (update.format !== undefined) data.format = update.format;
      if (update.layout !== undefined) data.layout = update.layout;
      if (update.mergeFields !== undefined) {
        data.mergeFields = update.mergeFields as Prisma.InputJsonValue;
      }
      if (update.conditionalSections !== undefined) {
        data.conditionalSections = update.conditionalSections as Prisma.InputJsonValue;
      }
      if (update.branding !== undefined) {
        data.branding = update.branding as Prisma.InputJsonValue;
      }

      const row = (await tx.reportTemplate.update({
        where: { id },
        data,
      })) as ReportTemplateRow;
      return toTemplate(row);
    });
  }

  async deleteTemplate(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.reportTemplate.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.reportTemplate.delete({ where: { id } });
      return true;
    });
  }

  async listTemplates(tenantId: string): Promise<ReportTemplateEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.reportTemplate.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as ReportTemplateRow[];
      return rows.map(toTemplate);
    });
  }

  // ─── Scheduled Reports ─────────────────────────────────────────────────

  async createSchedule(entity: ScheduledReportEntity): Promise<ScheduledReportEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.scheduledReport.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          name: entity.name,
          reportType: entity.reportType,
          format: entity.format,
          filters: entity.filters as Prisma.InputJsonValue,
          groupBy: entity.groupBy as Prisma.InputJsonValue | undefined,
          aggregations: entity.aggregations as Prisma.InputJsonValue | undefined,
          templateId: entity.templateId,
          cronExpression: entity.cronExpression,
          deliveryMethod: entity.deliveryMethod,
          recipientUserIds: entity.recipientUserIds as Prisma.InputJsonValue | undefined,
          recipientEmails: entity.recipientEmails as Prisma.InputJsonValue | undefined,
          isActive: entity.isActive,
          lastRunAt: entity.lastRunAt,
          nextRunAt: entity.nextRunAt,
        },
      })) as ScheduledReportRow;
      return toSchedule(row);
    });
  }

  async getScheduleById(
    tenantId: string,
    id: string,
  ): Promise<ScheduledReportEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.scheduledReport.findFirst({
        where: { id, tenantId },
      })) as ScheduledReportRow | null;
      return row ? toSchedule(row) : null;
    });
  }

  async updateSchedule(
    id: string,
    tenantId: string,
    update: Partial<Omit<ScheduledReportEntity, 'id' | 'tenantId' | 'createdAt'>>,
  ): Promise<ScheduledReportEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = (await tx.scheduledReport.findFirst({
        where: { id, tenantId },
      })) as ScheduledReportRow | null;
      if (!existing) return null;

      const data: Prisma.ScheduledReportUpdateInput = {};
      if (update.name !== undefined) data.name = update.name;
      if (update.reportType !== undefined) data.reportType = update.reportType;
      if (update.format !== undefined) data.format = update.format;
      if (update.filters !== undefined) {
        data.filters = update.filters as Prisma.InputJsonValue;
      }
      if (update.groupBy !== undefined) {
        data.groupBy = update.groupBy as Prisma.InputJsonValue;
      }
      if (update.aggregations !== undefined) {
        data.aggregations = update.aggregations as Prisma.InputJsonValue;
      }
      if (update.templateId !== undefined) data.templateId = update.templateId;
      if (update.cronExpression !== undefined) {
        data.cronExpression = update.cronExpression;
      }
      if (update.deliveryMethod !== undefined) {
        data.deliveryMethod = update.deliveryMethod;
      }
      if (update.recipientUserIds !== undefined) {
        data.recipientUserIds = update.recipientUserIds as Prisma.InputJsonValue;
      }
      if (update.recipientEmails !== undefined) {
        data.recipientEmails = update.recipientEmails as Prisma.InputJsonValue;
      }
      if (update.isActive !== undefined) data.isActive = update.isActive;
      if (update.lastRunAt !== undefined) data.lastRunAt = update.lastRunAt;
      if (update.nextRunAt !== undefined) data.nextRunAt = update.nextRunAt;

      const row = (await tx.scheduledReport.update({
        where: { id },
        data,
      })) as ScheduledReportRow;
      return toSchedule(row);
    });
  }

  async deleteSchedule(tenantId: string, id: string): Promise<boolean> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const existing = await tx.scheduledReport.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!existing) return false;
      await tx.scheduledReport.delete({ where: { id } });
      return true;
    });
  }

  async listSchedules(tenantId: string): Promise<ScheduledReportEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.scheduledReport.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as ScheduledReportRow[];
      return rows.map(toSchedule);
    });
  }

  async getDueSchedules(currentTime: Date): Promise<ScheduledReportEntity[]> {
    // Cross-tenant sweep: platform.tenants is not RLS-scoped the same way as
    // report tables. For each active tenant, bind RLS and collect due rows.
    const tenants = await this.prisma.tenant.findMany({
      where: { deletedAt: null, status: 'active' },
      select: { id: true },
    });

    const due: ScheduledReportEntity[] = [];
    for (const tenant of tenants) {
      const rows = await withTenantTransaction(this.prisma, tenant.id, async (tx) => {
        return (await tx.scheduledReport.findMany({
          where: {
            tenantId: tenant.id,
            isActive: true,
            nextRunAt: { lte: currentTime, not: null },
          },
        })) as ScheduledReportRow[];
      });
      due.push(...rows.map(toSchedule));
    }
    return due;
  }
}
