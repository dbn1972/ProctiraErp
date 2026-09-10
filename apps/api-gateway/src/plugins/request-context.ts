/**
 * Request Context Plugin
 *
 * Generates unique request IDs and propagates correlation IDs for distributed tracing.
 *
 * - If an incoming request has an X-Request-ID header, it is preserved; otherwise a UUID is generated.
 * - If an incoming request has an X-Correlation-ID header, it is propagated; otherwise a UUID is generated.
 * - Both IDs are set as response headers for traceability.
 */

import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

/**
 * Options for the request context plugin.
 */
export interface RequestContextOptions {
  /** Header name for request ID (defaults to 'x-request-id') */
  requestIdHeader?: string;
  /** Header name for correlation ID (defaults to 'x-correlation-id') */
  correlationIdHeader?: string;
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
    correlationId: string;
  }
}

const requestContextPluginImpl: FastifyPluginAsync<RequestContextOptions> = async (
  fastify: FastifyInstance,
  options: RequestContextOptions = {},
) => {
  const { requestIdHeader = 'x-request-id', correlationIdHeader = 'x-correlation-id' } = options;

  // Decorate request with IDs
  if (!fastify.hasRequestDecorator('requestId')) {
    fastify.decorateRequest('requestId', '');
  }
  if (!fastify.hasRequestDecorator('correlationId')) {
    fastify.decorateRequest('correlationId', '');
  }

  // Hook: onRequest - generate or propagate request/correlation IDs
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Use incoming request ID header or generate a new UUID
    const requestId = (request.headers[requestIdHeader] as string) || randomUUID();

    // Use incoming correlation ID header or generate a new UUID
    const correlationId = (request.headers[correlationIdHeader] as string) || randomUUID();

    request.requestId = requestId;
    request.correlationId = correlationId;
  });

  // Hook: onSend - set response headers with request/correlation IDs
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.requestId);
    reply.header('x-correlation-id', request.correlationId);
  });
};

/**
 * Fastify plugin that generates unique request IDs and propagates correlation IDs.
 */
export const requestContextPlugin = fp(requestContextPluginImpl, {
  name: '@proctira/request-context',
  fastify: '5.x',
});

export default requestContextPlugin;
