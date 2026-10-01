/**
 * Training Routes
 *
 * POST   /staff/training/programs                    - Create a training program
 * GET    /staff/training/programs                    - List training programs
 * GET    /staff/training/programs/:programId         - Get a training program
 * PUT    /staff/training/programs/:programId         - Update a training program
 * POST   /staff/training/sessions                    - Create a training session
 * GET    /staff/training/sessions/:sessionId         - Get a training session
 * GET    /staff/training/programs/:programId/sessions - List sessions for a program
 * POST   /staff/training/attendance                  - Record training attendance
 * GET    /staff/training/sessions/:sessionId/attendance - Get session attendance
 * POST   /staff/training/certifications              - Issue a certification
 * GET    /staff/training/certifications              - List certifications
 * GET    /staff/training/certifications/:certificationId - Get a certification
 * POST   /staff/training/certifications/process-expiry - Process expired certifications
 *
 * Requirements:
 * - 7.4: Manage training programs, sessions, attendance, and certification tracking
 * - 7.8: Certification expiry and notification triggering
 */
import { AppError, ValidationError } from '@proctira/common';
import { validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { staffWritePreHandler } from './staff-http-guard.js';
import {
  CreateTrainingProgramSchema,
  UpdateTrainingProgramSchema,
  CreateTrainingSessionSchema,
  RecordTrainingAttendanceSchema,
  IssueCertificationSchema,
  TrainingProgramParamsSchema,
  TrainingSessionParamsSchema,
  CertificationParamsSchema,
  TrainingProgramListQuerySchema,
  TrainingSessionListQuerySchema,
  CertificationListQuerySchema,
  type CreateTrainingProgramInput,
  type UpdateTrainingProgramInput,
  type CreateTrainingSessionInput,
  type RecordTrainingAttendanceInput,
  type IssueCertificationInput,
  type TrainingProgramParams,
  type TrainingSessionParams,
  type CertificationParams,
  type TrainingProgramListQuery,
  type CertificationListQuery,
} from './training-schemas.js';
import type { TrainingService } from './training-service.js';

/**
 * Options for registering training routes.
 */
export interface TrainingRoutesOptions {
  trainingService: TrainingService;
  prefix?: string;
}

function formatProgramResponse(entity: {
  id: string;
  name: string;
  description: string | null;
  startDate: string;
  endDate: string;
  provider: string | null;
  certificationName: string | null;
  certificationValidityDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    name: entity.name,
    description: entity.description,
    startDate: entity.startDate,
    endDate: entity.endDate,
    provider: entity.provider,
    certificationName: entity.certificationName,
    certificationValidityDays: entity.certificationValidityDays,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatSessionResponse(entity: {
  id: string;
  programId: string;
  title: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  instructorName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    programId: entity.programId,
    title: entity.title,
    date: entity.date,
    startTime: entity.startTime,
    endTime: entity.endTime,
    location: entity.location,
    instructorName: entity.instructorName,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatAttendanceResponse(entity: {
  id: string;
  sessionId: string;
  staffId: string;
  status: string;
  comment: string | null;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    sessionId: entity.sessionId,
    staffId: entity.staffId,
    status: entity.status,
    comment: entity.comment,
    createdAt: entity.createdAt.toISOString(),
  };
}

function formatCertificationResponse(entity: {
  id: string;
  staffId: string;
  programId: string;
  certificationName: string;
  issuedDate: string;
  expiryDate: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    staffId: entity.staffId,
    programId: entity.programId,
    certificationName: entity.certificationName,
    issuedDate: entity.issuedDate,
    expiryDate: entity.expiryDate,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * PRC-L155: PG date/time cast failures (invalid_datetime_format 22007, datetime_field_overflow
 * 22008, invalid_text_representation 22P02) are client input errors, not 500s.
 */
const PG_INPUT_ERROR_CODES = new Set(['22007', '22008', '22P02']);

function toTrainingAppError(error: unknown): AppError | null {
  if (error instanceof AppError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && PG_INPUT_ERROR_CODES.has(code)) {
    return new ValidationError('Invalid date or time value');
  }
  return null;
}

/**
 * Register training routes on a Fastify instance.
 */
export async function registerTrainingRoutes(
  fastify: FastifyInstance,
  options: TrainingRoutesOptions,
): Promise<void> {
  const { trainingService, prefix = '/staff/training' } = options;

  fastify.addHook('preHandler', async (request, reply) => {
    if (!staffWritePreHandler(request, reply, 'staff.hr.write')) return reply;
  });

  // ─── Training Programs ───────────────────────────────────────────────

  /**
   * POST /staff/training/programs
   */
  fastify.post(
    `${prefix}/programs`,
    async function createProgramHandler(
      request: FastifyRequest<{ Body: CreateTrainingProgramInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateTrainingProgramSchema, request.body);
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
        const program = await trainingService.createProgram(tenantId, result.data);
        return reply.status(201).send(formatProgramResponse(program));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * GET /staff/training/programs
   */
  fastify.get(
    `${prefix}/programs`,
    async function listProgramsHandler(
      request: FastifyRequest<{ Querystring: TrainingProgramListQuery }>,
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

      // PRC-L154: validate + coerce paging instead of Number(x) || default.
      const queryResult = validateQuery(TrainingProgramListQuerySchema, request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }
      const query = queryResult.data;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;

      const result = await trainingService.listPrograms(tenantId, query.search, { page, pageSize });
      return reply.status(200).send({
        data: result.data.map(formatProgramResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/training/programs/:programId
   */
  fastify.get(
    `${prefix}/programs/:programId`,
    async function getProgramHandler(
      request: FastifyRequest<{ Params: TrainingProgramParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TrainingProgramParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid program ID',
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
        const program = await trainingService.getProgram(tenantId, paramsResult.data.programId);
        return reply.status(200).send(formatProgramResponse(program));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * PUT /staff/training/programs/:programId
   */
  fastify.put(
    `${prefix}/programs/:programId`,
    async function updateProgramHandler(
      request: FastifyRequest<{ Params: TrainingProgramParams; Body: UpdateTrainingProgramInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TrainingProgramParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid program ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateTrainingProgramSchema, request.body);
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
        const program = await trainingService.updateProgram(
          tenantId,
          paramsResult.data.programId,
          bodyResult.data,
        );
        return reply.status(200).send(formatProgramResponse(program));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  // ─── Training Sessions ───────────────────────────────────────────────

  /**
   * POST /staff/training/sessions
   */
  fastify.post(
    `${prefix}/sessions`,
    async function createSessionHandler(
      request: FastifyRequest<{ Body: CreateTrainingSessionInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateTrainingSessionSchema, request.body);
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
        const session = await trainingService.createSession(tenantId, result.data);
        return reply.status(201).send(formatSessionResponse(session));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * GET /staff/training/sessions/:sessionId
   */
  fastify.get(
    `${prefix}/sessions/:sessionId`,
    async function getSessionHandler(
      request: FastifyRequest<{ Params: TrainingSessionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TrainingSessionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid session ID',
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
        const session = await trainingService.getSession(tenantId, paramsResult.data.sessionId);
        return reply.status(200).send(formatSessionResponse(session));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * GET /staff/training/programs/:programId/sessions
   */
  fastify.get(
    `${prefix}/programs/:programId/sessions`,
    async function listSessionsHandler(
      request: FastifyRequest<{ Params: TrainingProgramParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TrainingProgramParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid program ID',
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

      const queryResult = validateQuery(TrainingSessionListQuerySchema, request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }
      const page = queryResult.data.page ?? 1;
      const pageSize = queryResult.data.pageSize ?? 20;

      const result = await trainingService.listSessions(tenantId, paramsResult.data.programId, {
        page,
        pageSize,
      });
      return reply.status(200).send({
        data: result.data.map(formatSessionResponse),
        meta: result.meta,
      });
    },
  );

  // ─── Training Attendance ─────────────────────────────────────────────

  /**
   * POST /staff/training/attendance
   */
  fastify.post(
    `${prefix}/attendance`,
    async function recordAttendanceHandler(
      request: FastifyRequest<{ Body: RecordTrainingAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecordTrainingAttendanceSchema, request.body);
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
        const attendance = await trainingService.recordAttendance(tenantId, result.data);
        return reply.status(201).send(formatAttendanceResponse(attendance));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * GET /staff/training/sessions/:sessionId/attendance
   */
  fastify.get(
    `${prefix}/sessions/:sessionId/attendance`,
    async function getSessionAttendanceHandler(
      request: FastifyRequest<{ Params: TrainingSessionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(TrainingSessionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid session ID',
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

      const records = await trainingService.getSessionAttendance(
        tenantId,
        paramsResult.data.sessionId,
      );
      return reply.status(200).send({
        data: records.map(formatAttendanceResponse),
      });
    },
  );

  // ─── Certifications ──────────────────────────────────────────────────

  /**
   * POST /staff/training/certifications
   */
  fastify.post(
    `${prefix}/certifications`,
    async function issueCertificationHandler(
      request: FastifyRequest<{ Body: IssueCertificationInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(IssueCertificationSchema, request.body);
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
        const certification = await trainingService.issueCertification(tenantId, result.data);
        return reply.status(201).send(formatCertificationResponse(certification));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * GET /staff/training/certifications
   */
  fastify.get(
    `${prefix}/certifications`,
    async function listCertificationsHandler(
      request: FastifyRequest<{ Querystring: CertificationListQuery }>,
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

      const queryResult = validateQuery(CertificationListQuerySchema, request.query);
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }
      const query = queryResult.data;
      const page = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;

      const result = await trainingService.listCertifications(
        tenantId,
        {
          staffId: query.staffId,
          status: query.status,
          programId: query.programId,
        },
        { page, pageSize },
      );
      return reply.status(200).send({
        data: result.data.map(formatCertificationResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /staff/training/certifications/:certificationId
   */
  fastify.get(
    `${prefix}/certifications/:certificationId`,
    async function getCertificationHandler(
      request: FastifyRequest<{ Params: CertificationParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CertificationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid certification ID',
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
        const cert = await trainingService.getCertification(
          tenantId,
          paramsResult.data.certificationId,
        );
        return reply.status(200).send(formatCertificationResponse(cert));
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );

  /**
   * POST /staff/training/certifications/process-expiry
   * Process expired certifications and trigger notifications.
   * Requirement 7.8: Update status to expired and trigger notification.
   */
  fastify.post(
    `${prefix}/certifications/process-expiry`,
    async function processExpiryHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const body = request.body as { asOfDate?: unknown } | undefined;
      const asOfDate = body?.asOfDate;
      if (asOfDate !== undefined && typeof asOfDate !== 'string') {
        const err = new ValidationError('Validation failed', [
          { field: 'asOfDate', message: 'asOfDate must be a date string', rule: 'type' },
        ]);
        return reply.status(err.statusCode).send(err.toJSON());
      }

      try {
        const expiredCerts = await trainingService.processExpiredCertifications(tenantId, asOfDate);
        return reply.status(200).send({
          processedCount: expiredCerts.length,
          certifications: expiredCerts.map(formatCertificationResponse),
        });
      } catch (error: unknown) {
        const mapped = toTrainingAppError(error);
        if (mapped) return reply.status(mapped.statusCode).send(mapped.toJSON());
        throw error;
      }
    },
  );
}
