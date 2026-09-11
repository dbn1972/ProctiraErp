/**
 * Enrollment Routes
 *
 * POST   /enrollments                    - Create a new enrollment
 * GET    /enrollments                    - List enrollments (paginated, filterable)
 * GET    /enrollments/:id                - Get a single enrollment
 * POST   /enrollments/:id/status         - Update enrollment status (withdraw/graduate)
 * POST   /enrollments/bulk-status        - Wave 11 bulk withdraw/graduate
 * POST   /enrollments/transfer           - Transfer a student between institutions
 * GET    /enrollments/student/:studentId/history   - Get enrollment history for a student
 * GET    /enrollments/student/:studentId/transfers - Get transfer records for a student
 *
 * Requirements: 6.2, 6.3, 6.4
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type {
  EnrollmentEntity,
  EnrollmentHistoryEntity,
  TransferRecordEntity,
} from './enrollment-repository.js';
import type { EnrollmentService } from './enrollment-service.js';
import {
  CreateEnrollmentSchema,
  UpdateEnrollmentStatusSchema,
  BulkUpdateEnrollmentStatusSchema,
  StudentTransferSchema,
  EnrollmentParamsSchema,
  StudentParamsSchema,
  type CreateEnrollmentInput,
  type UpdateEnrollmentStatusInput,
  type BulkUpdateEnrollmentStatusInput,
  type StudentTransferInput,
  type EnrollmentParams,
  type StudentParams,
  type EnrollmentListQuery,
} from './schemas.js';

/**
 * Options for registering enrollment routes.
 */
export interface EnrollmentRoutesOptions {
  enrollmentService: EnrollmentService;
  /** Route prefix (default: '/enrollments') */
  prefix?: string;
}

/**
 * Formats an enrollment entity to the API response shape.
 */
function formatEnrollmentResponse(entity: EnrollmentEntity) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    institutionId: entity.institutionId,
    gradeId: entity.gradeId,
    classId: entity.classId,
    academicPeriodId: entity.academicPeriodId,
    status: entity.status,
    enrolledAt: entity.enrolledAt.toISOString().split('T')[0],
    exitedAt: entity.exitedAt ? entity.exitedAt.toISOString().split('T')[0] : null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a history entry to the API response shape.
 */
function formatHistoryEntry(entry: EnrollmentHistoryEntity) {
  return {
    id: entry.id,
    enrollmentId: entry.enrollmentId,
    previousStatus: entry.previousStatus,
    newStatus: entry.newStatus,
    effectiveDate: entry.effectiveDate.toISOString().split('T')[0],
    institutionId: entry.institutionId,
    academicPeriodId: entry.academicPeriodId,
    reason: entry.reason,
    createdAt: entry.createdAt.toISOString(),
  };
}

/**
 * Formats a transfer record to the API response shape.
 */
function formatTransferRecord(record: TransferRecordEntity) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    studentId: record.studentId,
    sourceInstitutionId: record.sourceInstitutionId,
    sourceEnrollmentId: record.sourceEnrollmentId,
    destinationInstitutionId: record.destinationInstitutionId,
    destinationEnrollmentId: record.destinationEnrollmentId,
    transferDate: record.transferDate.toISOString().split('T')[0],
    reason: record.reason,
    createdAt: record.createdAt.toISOString(),
  };
}

/**
 * Register enrollment routes on a Fastify instance.
 */
