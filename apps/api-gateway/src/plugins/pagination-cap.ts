/**
 * W3-D1: Enforce platform pagination caps on list endpoints.
 *
 * Many domain routes parse `pageSize` with `Number(query.pageSize) || 20`, which
 * bypasses schema maximums. This gateway-level guard rejects out-of-range
 * pagination before handlers run.
 */
import { ErrorCode } from '@proctira/common';
import { validatePaginationQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

const paginationCapPluginImpl: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return;
    }

    const query = request.query as Record<string, unknown>;
    const result = validatePaginationQuery(query);
    if ('skipped' in result && result.skipped) {
      return;
    }

    if (!result.success) {
      return reply.status(400).send({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Invalid pagination parameters',
        statusCode: 400,
        errors: result.errors,
      });
    }

    request.query = {
      ...query,
      page: result.data.page,
      pageSize: result.data.pageSize,
    };
  });
};

export const paginationCapPlugin = fp(paginationCapPluginImpl, {
  name: '@proctira/pagination-cap',
  fastify: '5.x',
});

export default paginationCapPlugin;
