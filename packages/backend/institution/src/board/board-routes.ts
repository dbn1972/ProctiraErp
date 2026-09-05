import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { BoardService } from './board-service.js';
import type { CreateBoardDto, UpdateBoardDto } from './board-schemas.js';
import { toIsoString } from '../date-utils.js';

export interface BoardRoutesOptions {
  service: BoardService;
  prefix?: string;
}

function formatBoardResponse(board: {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  type: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: board.id,
    tenantId: board.tenantId,
    name: board.name,
    code: board.code,
    type: board.type,
    status: board.status,
    createdAt: toIsoString(board.createdAt),
    updatedAt: toIsoString(board.updatedAt),
  };
}

function requireTenant(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (!tenantId) {
    reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return undefined;
  }
  return tenantId;
}

export async function registerBoardRoutes(
  fastify: FastifyInstance,
  options: BoardRoutesOptions,
): Promise<void> {
  const { service, prefix = '/boards' } = options;

  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateBoardDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const board = await service.create(tenantId, request.body);
      return reply.status(201).send(formatBoardResponse(board));
    },
  );

  fastify.get(prefix, async function listHandler(request: FastifyRequest, reply: FastifyReply) {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const boards = await service.list(tenantId);
    return reply.status(200).send(boards.map(formatBoardResponse));
  });

  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const board = await service.getById(tenantId, request.params.id);
      return reply.status(200).send(formatBoardResponse(board));
    },
  );

  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: { id: string }; Body: UpdateBoardDto }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const board = await service.update(tenantId, request.params.id, request.body);
      return reply.status(200).send(formatBoardResponse(board));
    },
  );

  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      await service.delete(tenantId, request.params.id);
      return reply.status(204).send();
    },
  );
}
