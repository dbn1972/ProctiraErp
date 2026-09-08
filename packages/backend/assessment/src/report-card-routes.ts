/**
 * Report Card Routes
 *
 * Templates:
 *   POST   /report-cards/templates       - Create a report card template
 *   GET    /report-cards/templates       - List templates
 *   GET    /report-cards/templates/:id   - Get a template
 *   PUT    /report-cards/templates/:id   - Update a template
 *   DELETE /report-cards/templates/:id   - Delete a template
 *
 * Teacher Comments:
 *   POST   /report-cards/comments        - Create/update a teacher comment
 *   GET    /report-cards/comments        - Get comments for a student+period
 *
 * Generation:
 *   POST   /report-cards/generate        - Queue single report card generation
 *   POST   /report-cards/generate/bulk   - Queue bulk report card generation
 *   GET    /report-cards/jobs/:jobId     - Get job status
 *
 * Requirements: 8.7
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  CreateReportCardTemplateSchema,
  UpdateReportCardTemplateSchema,
  ReportCardTemplateParamsSchema,
  UpsertTeacherCommentSchema,
  TeacherCommentsQuerySchema,
  GenerateReportCardSchema,
  BulkGenerateReportCardSchema,
  ReportCardJobParamsSchema,
  type CreateReportCardTemplateInput,
  type UpdateReportCardTemplateInput,
  type ReportCardTemplateParams,
  type UpsertTeacherCommentInput,
  type TeacherCommentsQuery,
  type GenerateReportCardInput,
  type BulkGenerateReportCardInput,
  type ReportCardJobParams,
} from './report-card-schemas.js';
import type { ReportCardService } from './report-card-service.js';

/**
 * Options for registering report card routes.
 */