export async function registerEnrollmentRoutes(
  fastify: FastifyInstance,
  options: EnrollmentRoutesOptions,
): Promise<void> {
  const { enrollmentService, prefix = '/enrollments' } = options;

  /**
   * POST /enrollments
   * Create a new enrollment.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateEnrollmentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateEnrollmentSchema, request.body);
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
        const enrollment = await enrollmentService.createEnrollment(tenantId, result.data);
        return reply.status(201).send(formatEnrollmentResponse(enrollment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /enrollments
   * List enrollments with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: EnrollmentListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const filter: {
        studentId?: string;
        institutionId?: string;
        academicPeriodId?: string;
        status?: 'ENROLLED' | 'TRANSFERRED' | 'WITHDRAWN' | 'GRADUATED';
      } = {
        studentId: query.studentId,
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
      };
      if (
        query.status === 'ENROLLED' ||
        query.status === 'TRANSFERRED' ||
        query.status === 'WITHDRAWN' ||
        query.status === 'GRADUATED'
      ) {
        filter.status = query.status;
      }

      const result = await enrollmentService.listEnrollments(tenantId, filter, { page, pageSize });

      return reply.status(200).send({
        data: result.data.map(formatEnrollmentResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /enrollments/:id
   * Get a single enrollment by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: EnrollmentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EnrollmentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enrollment ID',
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
        const enrollment = await enrollmentService.getEnrollmentById(
          tenantId,
          paramsResult.data.id,
        );
        return reply.status(200).send(formatEnrollmentResponse(enrollment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /enrollments/:id/status
   * Update enrollment status (withdraw or graduate).
   */
  fastify.post(
    `${prefix}/:id/status`,
    async function updateStatusHandler(
      request: FastifyRequest<{ Params: EnrollmentParams; Body: UpdateEnrollmentStatusInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EnrollmentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enrollment ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateEnrollmentStatusSchema, request.body);
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
        const enrollment = await enrollmentService.updateEnrollmentStatus(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatEnrollmentResponse(enrollment));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /enrollments/bulk-status
   * Wave 11 — withdraw or graduate many enrollments in one call.
   */
  fastify.post(
    `${prefix}/bulk-status`,
    async function bulkStatusHandler(
      request: FastifyRequest<{ Body: BulkUpdateEnrollmentStatusInput }>,
      reply: FastifyReply,
    ) {
      const bodyResult = validate(BulkUpdateEnrollmentStatusSchema, request.body);
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

      const result = await enrollmentService.bulkUpdateEnrollmentStatus(tenantId, bodyResult.data);
      return reply.status(200).send({
        updated: result.updated.map(formatEnrollmentResponse),
        failed: result.failed,
      });
    },
  );

  /**
   * POST /enrollments/transfer
   * Transfer a student between institutions.
   * Requirements: 6.3, 6.4
   */
  fastify.post(
    `${prefix}/transfer`,
    async function transferHandler(
      request: FastifyRequest<{ Body: StudentTransferInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(StudentTransferSchema, request.body);
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
        const transferResult = await enrollmentService.transferStudent(tenantId, result.data);
        return reply.status(201).send({
          sourceEnrollment: formatEnrollmentResponse(transferResult.sourceEnrollment),
          destinationEnrollment: formatEnrollmentResponse(transferResult.destinationEnrollment),
          transferRecord: formatTransferRecord(transferResult.transferRecord),
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
   * GET /enrollments/student/:studentId/history
   * Get enrollment history for a student.
   * Requirement 6.2
   */
  fastify.get(
    `${prefix}/student/:studentId/history`,
    async function historyHandler(
      request: FastifyRequest<{ Params: StudentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StudentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
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

      const history = await enrollmentService.getStudentEnrollmentHistory(
        tenantId,
        paramsResult.data.studentId,
      );
      return reply.status(200).send({
        data: history.map(formatHistoryEntry),
      });
    },
  );

  /**
   * GET /enrollments/student/:studentId/transfers
   * Get transfer records for a student.
   */
  fastify.get(
    `${prefix}/student/:studentId/transfers`,
    async function transfersHandler(
      request: FastifyRequest<{ Params: StudentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StudentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
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

      const transfers = await enrollmentService.getStudentTransferRecords(
        tenantId,
        paramsResult.data.studentId,
      );
      return reply.status(200).send({
        data: transfers.map(formatTransferRecord),
      });
    },
  );
}
