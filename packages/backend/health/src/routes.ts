/**
 * Health Routes
 *
 * Registers all health-related Fastify routes:
 * - POST/GET/PUT/DELETE /health/measurements
 * - POST/GET/PUT/DELETE /health/allergies
 * - POST/GET/PUT/DELETE /health/conditions
 * - POST/GET/PUT/DELETE /health/vaccinations
 * - POST/GET/PUT/DELETE /health/insurance
 * - POST/GET /health/special-needs/assessments
 * - POST/GET /health/special-needs/diagnoses
 * - POST/GET/PUT /health/special-needs/referrals
 * - POST/GET/PUT /health/special-needs/accommodation-plans
 * - POST/GET/PUT /health/counselling/sessions
 * - POST/GET/PUT /health/screening-programs
 *
 * Requirements:
 * - 12.1: Health data CRUD
 * - 12.2: Special needs management
 * - 12.3: Counselling session management
 * - 12.4: Access control
 * - 12.5: Screening programs
 */
import { appendAuditEntryOnClient, toCreateAuditLogInput } from '@proctira/backend-audit';
import { AppError } from '@proctira/common';
import type { PgQueryable } from '@proctira/database';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { HealthService, HealthAccessContext } from './health-service.js';
import { isPgPhiEnabled } from './pg-phi-store.js';
import {
  CreateMeasurementSchema,
  UpdateMeasurementSchema,
  CreateAllergySchema,
  UpdateAllergySchema,
  CreateConditionSchema,
  UpdateConditionSchema,
  CreateVaccinationSchema,
  UpdateVaccinationSchema,
  CreateNurseIncidentSchema,
  CreateInsuranceSchema,
  UpdateInsuranceSchema,
  CreateSpecialNeedsAssessmentSchema,
  CreateDiagnosisSchema,
  CreateReferralSchema,
  UpdateReferralSchema,
  CreateAccommodationPlanSchema,
  UpdateAccommodationPlanSchema,
  CreateCounsellingSessionSchema,
  UpdateCounsellingSessionSchema,
  CreateHealthBreakGlassRequestSchema,
  CreateScreeningProgramSchema,
  UpdateScreeningProgramSchema,
  UuidParamsSchema,
  StudentParamsSchema,
} from './schemas.js';

export interface HealthRoutesOptions {
  healthService: HealthService;
  prefix?: string;
}

/**
 * Extracts tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Extracts health access context from request.
 * In production, this would come from the authenticated user's JWT claims.
 */
function getAccessContext(request: FastifyRequest): HealthAccessContext {
  const user = (request as FastifyRequest & { healthAccessContext?: HealthAccessContext })
    .healthAccessContext;
  if (user) return user;
  // Default: no access (will be overridden by auth middleware in production)
  return { userId: '', roles: [], guardianOfStudentIds: [] };
}

/** Same Symbol.for key as api-gateway mutation-audit (W1-SEC-10 COMPLETE). */
const MUTATION_AUDIT_COMMITTED = Symbol.for('proctira.mutationAuditCommitted');

function markRegulatedMutationAuditCommitted(request: FastifyRequest): void {
  (request as FastifyRequest & { [MUTATION_AUDIT_COMMITTED]?: boolean })[MUTATION_AUDIT_COMMITTED] =
    true;
}

function buildPhiWriteAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  opts: {
    path: string;
    regulated: string;
    idField: string;
    /**
     * W1-SEC: defaults to 'CREATE' so every pre-existing call site (which
     * never passed this) keeps recording exactly what it always recorded.
     * Update/delete call sites pass 'UPDATE'/'DELETE' explicitly below.
     */
    operation?: 'CREATE' | 'UPDATE' | 'DELETE';
  },
) {
  if (!isPgPhiEnabled()) return undefined;
  const access = getAccessContext(request);
  const user = (
    request as FastifyRequest & { user?: { sub?: string; displayName?: string; email?: string } }
  ).user;
  return {
    appendAuditInTxn: async (client: PgQueryable, entity: { id: string }) => {
      await appendAuditEntryOnClient(
        client,
        toCreateAuditLogInput({
          tenantId,
          entityType: 'health_record',
          entityId: entity.id,
          operation: opts.operation ?? 'CREATE',
          userId: user?.sub ?? access.userId ?? 'anonymous',
          userName: user?.displayName ?? user?.email ?? user?.sub ?? access.userId ?? 'anonymous',
          ipAddress: request.ip,
          beforeValues: null,
          afterValues: {
            path: opts.path,
            [opts.idField]: entity.id,
          },
          metadata: {
            method: request.method,
            path: request.url.split('?')[0] ?? request.url,
            regulated: opts.regulated,
            atomic: true,
          },
        }),
      );
      markRegulatedMutationAuditCommitted(request);
    },
  };
}

function buildMeasurementAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/measurements',
    regulated: 'health.measurement',
    idField: 'measurementId',
    operation,
  });
}

function buildAllergyAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/allergies',
    regulated: 'health.allergy',
    idField: 'allergyId',
    operation,
  });
}

function buildConditionAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/conditions',
    regulated: 'health.condition',
    idField: 'conditionId',
    operation,
  });
}

function buildVaccinationAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/vaccinations',
    regulated: 'health.vaccination',
    idField: 'vaccinationId',
    operation,
  });
}

function buildInsuranceAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/insurance',
    regulated: 'health.insurance',
    idField: 'insuranceId',
    operation,
  });
}

function buildScreeningProgramAuditBinder(
  request: FastifyRequest,
  tenantId: string,
  operation?: 'CREATE' | 'UPDATE' | 'DELETE',
) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/screening-programs',
    regulated: 'health.screening_program',
    idField: 'screeningProgramId',
    operation,
  });
}

function buildNurseIncidentAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/incidents',
    regulated: 'health.nurse_incident',
    idField: 'incidentId',
  });
}

function buildCounsellingSessionAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/counselling/sessions',
    regulated: 'health.counselling_session',
    idField: 'counsellingSessionId',
  });
}

function buildAssessmentAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/special-needs/assessments',
    regulated: 'health.special_needs_assessment',
    idField: 'assessmentId',
  });
}

function buildDiagnosisAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/special-needs/diagnoses',
    regulated: 'health.diagnosis',
    idField: 'diagnosisId',
  });
}

function buildReferralAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/special-needs/referrals',
    regulated: 'health.referral',
    idField: 'referralId',
  });
}

function buildAccommodationPlanAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/special-needs/accommodation-plans',
    regulated: 'health.accommodation_plan',
    idField: 'accommodationPlanId',
  });
}

