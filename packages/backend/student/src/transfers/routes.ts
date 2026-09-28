import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { actorFromRequest } from './actor.js';
import {
  CreateTransferBodySchema,
  DecisionBodySchema,
  EquivalencyBodySchema,
  EquivalencyParamsSchema,
  EquivalencyQuerySchema,
  type EquivalencyParams,
} from './schemas.js';
import type { TransferWorkflowService } from './service.js';
import type { TransferDecision } from './state-machine.js';

function tenantIdOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerTransferWorkflowRoutes(
  fastify: FastifyInstance,
  options: { service: TransferWorkflowService },
): Promise<void> {
  const { service } = options;

  fastify.get('/transfers/pending', async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    try {
      return reply.send(await service.listPending(tenantId, actorFromRequest(request)));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post('/transfers', async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    const body = validate(CreateTransferBodySchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid transfer',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const created = await service.create(tenantId, actorFromRequest(request), body.data);
      return reply.status(201).send(created);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get('/transfers/equivalency', async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    const query = validate(EquivalencyQuerySchema, request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid equivalency lookup',
        statusCode: 400,
        errors: query.errors,
      });
    }
    try {
      return reply.send(
        await service.listEquivalency(tenantId, actorFromRequest(request), query.data),
      );
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post('/transfers/equivalency', async (request, reply) => {
    const tenantId = tenantIdOf(request);
    if (!tenantId)
      return reply
        .status(400)
        .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
    const body = validate(EquivalencyBodySchema, request.body);
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid equivalency rule',
        statusCode: 400,
        errors: body.errors,
      });
    }
    try {
      const created = await service.createEquivalency(
        tenantId,
        actorFromRequest(request),
        body.data,
      );
      return reply.status(201).send(created);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.patch(
    '/transfers/equivalency/:id',
    async (request: FastifyRequest<{ Params: EquivalencyParams }>, reply) => {
      const tenantId = tenantIdOf(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const params = validate(EquivalencyParamsSchema, request.params);
      const body = validate(EquivalencyBodySchema, request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid equivalency update',
          statusCode: 400,
        });
      }
      try {
        return reply.send(
          await service.updateEquivalency(
            tenantId,
            actorFromRequest(request),
            params.data.id,
            body.data,
          ),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    '/transfers/equivalency/:id',
    async (request: FastifyRequest<{ Params: EquivalencyParams }>, reply) => {
      const tenantId = tenantIdOf(request);
      if (!tenantId)
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      const params = validate(EquivalencyParamsSchema, request.params);
      if (!params.success) {
        return reply
          .status(400)
          .send({ code: 'VALIDATION_ERROR', message: 'Invalid equivalency id', statusCode: 400 });
      }
      try {
        return reply.send(
          await service.deleteEquivalency(tenantId, actorFromRequest(request), params.data.id),
        );
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  const decisions: Array<{ path: string; decision: TransferDecision }> = [
    { path: '/transfers/:transferId/submit', decision: 'SUBMIT' },
    { path: '/transfers/:transferId/review', decision: 'START_REVIEW' },
    { path: '/transfers/:transferId/approve', decision: 'APPROVE' },
    { path: '/transfers/:transferId/reject', decision: 'REJECT' },
    { path: '/transfers/:transferId/cancel', decision: 'CANCEL' },
    { path: '/transfers/:transferId/complete', decision: 'COMPLETE' },
  ];

  const transferIdPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  for (const route of decisions) {
    fastify.post(
      route.path,
      async (request: FastifyRequest<{ Params: { transferId: string } }>, reply) => {
        const tenantId = tenantIdOf(request);
        if (!tenantId)
          return reply.status(400).send({
            code: 'TENANT_REQUIRED',
            message: 'Tenant context is required',
            statusCode: 400,
          });
        if (!transferIdPattern.test(request.params.transferId)) {
          return reply
            .status(400)
            .send({ code: 'VALIDATION_ERROR', message: 'Invalid transfer ID', statusCode: 400 });
        }
        const body = validate(DecisionBodySchema, request.body ?? {});
        if (!body.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid decision',
            statusCode: 400,
            errors: body.errors,
          });
        }
        try {
          const view = await service.decide(
            tenantId,
            request.params.transferId,
            actorFromRequest(request),
            route.decision,
            body.data.comment,
          );
          return reply.send(view);
        } catch (error) {
          return sendError(reply, error);
        }
      },
    );
  }
}
