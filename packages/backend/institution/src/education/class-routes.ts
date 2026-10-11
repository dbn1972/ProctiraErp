/**
 * Class Routes
 *
 * POST   /classes                - Create a new class
 * GET    /classes                - List classes (filter by institutionId, academicPeriodId, gradeId)
 * GET    /classes/:id            - Get class by ID
 * PUT    /classes/:id            - Update a class
 * DELETE /classes/:id            - Soft-delete a class
 */
import { AppError } from '@proctira/common';
import { Type, validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { CreateClassSchema, UpdateClassSchema } from './class-schemas.js';
import type { CreateClassDto, UpdateClassDto } from './class-schemas.js';
import type { ClassService } from './class-service.js';

export interface ClassRoutesOptions {
  service: ClassService;
  prefix?: string;
}

const IdParamsSchema = Type.Object({ id: Type.String({ format: 'uuid' }) });
const ClassListQuerySchema = Type.Object({
  institutionId: Type.String({ format: 'uuid' }),
  academicPeriodId: Type.Optional(Type.String({ format: 'uuid' })),
  gradeId: Type.Optional(Type.String({ format: 'uuid' })),
});

function validationError(reply: FastifyReply, message: string, errors: unknown) {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    errors,
  });
}

function formatClassResponse(cls: {
  id: string;
  tenantId: string;
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  name: string;
  capacity: number | null;
  classTeacherStaffId?: string | null;
  roomName?: string | null;
  classTeacher?: { firstName: string; lastName: string } | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const teacher = cls.classTeacher
    ? `${cls.classTeacher.firstName} ${cls.classTeacher.lastName}`.trim()
    : null;
  return {
    id: cls.id,
    tenantId: cls.tenantId,
    institutionId: cls.institutionId,
    gradeId: cls.gradeId,
    academicPeriodId: cls.academicPeriodId,
    name: cls.name,
    capacity: cls.capacity,
    classTeacherStaffId: cls.classTeacherStaffId ?? null,
    classTeacherName: teacher,
    roomName: cls.roomName ?? null,
    createdAt: cls.createdAt.toISOString(),
    updatedAt: cls.updatedAt.toISOString(),
  };
}

export async function registerClassRoutes(
  fastify: FastifyInstance,
  options: ClassRoutesOptions,
): Promise<void> {
  const { service, prefix = '/classes' } = options;

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
      request: FastifyRequest<{ Body: CreateClassDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const body = validate(CreateClassSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const cls = await service.create(tenantId, body.data);
        return reply.status(201).send(formatClassResponse(cls));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{
        Querystring: { institutionId: string; academicPeriodId?: string; gradeId?: string };
      }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const query = validateQuery(ClassListQuerySchema, request.query);
      if (!query.success) return validationError(reply, 'Invalid query parameters', query.errors);

      const { institutionId, academicPeriodId, gradeId } = query.data;
      const classes = await service.list(tenantId, institutionId, {
        academicPeriodId,
        gradeId,
      });
      return reply.status(200).send(classes.map(formatClassResponse));
    },
  );

  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid class ID', params.errors);

      try {
        const cls = await service.getById(tenantId, params.data.id);
        return reply.status(200).send(formatClassResponse(cls));
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
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateClassDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request, reply);
      if (!tenantId) return reply;

      const params = validate(IdParamsSchema, request.params);
      if (!params.success) return validationError(reply, 'Invalid class ID', params.errors);

      const body = validate(UpdateClassSchema, request.body);
      if (!body.success) return validationError(reply, 'Validation failed', body.errors);

      try {
        const cls = await service.update(tenantId, params.data.id, body.data);
        return reply.status(200).send(formatClassResponse(cls));
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
      if (!params.success) return validationError(reply, 'Invalid class ID', params.errors);

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
