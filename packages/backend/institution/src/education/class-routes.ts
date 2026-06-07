/**
 * Class Routes
 *
 * POST   /classes                - Create a new class
 * GET    /classes                - List classes (filter by institutionId, academicPeriodId, gradeId)
 * GET    /classes/:id            - Get class by ID
 * PUT    /classes/:id            - Update a class
 * DELETE /classes/:id            - Soft-delete a class
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { ClassService } from './class-service.js';
import type { CreateClassDto, UpdateClassDto } from './class-schemas.js';

export interface ClassRoutesOptions {
  service: ClassService;
  prefix?: string;
}

function formatClassResponse(cls: {
  id: string;
  tenantId: string;
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  name: string;
  capacity: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: cls.id,
    tenantId: cls.tenantId,
    institutionId: cls.institutionId,
    gradeId: cls.gradeId,
    academicPeriodId: cls.academicPeriodId,
    name: cls.name,
    capacity: cls.capacity,
    createdAt: cls.createdAt.toISOString(),
    updatedAt: cls.updatedAt.toISOString(),
  };
}

export async function registerClassRoutes(
  fastify: FastifyInstance,
  options: ClassRoutesOptions,
): Promise<void> {
  const { service, prefix = '/classes' } = options;

  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateClassDto }>,
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

      const cls = await service.create(tenantId, request.body);
      return reply.status(201).send(formatClassResponse(cls));
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
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const { institutionId, academicPeriodId, gradeId } = request.query;
      if (!institutionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'institutionId query parameter is required',
          statusCode: 400,
        });
      }

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
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const cls = await service.getById(tenantId, request.params.id);
      return reply.status(200).send(formatClassResponse(cls));
    },
  );

  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateClassDto }>,
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

      const cls = await service.update(tenantId, request.params.id, request.body);
      return reply.status(200).send(formatClassResponse(cls));
    },
  );

  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
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

      await service.delete(tenantId, request.params.id);
      return reply.status(204).send();
    },
  );
}
