/**
 * Document Generation Routes
 *
 * POST   /examinations/:examinationId/documents/generate  - Request document generation
 * GET    /examinations/:examinationId/documents/jobs       - List document generation jobs
 * GET    /examinations/:examinationId/documents/jobs/:jobId - Get job status
 * POST   /examinations/:examinationId/documents/jobs/:jobId/process - Process a queued job (worker endpoint)
 *
 * Requirements:
 * - 10.6: Generate examination documents (admit cards, seating plans, result certificates)
 *         as PDF files within 60 seconds per batch of up to 500 candidates
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { DocumentGenerationService } from './document-generation-service.js';
import {
  GenerateDocumentsSchema,
  DocumentExaminationParamsSchema,
  DocumentJobParamsSchema,
  type GenerateDocumentsInput,
  type DocumentExaminationParams,
  type DocumentJobParams,
} from './document-schemas.js';

/**
 * Options for registering document generation routes.
 */
export interface DocumentRoutesOptions {
  documentGenerationService: DocumentGenerationService;
  /** Route prefix (default: '/examinations') */
  prefix?: string;
}

/**
 * Serialize a document generation job for API response.
 */
function serializeJob(job: {
  id: string;
  examinationId: string;
  documentType: string;
  status: string;
  totalCandidates: number;
  processedCount: number;
  failedCount: number;
  errorMessage?: string;
  outputPath?: string;
  durationMs?: number;
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
}) {
  return {
    id: job.id,
    examinationId: job.examinationId,
    documentType: job.documentType,
    status: job.status,
    totalCandidates: job.totalCandidates,
    processedCount: job.processedCount,
    failedCount: job.failedCount,
    errorMessage: job.errorMessage,
    outputPath: job.outputPath,
    durationMs: job.durationMs,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString(),
    completedAt: job.completedAt?.toISOString(),
  };
}

/**
 * Register document generation routes on a Fastify instance.
 */
export async function registerDocumentRoutes(
  fastify: FastifyInstance,
  options: DocumentRoutesOptions,
): Promise<void> {
  const { documentGenerationService, prefix = '/examinations' } = options;

  /**
   * POST /examinations/:examinationId/documents/generate
   * Request document generation (queued via RabbitMQ).
   */
  fastify.post(
    `${prefix}/:examinationId/documents/generate`,
    async function generateHandler(
      request: FastifyRequest<{
        Params: DocumentExaminationParams;
        Body: GenerateDocumentsInput;
      }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DocumentExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(GenerateDocumentsSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid document generation request',
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
        const job = await documentGenerationService.requestGeneration(
          tenantId,
          paramsResult.data.examinationId,
          bodyResult.data,
        );

        return reply.status(202).send(serializeJob(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /examinations/:examinationId/documents/jobs
   * List all document generation jobs for an examination.
   */
  fastify.get(
    `${prefix}/:examinationId/documents/jobs`,
    async function listJobsHandler(
      request: FastifyRequest<{ Params: DocumentExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DocumentExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
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
        const jobs = await documentGenerationService.listJobs(
          tenantId,
          paramsResult.data.examinationId,
        );

        return reply.status(200).send({
          jobs: jobs.map(serializeJob),
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
   * GET /examinations/:examinationId/documents/jobs/:jobId
   * Get the status of a document generation job.
   */
  fastify.get(
    `${prefix}/:examinationId/documents/jobs/:jobId`,
    async function getJobHandler(
      request: FastifyRequest<{ Params: DocumentJobParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DocumentJobParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
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
        const job = await documentGenerationService.getJobStatus(tenantId, paramsResult.data.jobId);

        return reply.status(200).send(serializeJob(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /examinations/:examinationId/documents/jobs/:jobId/process
   * Process a queued document generation job (worker endpoint).
   * In production, this is called by the RabbitMQ consumer worker.
   */
  fastify.post(
    `${prefix}/:examinationId/documents/jobs/:jobId/process`,
    async function processJobHandler(
      request: FastifyRequest<{ Params: DocumentJobParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(DocumentJobParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
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
        const job = await documentGenerationService.processJob(tenantId, paramsResult.data.jobId);

        return reply.status(200).send(serializeJob(job));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
