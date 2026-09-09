/**
 * Academic Period Routes
 *
 * POST   /academic-periods       - Create a new academic period
 * GET    /academic-periods       - List academic periods (optional ?status= filter)
 * GET    /academic-periods/:id   - Get academic period by ID
 * PUT    /academic-periods/:id   - Update an academic period
 * DELETE /academic-periods/:id   - Soft-delete an academic period
 * POST   /academic-periods/:id/validate-active - Validate period is active
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type {
  CreateAcademicPeriodDto,
  UpdateAcademicPeriodDto,
} from './academic-period-schemas.js';
import type { AcademicPeriodService } from './academic-period-service.js';

export interface AcademicPeriodRoutesOptions {
  service: AcademicPeriodService;
  prefix?: string;
}

function formatPeriodResponse(period: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  startDate: Date;
  endDate: Date;
  status: string;
  kind?: string | null;
  parentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: period.id,
    tenantId: period.tenantId,
    name: period.name,
    code: period.code,
    startDate: period.startDate.toISOString().split('T')[0],
    endDate: period.endDate.toISOString().split('T')[0],
    status: period.status,
    kind: period.kind ?? 'year',
    parentId: period.parentId ?? null,
    createdAt: period.createdAt.toISOString(),
    updatedAt: period.updatedAt.toISOString(),
  };
}

export async function registerAcademicPeriodRoutes(
  fastify: FastifyInstance,
  options: AcademicPeriodRoutesOptions,
): Promise<void> {
  const { service, prefix = '/academic-periods' } = options;

  /**
   * POST /academic-periods
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateAcademicPeriodDto }>,
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

      const period = await service.create(tenantId, request.body);
      return reply.status(201).send(formatPeriodResponse(period));
    },
  );

  /**
   * GET /academic-periods
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: { status?: string; parentId?: string; kind?: string } }>,
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

      const periods = await service.list(tenantId, {
        status: request.query.status,
        parentId: request.query.parentId,
        kind: request.query.kind,
      });
      return reply.status(200).send(periods.map(formatPeriodResponse));
    },
  );

  /**
   * GET /academic-periods/:id
   */
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

      const period = await service.getById(tenantId, request.params.id);
      return reply.status(200).send(formatPeriodResponse(period));
    },
  );

  /**
   * PUT /academic-periods/:id
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateAcademicPeriodDto }>,
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

      const period = await service.update(tenantId, request.params.id, request.body);
      return reply.status(200).send(formatPeriodResponse(period));
    },
  );

  /**
   * DELETE /academic-periods/:id
   */
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

  /**
   * POST /academic-periods/:id/validate-active
   * Validates that the period is active (used by other services).
   */
  fastify.post(
    `${prefix}/:id/validate-active`,
    async function validateActiveHandler(
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

      const period = await service.validateActivePeriod(tenantId, request.params.id);
      return reply.status(200).send({ valid: true, period: formatPeriodResponse(period) });
    },
  );
}