export interface ReportCardRoutesOptions {
  reportCardService: ReportCardService;
  /** Route prefix (default: '/report-cards') */
  prefix?: string;
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Format a template entity to API response.
 */
function formatTemplateResponse(entity: {
  id: string;
  tenantId: string;
  name: string;
  templateContent: string;
  isDefault: boolean;
  includeLogo: boolean;
  includeGradeSummary: boolean;
  includeComments: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    templateContent: entity.templateContent,
    isDefault: entity.isDefault,
    includeLogo: entity.includeLogo,
    includeGradeSummary: entity.includeGradeSummary,
    includeComments: entity.includeComments,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format a comment entity to API response.
 */
function formatCommentResponse(entity: {
  id: string;
  studentId: string;
  subjectId: string;
  academicPeriodId: string;
  teacherId: string;
  comment: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    studentId: entity.studentId,
    subjectId: entity.subjectId,
    academicPeriodId: entity.academicPeriodId,
    teacherId: entity.teacherId,
    comment: entity.comment,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Format a job entity to API response.
 */
function formatJobResponse(entity: {
  id: string;
  studentId: string;
  academicPeriodId: string;
  templateId: string;
  institutionId: string;
  status: string;
  errorMessage: string | null;
  outputUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: entity.id,
    studentId: entity.studentId,
    academicPeriodId: entity.academicPeriodId,
    templateId: entity.templateId,
    institutionId: entity.institutionId,
    status: entity.status,
    errorMessage: entity.errorMessage,
    outputUrl: entity.outputUrl,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
    completedAt: entity.completedAt?.toISOString() ?? null,
  };
}

/**
 * Register all report card routes on a Fastify instance.
 */
export async function registerReportCardRoutes(
  fastify: FastifyInstance,
  options: ReportCardRoutesOptions,
): Promise<void> {
  const { reportCardService, prefix = '/report-cards' } = options;

  // ─── Template Routes ───────────────────────────────────────────────────

  /**
   * POST /report-cards/templates
   * Create a new report card template.
   */
  fastify.post(
    `${prefix}/templates`,
    async function createTemplateHandler(
      request: FastifyRequest<{ Body: CreateReportCardTemplateInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateReportCardTemplateSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportCardService.createTemplate(tenantId, result.data);
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
   * GET /report-cards/templates
   * List all report card templates.
   */
  fastify.get(
    `${prefix}/templates`,
    async function listTemplatesHandler(
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const templates = await reportCardService.listTemplates(tenantId);
      return reply.status(200).send({
        data: templates.map(formatTemplateResponse),
      });
    },
  );

  /**
   * GET /report-cards/templates/:id
   * Get a single template.
   */
  fastify.get(
    `${prefix}/templates/:id`,
    async function getTemplateHandler(
      request: FastifyRequest<{ Params: ReportCardTemplateParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardTemplateParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportCardService.getTemplate(tenantId, paramsResult.data.id);
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
   * PUT /report-cards/templates/:id
   * Update a template.
   */
  fastify.put(
    `${prefix}/templates/:id`,
    async function updateTemplateHandler(
      request: FastifyRequest<{ Params: ReportCardTemplateParams; Body: UpdateReportCardTemplateInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardTemplateParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateReportCardTemplateSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const template = await reportCardService.updateTemplate(
          tenantId,
          paramsResult.data.id,
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
   * DELETE /report-cards/templates/:id
   * Delete a template.
   */
  fastify.delete(
    `${prefix}/templates/:id`,
    async function deleteTemplateHandler(
      request: FastifyRequest<{ Params: ReportCardTemplateParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardTemplateParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid template ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        await reportCardService.deleteTemplate(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Teacher Comment Routes ────────────────────────────────────────────

  /**
   * POST /report-cards/comments
   * Create or update a teacher comment.
   */
  fastify.post(
    `${prefix}/comments`,
    async function upsertCommentHandler(
      request: FastifyRequest<{ Body: UpsertTeacherCommentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(UpsertTeacherCommentSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const comment = await reportCardService.upsertComment(tenantId, result.data);
        return reply.status(201).send(formatCommentResponse(comment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /report-cards/comments?studentId=...&academicPeriodId=...
   * Get teacher comments for a student in an academic period.
   */
  fastify.get(
    `${prefix}/comments`,
    async function getCommentsHandler(
      request: FastifyRequest<{ Querystring: TeacherCommentsQuery }>,
      reply: FastifyReply,
    ) {
      const queryData = { ...request.query } as Record<string, unknown>;
      const result = validate(TeacherCommentsQuerySchema, queryData);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const comments = await reportCardService.getComments(
        tenantId,
        result.data.studentId,
        result.data.academicPeriodId,
      );

      return reply.status(200).send({
        data: comments.map(formatCommentResponse),
      });
    },
  );

  // ─── Generation Routes ─────────────────────────────────────────────────

  /**
   * POST /report-cards/generate
   * Queue a single report card generation job.
   */
  fastify.post(
    `${prefix}/generate`,
    async function generateReportCardHandler(
      request: FastifyRequest<{ Body: GenerateReportCardInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(GenerateReportCardSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const job = await reportCardService.queueReportCardGeneration(tenantId, result.data);
        return reply.status(202).send(formatJobResponse(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /report-cards/generate/bulk
   * Queue bulk report card generation for multiple students.
   */
  fastify.post(
    `${prefix}/generate/bulk`,
    async function bulkGenerateReportCardHandler(
      request: FastifyRequest<{ Body: BulkGenerateReportCardInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(BulkGenerateReportCardSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const bulkResult = await reportCardService.queueBulkReportCardGeneration(tenantId, result.data);
        return reply.status(202).send({
          totalStudents: bulkResult.totalStudents,
          jobsCreated: bulkResult.jobsCreated,
          jobs: bulkResult.jobs.map(formatJobResponse),
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
   * GET /report-cards/jobs/:jobId
   * Get the status of a report card generation job.
   */
  fastify.get(
    `${prefix}/jobs/:jobId`,
    async function getJobStatusHandler(
      request: FastifyRequest<{ Params: ReportCardJobParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardJobParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid job ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const job = await reportCardService.getJobStatus(tenantId, paramsResult.data.jobId);
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
   * POST /report-cards/jobs/:jobId/process
   * Process a queued job now (worker / operator entry point). Produces the PDF.
   */
  fastify.post(
    `${prefix}/jobs/:jobId/process`,
    async function processJobHandler(
      request: FastifyRequest<{ Params: ReportCardJobParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardJobParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid job ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const job = await reportCardService.processReportCardJob(tenantId, paramsResult.data.jobId);
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
   * GET /report-cards/jobs/:jobId/download
   * Stream the generated PDF (G-716). 409 while the job is not completed.
   */
  fastify.get(
    `${prefix}/jobs/:jobId/download`,
    async function downloadReportCardHandler(
      request: FastifyRequest<{ Params: ReportCardJobParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReportCardJobParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid job ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const artifact = await reportCardService.getReportCardPdf(tenantId, paramsResult.data.jobId);
        return reply
          .status(200)
          .header('Content-Type', artifact.contentType)
          .header('Content-Disposition', `attachment; filename="${artifact.filename}"`)
          .header('Content-Length', String(artifact.bytes.length))
          .send(artifact.bytes);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
