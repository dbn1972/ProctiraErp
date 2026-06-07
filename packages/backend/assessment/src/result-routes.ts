/**
 * Assessment Result Routes
 *
 * Routes:
 *   POST   /results              - Enter a single result
 *   POST   /results/bulk         - Bulk entry via data grid (up to 5000 rows)
 *   POST   /results/import       - Excel import (up to 5000 rows)
 *   GET    /results/grades       - Get calculated grades for student(s)
 *
 * Requirements: 8.4, 8.5, 8.8
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ResultService } from './result-service.js';
import {
  EnterSingleResultSchema,
  BulkResultEntrySchema,
  StudentResultsQuerySchema,
  type EnterSingleResultInput,
  type BulkResultEntryInput,
  type StudentResultsQuery,
} from './result-schemas.js';

/**
 * Options for registering result routes.
 */
export interface ResultRoutesOptions {
  resultService: ResultService;
  /** Route prefix for results (default: '/results') */
  resultsPrefix?: string;
}

/**
 * Extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Register all assessment result routes on a Fastify instance.
 */
export async function registerResultRoutes(
  fastify: FastifyInstance,
  options: ResultRoutesOptions,
): Promise<void> {
  const { resultService, resultsPrefix = '/results' } = options;

  /**
   * POST /results
   * Enter a single assessment result.
   * Requirement 8.4: Validate score within range, calculate grade.
   * Requirement 8.5: Reject out-of-range with error.
   */
  fastify.post(
    resultsPrefix,
    async function enterSingleResultHandler(
      request: FastifyRequest<{ Body: EnterSingleResultInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(EnterSingleResultSchema, request.body);
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
        const entry = await resultService.enterSingleResult(tenantId, result.data);
        return reply.status(201).send({
          id: entry.id,
          studentId: entry.studentId,
          assessmentItemId: entry.assessmentItemId,
          score: entry.score,
          createdAt: entry.createdAt.toISOString(),
          updatedAt: entry.updatedAt.toISOString(),
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
   * POST /results/bulk
   * Bulk entry of assessment results via data grid interface.
   * Requirement 8.8: Up to 5000 rows, row-level validation errors.
   */
  fastify.post(
    `${resultsPrefix}/bulk`,
    async function enterBulkResultsHandler(
      request: FastifyRequest<{ Body: BulkResultEntryInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(BulkResultEntrySchema, request.body);
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
        const response = await resultService.enterBulkResults(tenantId, result.data);
        return reply.status(200).send(response);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /results/import
   * Import assessment results from Excel file.
   * Expects JSON body with parsed rows (Excel parsing handled by client/middleware).
   * Requirement 8.8: Excel import for up to 5000 rows.
   */
  fastify.post(
    `${resultsPrefix}/import`,
    async function importResultsHandler(
      request: FastifyRequest<{
        Body: {
          subjectId: string;
          academicPeriodId: string;
          rows: Array<{ studentId: string; assessmentItemId: string; score: number }>;
        };
      }>,
      reply: FastifyReply,
    ) {
      const body = request.body as {
        subjectId?: string;
        academicPeriodId?: string;
        rows?: Array<{ studentId: string; assessmentItemId: string; score: number }>;
      };

      if (!body.subjectId || !body.academicPeriodId || !Array.isArray(body.rows)) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Request must include subjectId, academicPeriodId, and rows array',
          statusCode: 400,
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
        const response = await resultService.importFromExcel(
          tenantId,
          body.subjectId,
          body.academicPeriodId,
          body.rows,
        );
        return reply.status(200).send(response);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /results/grades?subjectId=...&academicPeriodId=...&studentId=...
   * Get calculated grades for a student or all students in a subject+period.
   * Requirement 8.4: Calculate weighted averages and assign grades.
   */
  fastify.get(
    `${resultsPrefix}/grades`,
    async function getGradesHandler(
      request: FastifyRequest<{ Querystring: StudentResultsQuery }>,
      reply: FastifyReply,
    ) {
      const queryData = { ...request.query } as Record<string, unknown>;
      const result = validate(StudentResultsQuerySchema, queryData);
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
        if (result.data.studentId) {
          // Single student grade
          const grade = await resultService.calculateStudentGrade(
            tenantId,
            result.data.studentId,
            result.data.subjectId,
            result.data.academicPeriodId,
          );
          return reply.status(200).send({ data: [grade] });
        } else {
          // All students
          const grades = await resultService.calculateAllGrades(
            tenantId,
            result.data.subjectId,
            result.data.academicPeriodId,
          );
          return reply.status(200).send({ data: grades });
        }
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