function buildBreakGlassAuditBinder(request: FastifyRequest, tenantId: string) {
  return buildPhiWriteAuditBinder(request, tenantId, {
    path: '/api/v1/health/break-glass',
    regulated: 'health.break_glass',
    idField: 'breakGlassId',
  });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

/**
 * Register all health routes on a Fastify instance.
 */
export async function registerHealthRoutes(
  fastify: FastifyInstance,
  options: HealthRoutesOptions,
): Promise<void> {
  const { healthService, prefix = '/health' } = options;

  // ─── Measurements ─────────────────────────────────────────────────────

  fastify.post(`${prefix}/measurements`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateMeasurementSchema, request.body);
    if (!result.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    }
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.createMeasurement(
        tenantId,
        result.data,
        getAccessContext(request),
        buildMeasurementAuditBinder(request, tenantId),
      );
      return reply.status(201).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/measurements/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listMeasurements(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/measurements/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateMeasurementSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateMeasurement(
          tenantId,
          params.data.id,
          body.data,
          getAccessContext(request),
          buildMeasurementAuditBinder(request, tenantId, 'UPDATE'),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/measurements/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteMeasurement(
          tenantId,
          params.data.id,
          getAccessContext(request),
          buildMeasurementAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Allergies ────────────────────────────────────────────────────────

  fastify.post(`${prefix}/allergies`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateAllergySchema, request.body);
    if (!result.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.createAllergy(
        tenantId,
        result.data,
        getAccessContext(request),
        buildAllergyAuditBinder(request, tenantId),
      );
      return reply.status(201).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/allergies/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listAllergies(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(`${prefix}/allergies/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = validate(UuidParamsSchema, request.params);
    if (!params.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid ID',
        statusCode: 400,
        errors: params.errors,
      });
    const body = validate(UpdateAllergySchema, request.body);
    if (!body.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: body.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.updateAllergy(
        tenantId,
        params.data.id,
        body.data,
        getAccessContext(request),
        buildAllergyAuditBinder(request, tenantId, 'UPDATE'),
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(
    `${prefix}/allergies/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteAllergy(
          tenantId,
          params.data.id,
          getAccessContext(request),
          buildAllergyAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Conditions ───────────────────────────────────────────────────────

  fastify.post(`${prefix}/conditions`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateConditionSchema, request.body);
    if (!result.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.createCondition(
        tenantId,
        result.data,
        getAccessContext(request),
        buildConditionAuditBinder(request, tenantId),
      );
      return reply.status(201).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/conditions/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listConditions(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(`${prefix}/conditions/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = validate(UuidParamsSchema, request.params);
    if (!params.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid ID',
        statusCode: 400,
        errors: params.errors,
      });
    const body = validate(UpdateConditionSchema, request.body);
    if (!body.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: body.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.updateCondition(
        tenantId,
        params.data.id,
        body.data,
        getAccessContext(request),
        buildConditionAuditBinder(request, tenantId, 'UPDATE'),
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(
    `${prefix}/conditions/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteCondition(
          tenantId,
          params.data.id,
          getAccessContext(request),
          buildConditionAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Vaccinations ─────────────────────────────────────────────────────

  fastify.post(`${prefix}/vaccinations`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateVaccinationSchema, request.body);
    if (!result.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.createVaccination(
        tenantId,
        result.data,
        getAccessContext(request),
        buildVaccinationAuditBinder(request, tenantId),
      );
      return reply.status(201).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/vaccinations`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const data = await healthService.listAllVaccinations(tenantId, getAccessContext(request));
      return reply.status(200).send({ data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/vaccinations/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listVaccinations(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/vaccinations/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateVaccinationSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateVaccination(
          tenantId,
          params.data.id,
          body.data,
          getAccessContext(request),
          buildVaccinationAuditBinder(request, tenantId, 'UPDATE'),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/vaccinations/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteVaccination(
          tenantId,
          params.data.id,
          getAccessContext(request),
          buildVaccinationAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Insurance ────────────────────────────────────────────────────────

  fastify.post(`${prefix}/insurance`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateInsuranceSchema, request.body);
    if (!result.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.createInsurance(
        tenantId,
        result.data,
        getAccessContext(request),
        buildInsuranceAuditBinder(request, tenantId),
      );
      return reply.status(201).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/insurance/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listInsurance(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(`${prefix}/insurance/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = validate(UuidParamsSchema, request.params);
    if (!params.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid ID',
        statusCode: 400,
        errors: params.errors,
      });
    const body = validate(UpdateInsuranceSchema, request.body);
    if (!body.success)
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: body.errors,
      });
    const tenantId = getTenantId(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      const entity = await healthService.updateInsurance(
        tenantId,
        params.data.id,
        body.data,
        getAccessContext(request),
        buildInsuranceAuditBinder(request, tenantId, 'UPDATE'),
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(
    `${prefix}/insurance/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteInsurance(
          tenantId,
          params.data.id,
          getAccessContext(request),
          buildInsuranceAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Special Needs Assessments ────────────────────────────────────────

  fastify.post(
    `${prefix}/special-needs/assessments`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateSpecialNeedsAssessmentSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createAssessment(
          tenantId,
          result.data,
          getAccessContext(request),
          buildAssessmentAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/special-needs/assessments/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listAssessments(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Diagnoses ────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/special-needs/diagnoses`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateDiagnosisSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createDiagnosis(
          tenantId,
          result.data,
          getAccessContext(request),
          buildDiagnosisAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/special-needs/diagnoses/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listDiagnoses(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Referrals ────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/special-needs/referrals`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateReferralSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createReferral(
          tenantId,
          result.data,
          getAccessContext(request),
          buildReferralAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/special-needs/referrals/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listReferrals(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/special-needs/referrals/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateReferralSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateReferral(
          tenantId,
          params.data.id,
          body.data,
          getAccessContext(request),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Accommodation Plans ──────────────────────────────────────────────

  fastify.post(
    `${prefix}/special-needs/accommodation-plans`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateAccommodationPlanSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createAccommodationPlan(
          tenantId,
          result.data,
          getAccessContext(request),
          buildAccommodationPlanAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/special-needs/accommodation-plans/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listAccommodationPlans(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/special-needs/accommodation-plans/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateAccommodationPlanSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateAccommodationPlan(
          tenantId,
          params.data.id,
          body.data,
          getAccessContext(request),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Counselling Sessions ─────────────────────────────────────────────

  fastify.post(
    `${prefix}/counselling/sessions`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateCounsellingSessionSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createCounsellingSession(
          tenantId,
          result.data,
          getAccessContext(request),
          buildCounsellingSessionAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/counselling/sessions/student/:studentId`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string };
      try {
        const result = await healthService.listCounsellingSessions(
          tenantId,
          params.data.studentId,
          { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 },
          getAccessContext(request),
        );
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/counselling/sessions/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateCounsellingSessionSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateCounsellingSession(
          tenantId,
          params.data.id,
          body.data,
          getAccessContext(request),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Screening Programs ───────────────────────────────────────────────

  fastify.post(
    `${prefix}/screening-programs`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const result = validate(CreateScreeningProgramSchema, request.body);
      if (!result.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.createScreeningProgram(
          tenantId,
          result.data,
          buildScreeningProgramAuditBinder(request, tenantId),
        );
        return reply.status(201).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/screening-programs`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const query = request.query as { page?: string; pageSize?: string; gradeLevel?: string };
      const pagination = { page: Number(query.page) || 1, pageSize: Number(query.pageSize) || 20 };
      try {
        const result = query.gradeLevel
          ? await healthService.listScreeningProgramsByGrade(tenantId, query.gradeLevel, pagination)
          : await healthService.listScreeningPrograms(tenantId, pagination);
        return reply.status(200).send(result);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/screening-programs/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.getScreeningProgram(tenantId, params.data.id);
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/screening-programs/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const body = validate(UpdateScreeningProgramSchema, request.body);
      if (!body.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: body.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        const entity = await healthService.updateScreeningProgram(
          tenantId,
          params.data.id,
          body.data,
          buildScreeningProgramAuditBinder(request, tenantId, 'UPDATE'),
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  /** W1-SEC: screening programs had no delete route anywhere in this API. */
  fastify.delete(
    `${prefix}/screening-programs/:id`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success)
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
        });
      const tenantId = getTenantId(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      try {
        await healthService.deleteScreeningProgram(
          tenantId,
          params.data.id,
          buildScreeningProgramAuditBinder(request, tenantId, 'DELETE'),
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // G-734 — DSAR export of student PHI package
  fastify.get(`${prefix}/dsar/:studentId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = validate(StudentParamsSchema, {
      studentId: (request.params as { studentId?: string }).studentId,
    });
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: params.errors,
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
      const pack = await healthService.exportStudentDsarPackage(
        tenantId,
        params.data.studentId,
        getAccessContext(request),
      );
      return reply.status(200).send(pack);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── PHI access log viewer (Wave 10 Option B) ───────────────────────────

  fastify.get(`${prefix}/phi-access`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const query = request.query as { studentId?: string; limit?: string };
    try {
      const data = await healthService.listPhiAccessLogs(tenantId, getAccessContext(request), {
        studentId: query.studentId,
        limit: query.limit ? Number(query.limit) : 100,
      });
      return reply.status(200).send({ data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Health PHI break-glass (P0-09) — field dual-control, not platform-admin ─

  fastify.post(`${prefix}/break-glass`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateHealthBreakGlassRequestSchema, request.body);
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
      const grant = await healthService.requestBreakGlass(
        tenantId,
        result.data,
        getAccessContext(request),
        buildBreakGlassAuditBinder(request, tenantId),
      );
      return reply.status(201).send(grant);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/break-glass`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    const query = request.query as { studentId?: string; limit?: string };
    try {
      const data = await healthService.listBreakGlassGrants(tenantId, getAccessContext(request), {
        studentId: query.studentId,
        limit: query.limit ? Number(query.limit) : 100,
      });
      return reply.status(200).send({ data });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(
    `${prefix}/break-glass/:id/approve`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
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
        const grant = await healthService.approveBreakGlass(
          tenantId,
          params.data.id,
          getAccessContext(request),
        );
        return reply.status(200).send(grant);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/break-glass/:id/deny`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const params = validate(UuidParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: params.errors,
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
        const grant = await healthService.denyBreakGlass(
          tenantId,
          params.data.id,
          getAccessContext(request),
        );
        return reply.status(200).send(grant);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // ─── Nurse incidents (Wave 10 Option B) ─────────────────────────────────

  fastify.post(`${prefix}/incidents`, async (request: FastifyRequest, reply: FastifyReply) => {
    const result = validate(CreateNurseIncidentSchema, request.body);
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
      const entity = await healthService.createNurseIncident(
        tenantId,
        {
          ...result.data,
          severity: result.data.severity as 'low' | 'medium' | 'high' | 'critical',
        },
        getAccessContext(request),
        buildNurseIncidentAuditBinder(request, tenantId),
      );
      return reply.status(201).send({
        ...entity,
        incidentAt: entity.incidentAt.toISOString(),
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString(),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/incidents`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }
    try {
      const rows = await healthService.listNurseIncidents(tenantId, getAccessContext(request));
      return reply.status(200).send({
        data: rows.map((entity) => ({
          ...entity,
          incidentAt: entity.incidentAt.toISOString(),
          createdAt: entity.createdAt.toISOString(),
          updatedAt: entity.updatedAt.toISOString(),
        })),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
