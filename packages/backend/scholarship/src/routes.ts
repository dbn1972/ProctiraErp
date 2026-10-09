/**
 * Scholarship Routes
 *
 * Programs:
 *   POST   /scholarships/programs           - Create a scholarship program
 *   PUT    /scholarships/programs/:id       - Update a scholarship program
 *   GET    /scholarships/programs           - List scholarship programs
 *   GET    /scholarships/programs/:id       - Get a scholarship program
 *   DELETE /scholarships/programs/:id       - Delete a scholarship program
 *
 * Applications:
 *   POST   /scholarships/applications       - Submit an application
 *   GET    /scholarships/applications       - List applications
 *   GET    /scholarships/applications/:id   - Get an application
 *   POST   /scholarships/applications/:id/approve - Approve an application
 *   POST   /scholarships/applications/:id/reject  - Reject an application
 *
 * Disbursements:
 *   POST   /scholarships/disbursements      - Create a disbursement
 *   PUT    /scholarships/disbursements/:id  - Update disbursement status
 *   GET    /scholarships/disbursements      - List disbursements
 *   GET    /scholarships/applications/:id/disbursements - List disbursements for application
 *
 * Compliance:
 *   POST   /scholarships/compliance         - Record compliance
 *   GET    /scholarships/applications/:id/compliance - Get compliance records
 *
 * Reports:
 *   GET    /scholarships/reports/utilization - Get utilization report
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  deriveApplicantAttributes,
  resolveApplicationSubject,
  resolveScholarshipActor,
  type ApplicantAttributesLookup,
  type ApplicantStudentLookup,
} from './application-intake.js';
import { authorizeApplicationCreate } from './document-routes.js';
import { applicantAttributesForStudent } from './parent-links.js';
import {
  CreateScholarshipProgramSchema,
  UpdateScholarshipProgramSchema,
  CreateApplicationRequestSchema,
  CreateDisbursementSchema,
  UpdateDisbursementSchema,
  RecipientComplianceSchema,
  ScholarshipParamsSchema,
  ApplicationDecisionSchema,
  type ApplicationDecisionInput,
  type CreateScholarshipProgramInput,
  type UpdateScholarshipProgramInput,
  type CreateApplicationRequest,
  type CreateDisbursementInput,
  type UpdateDisbursementInput,
  type RecipientComplianceInput,
  type UtilizationReportQuery,
  type ScholarshipListQuery,
  ScholarshipListQuerySchema,
  type ScholarshipParams,
} from './schemas.js';
import { requireScholarshipAction } from './scholarship-http-guard.js';
import type { ApplicationStatus, PaymentStatus, ProgramStatus } from './scholarship-repository.js';
import type { ScholarshipService } from './scholarship-service.js';

const PROGRAM_STATUSES = ['draft', 'open', 'closed', 'archived'] as const;
const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'under_review',
  'approved',
  'rejected',
  'withdrawn',
] as const;
const PAYMENT_STATUSES = ['scheduled', 'processing', 'paid', 'failed', 'cancelled'] as const;

function programStatus(value: string | undefined): ProgramStatus | undefined {
  return PROGRAM_STATUSES.find((status) => status === value);
}

function applicationStatus(value: string | undefined): ApplicationStatus | undefined {
  return APPLICATION_STATUSES.find((status) => status === value);
}

/**
 * PRC-M114: `status` may be one status or a comma list (e.g. `submitted,under_review`);
 * unknown values are dropped, so an all-unknown list filters nothing out.
 */
function applicationStatusFilter(value: string | undefined): {
  status?: ApplicationStatus;
  statuses?: ApplicationStatus[];
} {
  if (!value) return {};
  const parts = value
    .split(',')
    .map((part) => applicationStatus(part.trim()))
    .filter((s): s is ApplicationStatus => s !== undefined);
  if (parts.length === 0) return {};
  return parts.length === 1 ? { status: parts[0] } : { statuses: [...new Set(parts)] };
}

function disbursementStatus(value: string | undefined): PaymentStatus | undefined {
  return PAYMENT_STATUSES.find((status) => status === value);
}

/**
 * Options for registering scholarship routes.
 */
