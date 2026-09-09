/**
 * Curriculum Fastify routes (G-923). Prefix default: `/curriculum`
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return (
    user?.tenantId ??
    (request as FastifyRequest & { tenantId?: string }).tenantId ??
    ((request.headers['x-tenant-id'] as string | undefined) || null)
  );
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

export async function registerCurriculumRoutes(
  fastify: FastifyInstance,
  options: CurriculumRoutesOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/curriculum';
  const { service } = options;

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
