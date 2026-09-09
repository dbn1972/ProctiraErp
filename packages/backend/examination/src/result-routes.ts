/**
 * Result Publication Routes
 *
 * POST   /examinations/:examinationId/results/publish   - Publish results (trigger grade calculation)
 * GET    /examinations/:examinationId/results           - Get publication result
 * POST   /examinations/:examinationId/results/marks     - Record marks before publication (G-902)
 * GET    /examinations/:examinationId/results/marks     - Recorded marks per candidate (G-902)
 * POST   /examinations/:examinationId/results/analysis  - Generate result analysis
 * GET    /examinations/:examinationId/results/analysis  - Get result analysis
 *
 * Requirements:
 * - 10.4: Calculate final grades and update academic records within 30 seconds
 * - 10.5: Handle incomplete result data gracefully
 * - 10.8: Provide result analysis with breakdowns by subject, center, gender, area
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ResultPublicationService } from './result-publication-service.js';
import {
  RecordMarksSchema,
  ResultExaminationParamsSchema,
  type RecordMarksBody,
  type ResultExaminationParams,
} from './result-schemas.js';

/**
 * Options for registering result publication routes.
 */
export interface ResultRoutesOptions {
  resultPublicationService: ResultPublicationService;
  /** Route prefix (default: '/examinations') */
  prefix?: string;
}

/**
 * Register result publication routes on a Fastify instance.
 */
export async function registerResultRoutes(
  fastify: FastifyInstance,
  options: ResultRoutesOptions,
): Promise<void> {
  const { resultPublicationService, prefix = '/examinations' } = options;

  /**
   * POST /examinations/:examinationId/results/publish
   * Trigger result publication and grade calculation.
   */
  fastify.post(
    `${prefix}/:examinationId/results/publish`,
    async function publishHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
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
        const result = await resultPublicationService.publishResults(
          tenantId,
          paramsResult.data.examinationId,
        );

        return reply.status(200).send({
          examinationId: result.examinationId,
          publishedAt: result.publishedAt.toISOString(),
          totalCandidates: result.totalCandidates,
          processedCount: result.processedCount,
          incompleteCount: result.incompleteCount,
          durationMs: result.durationMs,
          gradeResults: result.gradeResults,
          incompleteRecords: result.incompleteRecords,
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
   * GET /examinations/:examinationId/results
   * Get publication result for an examination.
   */
  fastify.get(
    `${prefix}/:examinationId/results`,
    async function getResultsHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
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
        const result = await resultPublicationService.getPublicationResult(
          tenantId,
          paramsResult.data.examinationId,
        );

        return reply.status(200).send({
          examinationId: result.examinationId,
          publishedAt: result.publishedAt.toISOString(),
          totalCandidates: result.totalCandidates,
          processedCount: result.processedCount,
          incompleteCount: result.incompleteCount,
          durationMs: result.durationMs,
          gradeResults: result.gradeResults,
          incompleteRecords: result.incompleteRecords,
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
   * POST /examinations/:examinationId/results/marks
   * Record marks for registered candidates (pre-publication).
   */
  fastify.post(
    `${prefix}/:examinationId/results/marks`,
    async function recordMarksHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams; Body: RecordMarksBody }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(RecordMarksSchema, request.body);
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
        const summary = await resultPublicationService.recordMarks(
          tenantId,
          paramsResult.data.examinationId,
          bodyResult.data,
        );
        return reply.status(200).send(summary);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /examinations/:examinationId/results/marks
   * Recorded marks per candidate (drives the Results tab before publication).
   */
  fastify.get(
    `${prefix}/:examinationId/results/marks`,
    async function getMarksHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
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
        const candidates = await resultPublicationService.getMarks(
          tenantId,
          paramsResult.data.examinationId,
        );
        return reply.status(200).send({ data: candidates, meta: { total: candidates.length } });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /examinations/:examinationId/results/analysis
   * Generate result analysis for a published examination.
   */
  fastify.post(
    `${prefix}/:examinationId/results/analysis`,
    async function generateAnalysisHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
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
        const analysis = await resultPublicationService.generateAnalysis(
          tenantId,
          paramsResult.data.examinationId,
        );

        return reply.status(200).send({
          examinationId: analysis.examinationId,
          generatedAt: analysis.generatedAt.toISOString(),
          overall: analysis.overall,
          bySubject: analysis.bySubject,
          byCenter: analysis.byCenter,
          byGender: analysis.byGender,
          byArea: analysis.byArea,
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
   * GET /examinations/:examinationId/results/analysis
   * Get previously generated result analysis.
   */
  fastify.get(
    `${prefix}/:examinationId/results/analysis`,
    async function getAnalysisHandler(
      request: FastifyRequest<{ Params: ResultExaminationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ResultExaminationParamsSchema, request.params);
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
        const analysis = await resultPublicationService.getAnalysis(
          tenantId,
          paramsResult.data.examinationId,
        );

        return reply.status(200).send({
          examinationId: analysis.examinationId,
          generatedAt: analysis.generatedAt.toISOString(),
          overall: analysis.overall,
          bySubject: analysis.bySubject,
          byCenter: analysis.byCenter,
          byGender: analysis.byGender,
          byArea: analysis.byArea,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