export interface ScholarshipRoutesOptions {
  scholarshipService: ScholarshipService;
  /** Route prefix (default: '/scholarships') */
  prefix?: string;
  /** Active parent_child_links for the caller, when Postgres is available. */
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
  /** PRC-H030: when set, an application's applicant must be a student of the tenant. */
  applicantExists?: ApplicantStudentLookup;
  /**
   * PRC-L345: student-record lookup for areaId/gender. Defaults to the Postgres record (null
   * without a database, in which case client-supplied values are dropped).
   */
  resolveApplicantAttributes?: ApplicantAttributesLookup;
}

/**
 * Helper to extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Reviewer identity for approve / reject — the JWT subject, never the body.
 */
function getActorId(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
  return user?.sub ?? user?.userId ?? null;
}

/**
 * Format date fields for response.
 */
function formatDate(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Register scholarship routes on a Fastify instance.
 */
export async function registerScholarshipRoutes(
  fastify: FastifyInstance,
  options: ScholarshipRoutesOptions,
): Promise<void> {
  const {
    scholarshipService,
    prefix = '/scholarships',
    resolveLinkedStudentIds,
    applicantExists,
    resolveApplicantAttributes = applicantAttributesForStudent,
  } = options;

  // ─── Program Routes ────────────────────────────────────────────────────

  /**
   * POST /scholarships/programs - Create a scholarship program
   */
  fastify.post(
    `${prefix}/programs`,
    async function createProgramHandler(
      request: FastifyRequest<{ Body: CreateScholarshipProgramInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'program.write')) return;

      const result = validate(CreateScholarshipProgramSchema, request.body);
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
        const program = await scholarshipService.createProgram(tenantId, result.data);
        return reply.status(201).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
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
   * PUT /scholarships/programs/:id - Update a scholarship program
   */
  fastify.put(
    `${prefix}/programs/:id`,
    async function updateProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body: UpdateScholarshipProgramInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'program.write')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateScholarshipProgramSchema, request.body);
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
        const program = await scholarshipService.updateProgram(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
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
   * GET /scholarships/programs - List scholarship programs
   */
  fastify.get(
    `${prefix}/programs`,
    async function listProgramsHandler(
      request: FastifyRequest<{ Querystring: ScholarshipListQuery }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query;
      // PRC-M351: validate pagination/sort against the schema so an unbounded
      // pageSize cannot dump every program/application (incl. financial_info)
      // and a negative page cannot reach the repository and 500.
      const queryResult = validate(ScholarshipListQuerySchema, query, { convert: true });
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid list query',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }
      const page = queryResult.data.page ?? 1;
      const pageSize = queryResult.data.pageSize ?? 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await scholarshipService.listPrograms(
        tenantId,
        { status: programStatus(query.status), search: query.search },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/programs/:id - Get a scholarship program
   */
  fastify.get(
    `${prefix}/programs/:id`,
    async function getProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const program = await scholarshipService.getProgramById(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
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
   * DELETE /scholarships/programs/:id - Delete a scholarship program
   */
  fastify.delete(
    `${prefix}/programs/:id`,
    async function deleteProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'program.write')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        await scholarshipService.deleteProgram(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Application Routes ────────────────────────────────────────────────

  /**
   * POST /scholarships/applications - Submit an application
   */
  fastify.post(
    `${prefix}/applications`,
    async function submitApplicationHandler(
      request: FastifyRequest<{ Body: CreateApplicationRequest }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateApplicationRequestSchema, request.body);
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

      // PRC-H030: resolve who the application is for server-side; never trust placeholders.
      let subject: { applicantId: string; institutionId: string };
      let attributes: { areaId?: string; gender?: 'male' | 'female' | 'other' };
      try {
        subject = await resolveApplicationSubject({
          request,
          tenantId,
          actor: await resolveScholarshipActor(request, tenantId, resolveLinkedStudentIds),
          applicantId: result.data.applicantId,
          institutionId: result.data.institutionId,
          applicantExists,
        });
        // PRC-L345: areaId/gender from the student record; contradictions are a 422.
        attributes = await deriveApplicantAttributes({
          tenantId,
          applicantId: subject.applicantId,
          claimed: { areaId: result.data.areaId, gender: result.data.gender },
          lookup: resolveApplicantAttributes,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }

      if (
        !(await authorizeApplicationCreate(
          request,
          reply,
          subject.applicantId,
          resolveLinkedStudentIds,
        ))
      ) {
        return;
      }

      try {
        const { areaId: _claimedArea, gender: _claimedGender, ...claimedRest } = result.data;
        void _claimedArea;
        void _claimedGender;
        const application = await scholarshipService.submitApplication(tenantId, {
          ...claimedRest,
          ...subject,
          ...attributes,
        });
        return reply.status(201).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
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
   * GET /scholarships/applications - List applications
   */
  fastify.get(
    `${prefix}/applications`,
    async function listApplicationsHandler(
      request: FastifyRequest<{
        Querystring: ScholarshipListQuery & {
          programId?: string;
          applicantId?: string;
          institutionId?: string;
          areaId?: string;
          gender?: string;
        };
      }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query;
      // PRC-M351: validate pagination/sort against the schema (see programs list).
      const queryResult = validate(ScholarshipListQuerySchema, query, { convert: true });
      if (!queryResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid list query',
          statusCode: 400,
          errors: queryResult.errors,
        });
      }
      const page = queryResult.data.page ?? 1;
      const pageSize = queryResult.data.pageSize ?? 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await scholarshipService.listApplications(
        tenantId,
        {
          programId: query.programId,
          applicantId: query.applicantId,
          institutionId: query.institutionId,
          ...applicationStatusFilter(query.status),
          areaId: query.areaId,
          gender: query.gender,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((a) => ({
          ...a,
          submittedAt: a.submittedAt.toISOString(),
          reviewedAt: formatDate(a.reviewedAt),
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/applications/:id - Get an application
   */
  fastify.get(
    `${prefix}/applications/:id`,
    async function getApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const application = await scholarshipService.getApplicationById(
          tenantId,
          paramsResult.data.id,
        );
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
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
   * POST /scholarships/applications/:id/approve - Approve an application
   */
  fastify.post(
    `${prefix}/applications/:id/approve`,
    async function approveApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body?: ApplicationDecisionInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'application.decide')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(ApplicationDecisionSchema, request.body ?? {});
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid decision payload',
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
        const application = await scholarshipService.approveApplication(
          tenantId,
          paramsResult.data.id,
          {
            reviewerId: getActorId(request),
            notes: bodyResult.data.comment ?? null,
            scheduleFirstDisbursement: bodyResult.data.scheduleFirstDisbursement ?? true,
          },
        );
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
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
   * POST /scholarships/applications/:id/reject - Reject an application
   */
  fastify.post(
    `${prefix}/applications/:id/reject`,
    async function rejectApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body?: ApplicationDecisionInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'application.decide')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(ApplicationDecisionSchema, request.body ?? {});
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid decision payload',
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
        const application = await scholarshipService.rejectApplication(
          tenantId,
          paramsResult.data.id,
          { reviewerId: getActorId(request), notes: bodyResult.data.comment ?? null },
        );
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Disbursement Routes ───────────────────────────────────────────────

  /**
   * POST /scholarships/disbursements - Create a disbursement
   */
  fastify.post(
    `${prefix}/disbursements`,
    async function createDisbursementHandler(
      request: FastifyRequest<{ Body: CreateDisbursementInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'disbursement.manage')) return;

      const result = validate(CreateDisbursementSchema, request.body);
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
        const disbursement = await scholarshipService.createDisbursement(tenantId, result.data);
        return reply.status(201).send({
          ...disbursement,
          createdAt: disbursement.createdAt.toISOString(),
          updatedAt: disbursement.updatedAt.toISOString(),
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
   * PRC-H084: GET /scholarships/fee-outbox — undelivered disbursement->fees rows (reconcile view).
   */
  fastify.get(`${prefix}/fee-outbox`, async function listFeeOutboxHandler(request, reply) {
    if (!requireScholarshipAction(request, reply, 'disbursement.manage')) return;
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const rows = await scholarshipService.listOpenFeeOutbox(tenantId);
    return reply.status(200).send({
      data: rows.map((r) => ({
        id: r.id,
        disbursementId: r.disbursementId,
        event: r.event,
        status: r.status,
        attempts: r.attempts,
        lastError: r.lastError,
        nextAttemptAt: r.nextAttemptAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
      })),
    });
  });
  /**
   * PRC-H084: POST /scholarships/fee-outbox/replay — requeue + redeliver (one id or all open).
   * Fee hooks are disbursementId-idempotent, so replay nets once.
   */
  fastify.post(
    `${prefix}/fee-outbox/replay`,
    async function replayFeeOutboxHandler(
      request: FastifyRequest<{ Body: { id?: unknown } | undefined }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'disbursement.manage')) return;
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const rawId = request.body?.id;
      if (rawId !== undefined && (typeof rawId !== 'string' || !/^[0-9a-f-]{36}$/i.test(rawId))) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'id must be a UUID',
          statusCode: 400,
        });
      }
      try {
        const result = await scholarshipService.replayFeeOutbox(tenantId, {
          id: rawId,
        });
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
  /**
   * PUT /scholarships/disbursements/:id - Update disbursement status
   */
  fastify.put(
    `${prefix}/disbursements/:id`,
    async function updateDisbursementHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body: UpdateDisbursementInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'disbursement.manage')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateDisbursementSchema, request.body);
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
        const disbursement = await scholarshipService.updateDisbursement(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          ...disbursement,
          createdAt: disbursement.createdAt.toISOString(),
          updatedAt: disbursement.updatedAt.toISOString(),
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
   * GET /scholarships/disbursements - List disbursements
   */
  fastify.get(
    `${prefix}/disbursements`,
    async function listDisbursementsHandler(
      request: FastifyRequest<{
        Querystring: ScholarshipListQuery & { applicationId?: string; paymentStatus?: string };
      }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const tenantId = getTenantId(request);
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
      const sortBy = query.sortBy ?? 'scheduledDate';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await scholarshipService.listDisbursements(
        tenantId,
        {
          applicationId: query.applicationId,
          paymentStatus: disbursementStatus(query.paymentStatus),
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/applications/:id/disbursements - List disbursements for an application
   */
  fastify.get(
    `${prefix}/applications/:id/disbursements`,
    async function listApplicationDisbursementsHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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

      const disbursements = await scholarshipService.listDisbursementsByApplication(
        tenantId,
        paramsResult.data.id,
      );

      return reply.status(200).send({
        data: disbursements.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    },
  );

  // ─── Compliance Routes ─────────────────────────────────────────────────

  /**
   * POST /scholarships/compliance - Record compliance
   */
  fastify.post(
    `${prefix}/compliance`,
    async function recordComplianceHandler(
      request: FastifyRequest<{ Body: RecipientComplianceInput }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'compliance.record')) return;

      const result = validate(RecipientComplianceSchema, request.body);
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
        const record = await scholarshipService.recordCompliance(
          tenantId,
          result.data,
          getActorId(request),
        );
        return reply.status(201).send({
          ...record,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
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
   * GET /scholarships/applications/:id/compliance - Get compliance records
   */
  fastify.get(
    `${prefix}/applications/:id/compliance`,
    async function getComplianceHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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

      const records = await scholarshipService.getComplianceRecords(tenantId, paramsResult.data.id);

      return reply.status(200).send({
        data: records.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      });
    },
  );

  // ─── Report Routes ─────────────────────────────────────────────────────

  /**
   * GET /scholarships/reports/utilization - Get utilization report
   */
  fastify.get(
    `${prefix}/reports/utilization`,
    async function utilizationReportHandler(
      request: FastifyRequest<{ Querystring: UtilizationReportQuery }>,
      reply: FastifyReply,
    ) {
      if (!requireScholarshipAction(request, reply, 'scholarship.read')) return;

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query;
      const report = await scholarshipService.getUtilizationReport(tenantId, query);

      return reply.status(200).send({
        ...report,
        generatedAt: new Date().toISOString(),
      });
    },
  );
}
