/**
 * Curriculum Fastify routes (G-923). Prefix default: `/curriculum`
 */
import { AppError, assertInstitutionInScope } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { enforceCurriculumRouteAccess } from './curriculum-http-guard.js';
import {
  CreateLearningOutcomeSchema,
  CreateLessonPlanSchema,
  CreateSyllabusUnitSchema,
  MarkTaughtSchema,
} from './schemas.js';
import type { CurriculumService } from './service.js';

export interface CurriculumRoutesOptions {
  service: CurriculumService;
  prefix?: string;
}

function tenantOf(request: FastifyRequest): string | null {
  // SEC-2: `x-tenant-id` is a client-supplied header and must never be trusted as a
  // tenant source. The gateway overwrites it with the JWT-verified tenant before
  // proxying (see apps/api-gateway/src/plugins/service-router.ts), but this package
  // has no standalone boot path, so there is no legitimate case where tenant identity
  // should fall back to it. Resolve strictly from server-verified sources.
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId ?? (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function actorId(request: FastifyRequest): string | null {
  const user = (request as FastifyRequest & { user?: { id?: string; sub?: string } }).user;
  return user?.id ?? user?.sub ?? null;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

/**
 * PRC-H022: lesson-plan writes addressed by `:id` must name the owning institution
 * (`?institutionId=`, authorized by the gateway institution-scope hook) and the plan's syllabus
 * unit must belong to it. Missing → 400; foreign, tenant-wide or unknown plan → 404 so another
 * school's ownership is not disclosed. Returns false when a reply has been sent.
 */
async function assertLessonPlanInInstitution(
  service: CurriculumService,
  tenantId: string,
  id: string,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const institutionId = (request.query as { institutionId?: unknown } | undefined)?.institutionId;
  if (typeof institutionId !== 'string' || institutionId.length === 0) {
    reply.status(400).send({
      code: 'INSTITUTION_REQUIRED',
      message: 'institutionId query parameter is required',
      statusCode: 400,
    });
    return false;
  }
  const owner = await service.lessonPlanInstitution(tenantId, id);
  if (!owner || owner.institutionId !== institutionId) {
    reply.status(404).send({
      code: 'NOT_FOUND',
      message: `Lesson plan ${id} not found`,
      statusCode: 404,
    });
    return false;
  }
  return true;
}

export async function registerCurriculumRoutes(
  fastify: FastifyInstance,
  options: CurriculumRoutesOptions,
): Promise<void> {
  // W1-SEC-02: package-level RBAC (clears deferred curriculum inventory residual).
  fastify.addHook('preHandler', async (request, reply) => {
    if (!enforceCurriculumRouteAccess(request, reply)) {
      return reply;
    }
  });

  const prefix = options.prefix ?? '/curriculum';
  const { service } = options;
  // PRC-H004: `/units/:id…` and `/lesson-plans/:id` address records only by id, so the gateway
  // scope hook cannot see their school. 404 a school-bound caller when the owning unit belongs to
  // another school (tenant-wide units with no institution stay visible).
  const unitRoute = `${fastify.prefix}${prefix}/units/:id`;
  const planRoute = `${fastify.prefix}${prefix}/lesson-plans/:id`;
  fastify.addHook('preHandler', async (request, reply) => {
    const routeUrl = request.routeOptions.url ?? '';
    const isUnit = routeUrl === unitRoute || routeUrl.startsWith(`${unitRoute}/`);
    if (!isUnit && routeUrl !== planRoute) return;
    const tenantId = tenantOf(request);
    const id = (request.params as { id?: unknown }).id;
    if (!tenantId || typeof id !== 'string') return;
    let owner: string | null | undefined;
    if (isUnit) {
      try {
        owner = (await service.getUnit(tenantId, id)).institutionId;
      } catch (error) {
        if (error instanceof AppError) return; // handler answers its own 404
        throw error;
      }
    } else {
      const found = await service.lessonPlanInstitution(tenantId, id);
      if (!found) return;
      owner = found.institutionId;
    }
    if (!owner) return;
    try {
      const user = (request as FastifyRequest & { user?: unknown }).user as
        Parameters<typeof assertInstitutionInScope>[0] | undefined;
      assertInstitutionInScope(user, owner, `Curriculum record ${id} not found`);
    } catch (error) {
      if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
      throw error;
    }
  });

  fastify.post(`${prefix}/units`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const body = validate(CreateSyllabusUnitSchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid syllabus unit',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const row = await service.createUnit(tenantId, body.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/units`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const query = request.query as {
      institutionId?: string;
      subjectId?: string;
      gradeId?: string;
      academicPeriodId?: string;
    };
    try {
      const rows = await service.listUnits(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/units/:id/lesson-plans`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    const body = validate(CreateLessonPlanSchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid lesson plan',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const row = await service.createLessonPlan(tenantId, id, body.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/units/:id/lesson-plans`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    try {
      const rows = await service.listLessonPlans(tenantId, id);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/lesson-plans`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const query = request.query as { unitIds?: string };
    const unitIds = (query.unitIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    try {
      const rows = await service.listLessonPlansForUnits(tenantId, unitIds);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.patch(`${prefix}/lesson-plans/:id`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    if (!(await assertLessonPlanInInstitution(service, tenantId, id, request, reply))) return;
    const body = request.body as {
      title?: string;
      objectives?: string | null;
      plannedDate?: string | null;
    };
    try {
      const row = await service.updateLessonPlan(tenantId, id, body ?? {});
      return reply.send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(`${prefix}/lesson-plans/:id`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    try {
      if (!(await assertLessonPlanInInstitution(service, tenantId, id, request, reply))) return;
      await service.deleteLessonPlan(tenantId, id);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/units/:id/mark-taught`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    const body = validate(MarkTaughtSchema, request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid mark-taught payload',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const row = await service.markTaught(tenantId, id, body.data, actorId(request));
      return reply.send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(`${prefix}/units/:id/coverage`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    try {
      await service.unmarkTaught(tenantId, id);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/outcomes`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const body = validate(CreateLearningOutcomeSchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid learning outcome',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const row = await service.createOutcome(tenantId, body.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/outcomes`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const query = request.query as { subjectId?: string; unitId?: string; gradeId?: string };
    try {
      const rows = await service.listOutcomes(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.patch(`${prefix}/outcomes/:id`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    const body = request.body as {
      code?: string;
      statement?: string;
      unitId?: string | null;
      gradeId?: string | null;
    };
    try {
      const row = await service.updateOutcome(tenantId, id, body ?? {});
      return reply.send(row);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.delete(`${prefix}/outcomes/:id`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const { id } = request.params as { id: string };
    try {
      await service.deleteOutcome(tenantId, id);
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/coverage`, async (request, reply) => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      return reply.status(401).send({
        code: 'UNAUTHORIZED',
        message: 'Tenant context required',
        statusCode: 401,
      });
    }
    const query = request.query as {
      subjectId?: string;
      gradeId?: string;
      academicPeriodId?: string;
      institutionId?: string;
    };
    if (!query.subjectId || !query.gradeId || !query.academicPeriodId) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'subjectId, gradeId and academicPeriodId are required',
        statusCode: 400,
      });
    }
    try {
      const summary = await service.coverage(tenantId, {
        subjectId: query.subjectId,
        gradeId: query.gradeId,
        academicPeriodId: query.academicPeriodId,
        institutionId: query.institutionId,
      });
      return reply.send(summary);
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
