/**
 * Report Engine Routes
 *
 * POST   /reports/generate                - Generate a report
 * GET    /reports/jobs                     - List report jobs
 * GET    /reports/jobs/:jobId              - Get report job status
 * GET    /reports/jobs/:jobId/download     - Download completed report
 * POST   /reports/templates               - Create a report template
 * GET    /reports/templates               - List report templates
 * GET    /reports/templates/:templateId   - Get a report template
 * PUT    /reports/templates/:templateId   - Update a report template
 * DELETE /reports/templates/:templateId   - Delete a report template
 * POST   /reports/schedules              - Create a scheduled report
 * GET    /reports/schedules              - List scheduled reports
 * GET    /reports/schedules/:scheduleId  - Get a scheduled report
 * PUT    /reports/schedules/:scheduleId  - Update a scheduled report
 * DELETE /reports/schedules/:scheduleId  - Delete a scheduled report
 *
 * Requirements:
 * - 17.1: Configurable report generation with filters, grouping, aggregation
 * - 17.2: Multi-format export (XLSX, PDF, CSV)
 * - 17.3: Report card templates with merge fields
 * - 17.4: Queue long-running reports for background processing
 * - 17.5: RBAC-scoped data filtering
 * - 17.6: Scheduled report generation with delivery
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ReportUserContext } from './report-repository.js';
import type { ReportService } from './report-service.js';
import {
  GenerateReportSchema,
  CreateReportTemplateSchema,
  UpdateReportTemplateSchema,
  CreateScheduledReportSchema,
  UpdateScheduledReportSchema,
  ReportJobIdParamsSchema,
  TemplateIdParamsSchema,
  ScheduleIdParamsSchema,
  ListReportJobsQuerySchema,
} from './schemas.js';

/**
 * Options for registering report routes.
 */
export interface ReportRoutesOptions {
  reportService: ReportService;
  /** Route prefix (default: '/reports') */
  prefix?: string;
}

/**
 * Extract user context from request for RBAC scoping.
 */
function extractUserContext(request: FastifyRequest, tenantId: string): ReportUserContext {
  const user = (
    request as FastifyRequest & {
      user?: {
        sub?: string;
        roles?: Array<{ roleId: string; areaId: string }>;
        areas?: string[];
        institutions?: string[];
      };
    }
  ).user;

  return {
    userId: user?.sub ?? 'anonymous',
    tenantId,
    roleId: user?.roles?.[0]?.roleId ?? null,
    areaId: user?.roles?.[0]?.areaId ?? null,
    institutionIds: user?.institutions ?? [],
    accessibleAreaIds: user?.areas ?? [],
  };
}

/**
 * Format a report job entity to the API response shape.
 */
