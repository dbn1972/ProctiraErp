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
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { HealthService, HealthAccessContext } from './health-service.js';
import {
  CreateMeasurementSchema,
  UpdateMeasurementSchema,
  CreateAllergySchema,
  UpdateAllergySchema,
  CreateConditionSchema,
  UpdateConditionSchema,
  CreateVaccinationSchema,
  UpdateVaccinationSchema,
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
        await healthService.deleteMeasurement(tenantId, params.data.id, getAccessContext(request));
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
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

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
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

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
      );
      return reply.status(201).send(entity);
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
        );
        return reply.status(200).send(entity);
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
      );
      return reply.status(200).send(entity);
    } catch (error) {
      return sendError(reply, error);
    }
  });

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
        const entity = await healthService.createScreeningProgram(tenantId, result.data);
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
        );
        return reply.status(200).send(entity);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
