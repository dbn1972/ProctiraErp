/**
 * Grade Routes
 *
 * POST   /grades       - Create a new grade
 * GET    /grades       - List all grades
 * GET    /grades/:id   - Get grade by ID
 * PUT    /grades/:id   - Update a grade
 * DELETE /grades/:id   - Soft-delete a grade
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { GradeService } from './grade-service.js';
import type { CreateGradeDto, UpdateGradeDto } from './grade-schemas.js';

export interface GradeRoutesOptions {
  service: GradeService;
  prefix?: string;
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

  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateGradeDto }>,
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

      const grade = await service.create(tenantId, request.body);
      return reply.status(201).send(formatGradeResponse(grade));
    },
  );

  fastify.get(prefix, async function listHandler(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    if (!tenantId) {
      return reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
    }

    const grades = await service.list(tenantId);
    return reply.status(200).send(grades.map(formatGradeResponse));
  });

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

      const grade = await service.getById(tenantId, request.params.id);
      return reply.status(200).send(formatGradeResponse(grade));
    },
  );

  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateGradeDto }>,
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

      const grade = await service.update(tenantId, request.params.id, request.body);
      return reply.status(200).send(formatGradeResponse(grade));
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