function formatJobResponse(entity: {
  id: string;
  tenantId: string;
  reportType: string;
  format: string;
  status: string;
  filters: Record<string, unknown>;
  groupBy: string[] | null;
  aggregations: unknown[] | null;
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
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    reportType: entity.reportType,
    format: entity.format,
    status: entity.status,
    filters: entity.filters,
    groupBy: entity.groupBy,
    aggregations: entity.aggregations,
    templateId: entity.templateId,
    title: entity.title,
    requestedBy: entity.requestedBy,
    requestedByArea: entity.requestedByArea,
    requestedByRole: entity.requestedByRole,
    fileUrl: entity.fileUrl,
    fileSize: entity.fileSize,
    rowCount: entity.rowCount,
    errorMessage: entity.errorMessage,
    startedAt: entity.startedAt?.toISOString() ?? null,
    completedAt: entity.completedAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format a report template entity to the API response shape.
 */
function formatTemplateResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  format: string;
  layout: string;
  mergeFields: unknown[];
  conditionalSections: unknown[] | null;
  branding: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    type: entity.type,
    format: entity.format,
    layout: entity.layout,
    mergeFields: entity.mergeFields,
    conditionalSections: entity.conditionalSections,
    branding: entity.branding,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format a scheduled report entity to the API response shape.
 */
function formatScheduleResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  reportType: string;
  format: string;
  filters: Record<string, unknown>;
  groupBy: string[] | null;
  aggregations: unknown[] | null;
  templateId: string | null;
  cronExpression: string;
  deliveryMethod: string;
  recipientUserIds: string[] | null;
  recipientEmails: string[] | null;
  isActive: boolean;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    reportType: entity.reportType,
    format: entity.format,
    filters: entity.filters,
    groupBy: entity.groupBy,
    aggregations: entity.aggregations,
    templateId: entity.templateId,
    cronExpression: entity.cronExpression,
    deliveryMethod: entity.deliveryMethod,
    recipientUserIds: entity.recipientUserIds,
    recipientEmails: entity.recipientEmails,
    isActive: entity.isActive,
    lastRunAt: entity.lastRunAt?.toISOString() ?? null,
    nextRunAt: entity.nextRunAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register report routes on a Fastify instance.
 */
export async function registerReportRoutes(
  fastify: FastifyInstance,
  options: ReportRoutesOptions,
): Promise<void> {
  const { reportService, prefix = '/reports' } = options;

  // ─── Generate Report ─────────────────────────────────────────────────

  /**
   * POST /reports/generate
   * Generate a report with configurable filters, grouping, and aggregation.
   */
  fastify.post(
    `${prefix}/generate`,
    async function generateReportHandler(request: FastifyRequest, reply: FastifyReply) {
      const result = validate(GenerateReportSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const userContext = extractUserContext(request, tenantId);

      try {
        const job = await reportService.generateReport(tenantId, result.data, userContext);
        return reply.status(202).send(formatJobResponse(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Report Jobs ─────────────────────────────────────────────────────

  /**
   * GET /reports/jobs
   * List report jobs for the current user.
   */
  fastify.get(
    `${prefix}/jobs`,
    async function listJobsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const queryResult = validate(ListReportJobsQuerySchema, request.query ?? {});
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }

      const userContext = extractUserContext(request, tenantId);

      try {
        const result = await reportService.listReportJobs(
          tenantId,
          userContext.userId,
          queryResult.data,
        );
        return reply.status(200).send({
          data: result.data.map(formatJobResponse),
          pagination: {
            page: result.page,
            pageSize: result.pageSize,
            total: result.total,
            totalPages: result.totalPages,
          },
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/jobs/:jobId
   * Get report job status.
   */
  fastify.get(
    `${prefix}/jobs/:jobId`,
    async function getJobStatusHandler(
      request: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportJobIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const job = await reportService.getReportStatus(tenantId, paramsResult.data.jobId);
        return reply.status(200).send(formatJobResponse(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/jobs/:jobId/download
   * Download a completed report file.
   */
  fastify.get(
    `${prefix}/jobs/:jobId/download`,
    async function downloadReportHandler(
      request: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportJobIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const file = await reportService.downloadReport(tenantId, paramsResult.data.jobId);
        const job = await reportService.getReportStatus(tenantId, paramsResult.data.jobId);

        const contentType = getContentType(job.format);
        return reply
          .status(200)
          .header('Content-Type', contentType)
          .header('Content-Disposition', `attachment; filename="report.${job.format}"`)
          .send(file);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Report Templates ──────────────────────────────────────────────────

  /**
   * POST /reports/templates
   * Create a report template.
   */
  fastify.post(
    `${prefix}/templates`,
    async function createTemplateHandler(request: FastifyRequest, reply: FastifyReply) {
      const result = validate(CreateReportTemplateSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportService.createTemplate(tenantId, result.data);
        return reply.status(201).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/templates
   * List all report templates for the tenant.
   */
  fastify.get(
    `${prefix}/templates`,
    async function listTemplatesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const templates = await reportService.listTemplates(tenantId);
        return reply.status(200).send({ data: templates.map(formatTemplateResponse) });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/templates/:templateId
   * Get a report template by ID.
   */
  fastify.get(
    `${prefix}/templates/:templateId`,
    async function getTemplateHandler(
      request: FastifyRequest<{ Params: { templateId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TemplateIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportService.getTemplate(tenantId, paramsResult.data.templateId);
        return reply.status(200).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /reports/templates/:templateId
   * Update a report template.
   */
  fastify.put(
    `${prefix}/templates/:templateId`,
    async function updateTemplateHandler(
      request: FastifyRequest<{ Params: { templateId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TemplateIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateReportTemplateSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportService.updateTemplate(
          tenantId,
          paramsResult.data.templateId,
          bodyResult.data,
        );
        return reply.status(200).send(formatTemplateResponse(template));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /reports/templates/:templateId
   * Delete a report template.
   */
  fastify.delete(
    `${prefix}/templates/:templateId`,
    async function deleteTemplateHandler(
      request: FastifyRequest<{ Params: { templateId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TemplateIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await reportService.deleteTemplate(tenantId, paramsResult.data.templateId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Scheduled Reports ─────────────────────────────────────────────────

  /**
   * POST /reports/schedules
   * Create a scheduled report.
   */
  fastify.post(
    `${prefix}/schedules`,
    async function createScheduleHandler(request: FastifyRequest, reply: FastifyReply) {
      const result = validate(CreateScheduledReportSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const schedule = await reportService.createSchedule(tenantId, result.data);
        return reply.status(201).send(formatScheduleResponse(schedule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/schedules
   * List all scheduled reports for the tenant.
   */
  fastify.get(
    `${prefix}/schedules`,
    async function listSchedulesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const schedules = await reportService.listSchedules(tenantId);
        return reply.status(200).send({ data: schedules.map(formatScheduleResponse) });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /reports/schedules/:scheduleId
   * Get a scheduled report by ID.
   */
  fastify.get(
    `${prefix}/schedules/:scheduleId`,
    async function getScheduleHandler(
      request: FastifyRequest<{ Params: { scheduleId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScheduleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const schedule = await reportService.getSchedule(tenantId, paramsResult.data.scheduleId);
        return reply.status(200).send(formatScheduleResponse(schedule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /reports/schedules/:scheduleId
   * Update a scheduled report.
   */
  fastify.put(
    `${prefix}/schedules/:scheduleId`,
    async function updateScheduleHandler(
      request: FastifyRequest<{ Params: { scheduleId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScheduleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateScheduledReportSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const schedule = await reportService.updateSchedule(
          tenantId,
          paramsResult.data.scheduleId,
          bodyResult.data,
        );
        return reply.status(200).send(formatScheduleResponse(schedule));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /reports/schedules/:scheduleId
   * Delete a scheduled report.
   */
  fastify.delete(
    `${prefix}/schedules/:scheduleId`,
    async function deleteScheduleHandler(
      request: FastifyRequest<{ Params: { scheduleId: string } }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScheduleIdParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await reportService.deleteSchedule(tenantId, paramsResult.data.scheduleId);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getContentType(format: string): string {
  switch (format) {
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pdf':
      return 'application/pdf';
    case 'csv':
      return 'text/csv';
    default:
      return 'application/octet-stream';
  }
}
