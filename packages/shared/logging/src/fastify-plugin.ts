import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { Logger } from 'pino';
import { v4 as uuidv4 } from 'uuid';

import { createLogger } from './logger.js';

/**
 * Options for the logging Fastify plugin.
 */
export interface LoggingPluginOptions {
  /** Logger name (defaults to 'http') */
  name?: string;
  /** Log level (defaults to LOG_LEVEL env or 'info') */
  level?: string;
  /** Header name for request ID (defaults to 'x-request-id') */
  requestIdHeader?: string;
  /** Header name for correlation ID (defaults to 'x-correlation-id') */
  correlationIdHeader?: string;
  /** Whether to log request body (defaults to false for security) */
  logBody?: boolean;
  /** Paths to exclude from logging (e.g., health checks) */
  ignorePaths?: string[];
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    reqId: string;
    correlationId: string;
    tenantId?: string;
    requestLog: Logger;
  }
}

const loggingPluginImpl: FastifyPluginAsync<LoggingPluginOptions> = async (
  fastify: FastifyInstance,
  options: LoggingPluginOptions = {}
) => {
  const {
    name = 'http',
    level,
    requestIdHeader = 'x-request-id',
    correlationIdHeader = 'x-correlation-id',
    logBody = false,
    ignorePaths = [],
  } = options;

  const baseLogger = createLogger({ name, level });

  // Decorate request with IDs and logger
  if (!fastify.hasRequestDecorator('reqId')) {
    fastify.decorateRequest('reqId', '');
  }
  if (!fastify.hasRequestDecorator('correlationId')) {
    fastify.decorateRequest('correlationId', '');
  }
  if (!fastify.hasRequestDecorator('requestLog')) {
    fastify.decorateRequest('requestLog', null as unknown as Logger);
  }

  // Hook: onRequest - attach IDs and create request-scoped logger
  fastify.addHook('onRequest', async (request: FastifyRequest, _reply: FastifyReply) => {
    // Extract or generate request ID
    const requestId =
      (request.headers[requestIdHeader] as string) || uuidv4();

    // Extract or generate correlation ID
    const correlationId =
      (request.headers[correlationIdHeader] as string) || uuidv4();

    // Get tenant ID if already set on request (by tenant resolution plugin)
    const tenantId = (request as unknown as { tenantId?: string }).tenantId;

    // Attach IDs to request
    request.reqId = requestId;
    request.correlationId = correlationId;

    // Create request-scoped child logger with context
    const childBindings: Record<string, unknown> = {
      request_id: requestId,
      correlation_id: correlationId,
    };

    if (tenantId) {
      childBindings['tenant_id'] = tenantId;
    }

    request.requestLog = baseLogger.child(childBindings);

    // Log request start (skip ignored paths)
    if (!ignorePaths.includes(request.url)) {
      const logData: Record<string, unknown> = {
        method: request.method,
        url: request.url,
        userAgent: request.headers['user-agent'],
      };

      if (logBody && request.body) {
        logData['body'] = request.body;
      }

      request.requestLog.info(logData, 'request started');
    }
  });

  // Hook: onResponse - log response with duration
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (ignorePaths.includes(request.url)) {
      return;
    }

    const duration = reply.elapsedTime;

    const logData = {
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      duration_ms: Math.round(duration * 100) / 100,
    };

    if (reply.statusCode >= 500) {
      request.requestLog.error(logData, 'request failed');
    } else if (reply.statusCode >= 400) {
      request.requestLog.warn(logData, 'request completed with client error');
    } else {
      request.requestLog.info(logData, 'request completed');
    }
  });

  // Hook: onError - log errors
  fastify.addHook('onError', async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
    request.requestLog.error(
      {
        method: request.method,
        url: request.url,
        error: {
          message: error.message,
          name: error.name,
          stack: error.stack,
        },
      },
      'request error'
    );
  });

  // Set response headers with request/correlation IDs for traceability
  fastify.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply) => {
    reply.header('x-request-id', request.reqId);
    reply.header('x-correlation-id', request.correlationId);
  });
};

/**
 * Fastify plugin that provides automatic request/response logging with:
 * - Request ID generation/propagation (from X-Request-ID header or auto-generated UUID)
 * - Correlation ID propagation (from X-Correlation-ID header or auto-generated UUID)
 * - Tenant ID attachment from request context
 * - Request start/end logging with duration in milliseconds
 * - Response status code logging
 *
 * Uses fastify-plugin to expose decorations to the parent scope.
 */
export const loggingPlugin = fp(loggingPluginImpl, {
  name: '@proctira/logging',
  fastify: '4.x',
});
