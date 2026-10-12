/**
 * Grade Routes
 *
 * POST   /grades       - Create a new grade
 * GET    /grades       - List all grades
 * GET    /grades/:id   - Get grade by ID
 * PUT    /grades/:id   - Update a grade
 * DELETE /grades/:id   - Soft-delete a grade
 */
import { AppError } from '@proctira/common';
import { Type, UuidSchema, validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { CreateGradeSchema, UpdateGradeSchema } from './grade-schemas.js';
import type { CreateGradeDto, UpdateGradeDto } from './grade-schemas.js';
import type { GradeService } from './grade-service.js';

export interface GradeRoutesOptions {
  service: GradeService;
  prefix?: string;
}

const IdParamsSchema = Type.Object({ id: UuidSchema });

function validationError(reply: FastifyReply, message: string, errors: unknown) {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    errors,
  });
}

function formatGradeResponse(grade: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: grade.id,
    tenantId: grade.tenantId,
    name: grade.name,
    code: grade.code,
    order: grade.order,
    createdAt: grade.createdAt.toISOString(),
    updatedAt: grade.updatedAt.toISOString(),
  };
}

export async function registerGradeRoutes(
  fastify: FastifyInstance,
  options: GradeRoutesOptions,
): Promise<void> {
  const { service, prefix = '/grades' } = options;

  function getTenantId(request: FastifyRequest, reply: FastifyReply): string | undefined {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      void reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
      return undefined;
    }
    return tenantId;
  }

  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateGradeDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const body = validate(CreateGradeSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const grade = await service.create(tenantId, body.data);
        return reply.status(201).send(formatGradeResponse(grade));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(prefix, async function listHandler(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = getTenantId(request, reply);
    if (!tenantId) return reply;

    const grades = await service.list(tenantId);
    return reply.status(200).send(grades.map(formatGradeResponse));
  });

  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid grade ID', params.errors);

      try {
        const grade = await service.getById(tenantId, params.data.id);
        return reply.status(200).send(formatGradeResponse(grade));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateGradeDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid grade ID', params.errors);

      const body = validate(UpdateGradeSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const grade = await service.update(tenantId, params.data.id, body.data);
        return reply.status(200).send(formatGradeResponse(grade));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid grade ID', params.errors);

      try {
        await service.delete(tenantId, params.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
