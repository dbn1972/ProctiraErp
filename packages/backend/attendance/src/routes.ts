/**
 * Attendance Routes
 *
 * POST   /attendance/student          - Record single student attendance
 * POST   /attendance/student/bulk     - Record bulk student attendance (class)
 * POST   /attendance/staff            - Record staff attendance
 * GET    /attendance/roster           - Get class roster with attendance
 * GET    /attendance/config/:institutionId - Get institution attendance config
 *
 * Requirements:
 * - 9.1: Student attendance recording with configurable mode
 * - 9.2: Staff attendance with leave types
 * - 9.3: Pre-populate roster from enrollment
 * - 9.7: Date validation (no future dates)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { AttendanceService } from './attendance-service.js';
import {
  RecordStudentAttendanceSchema,
  RecordBulkStudentAttendanceSchema,
  RecordStaffAttendanceSchema,
  ClassRosterQuerySchema,
  AttendancePercentageQuerySchema,
  AbsenceThresholdCheckQuerySchema,
  AttendanceAuditQuerySchema,
  type RecordStudentAttendanceInput,
  type RecordBulkStudentAttendanceInput,
  type RecordStaffAttendanceInput,
  type ClassRosterQuery,
  type AttendancePercentageQueryInput,
  type AbsenceThresholdCheckQueryInput,
  type AttendanceAuditQueryInput,
} from './schemas.js';

/**
 * Options for registering attendance routes.
 */
export interface AttendanceRoutesOptions {
  attendanceService: AttendanceService;
  /** Route prefix (default: '/attendance') */
  prefix?: string;
}

/**
 * Formats a student attendance entity to the API response shape.
 */
function formatStudentAttendanceResponse(entity: {
  id: string;
  studentId: string;
  institutionId: string;
  classId: string;
  academicPeriodId: string;
  date: string;
  subjectId: string | null;
  periodId: string | null;
  status: string;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    studentId: entity.studentId,
    institutionId: entity.institutionId,
    classId: entity.classId,
    academicPeriodId: entity.academicPeriodId,
    date: entity.date,
    subjectId: entity.subjectId,
    periodId: entity.periodId,
    status: entity.status,
    comment: entity.comment,
    recordedBy: entity.recordedBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a staff attendance entity to the API response shape.
 */
function formatStaffAttendanceResponse(entity: {
  id: string;
  staffId: string;
  institutionId: string;
  date: string;
  status: string;
  leaveTypeId: string | null;
  comment: string | null;
  recordedBy: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    staffId: entity.staffId,
    institutionId: entity.institutionId,
    date: entity.date,
    status: entity.status,
    leaveTypeId: entity.leaveTypeId,
    comment: entity.comment,
    recordedBy: entity.recordedBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register attendance routes on a Fastify instance.
 */
export async function registerAttendanceRoutes(
  fastify: FastifyInstance,
  options: AttendanceRoutesOptions,
): Promise<void> {
  const { attendanceService, prefix = '/attendance' } = options;

  /**
   * POST /attendance/student
   * Record a single student's attendance.
   */
  fastify.post(
    `${prefix}/student`,
    async function recordStudentHandler(
      request: FastifyRequest<{ Body: RecordStudentAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecordStudentAttendanceSchema, request.body);
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

      // Use authenticated user ID or fallback
      const recordedBy = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'system';

      try {
        const record = await attendanceService.recordStudentAttendance(
          tenantId,
          result.data,
          recordedBy,
        );
        return reply.status(201).send(formatStudentAttendanceResponse(record));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /attendance/student/bulk
   * Record attendance for an entire class.
   */
  fastify.post(
    `${prefix}/student/bulk`,
    async function recordBulkStudentHandler(
      request: FastifyRequest<{ Body: RecordBulkStudentAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecordBulkStudentAttendanceSchema, request.body);
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

      const recordedBy = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'system';

      try {
        const bulkResult = await attendanceService.recordBulkStudentAttendance(
          tenantId,
          result.data,
          recordedBy,
        );
        return reply.status(201).send({
          recorded: bulkResult.recorded.map(formatStudentAttendanceResponse),
          updated: bulkResult.updated.map(formatStudentAttendanceResponse),
          errors: bulkResult.errors,
          summary: {
            totalRecorded: bulkResult.recorded.length,
            totalUpdated: bulkResult.updated.length,
            totalErrors: bulkResult.errors.length,
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
   * POST /attendance/staff
   * Record staff attendance.
   */
  fastify.post(
    `${prefix}/staff`,
    async function recordStaffHandler(
      request: FastifyRequest<{ Body: RecordStaffAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecordStaffAttendanceSchema, request.body);
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

      const recordedBy = (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'system';

      try {
        const record = await attendanceService.recordStaffAttendance(
          tenantId,
          result.data,
          recordedBy,
        );
        return reply.status(201).send(formatStaffAttendanceResponse(record));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /attendance/roster
   * Get class roster with existing attendance data for a date.
   */
  fastify.get(
    `${prefix}/roster`,
    async function getRosterHandler(
      request: FastifyRequest<{ Querystring: ClassRosterQuery }>,
      reply: FastifyReply,
    ) {
      const result = validate(ClassRosterQuerySchema, { ...request.query });
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
        const roster = await attendanceService.getClassRoster(
          tenantId,
          result.data.classId,
          result.data.academicPeriodId,
          result.data.date,
        );
        return reply.status(200).send({ data: roster });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /attendance/config/:institutionId
   * Get institution attendance configuration.
   */
  fastify.get(
    `${prefix}/config/:institutionId`,
    async function getConfigHandler(
      request: FastifyRequest<{ Params: { institutionId: string } }>,
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

      const { institutionId } = request.params;

      try {
        const config = await attendanceService.getAttendanceConfig(tenantId, institutionId);
        return reply.status(200).send(config);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /attendance/percentage
   * Calculate attendance percentage for a student, class, or institution.
   *
   * Requirement 9.4: Calculate attendance percentages per student, class, and
   * institution for configurable date ranges, rounded to two decimal places.
   */
  fastify.get(
    `${prefix}/percentage`,
    async function getPercentageHandler(
      request: FastifyRequest<{ Querystring: AttendancePercentageQueryInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(AttendancePercentageQuerySchema, { ...request.query });
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
        const percentage = await attendanceService.calculateAttendancePercentage(
          tenantId,
          result.data,
        );
        return reply.status(200).send(percentage);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /attendance/threshold-check
   * Check if a student's absence count exceeds the configured threshold.
   *
   * Requirement 9.5: Trigger alert notification when threshold exceeded.
   */
  fastify.get(
    `${prefix}/threshold-check`,
    async function thresholdCheckHandler(
      request: FastifyRequest<{ Querystring: AbsenceThresholdCheckQueryInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(AbsenceThresholdCheckQuerySchema, { ...request.query });
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
        const thresholdResult = await attendanceService.checkAbsenceThreshold(
          tenantId,
          result.data.studentId,
          result.data.institutionId,
        );
        return reply.status(200).send(thresholdResult);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /attendance/audit/:attendanceId
   * Get audit trail for a specific attendance record.
   *
   * Requirement 9.6: Maintain audit trail of changes with previous status value.
   */
  fastify.get(
    `${prefix}/audit/:attendanceId`,
    async function getAuditTrailHandler(
      request: FastifyRequest<{ Params: { attendanceId: string } }>,
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

      const { attendanceId } = request.params;

      try {
        const auditTrail = await attendanceService.getAttendanceAuditTrail(attendanceId);
        return reply.status(200).send({ data: auditTrail });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
