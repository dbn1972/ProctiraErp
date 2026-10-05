import { isProductionNodeEnv } from '@proctira/common/node-env';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import type { DestinationStream, Logger } from 'pino';
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
  /** Paths to exclude from logging (e.g., health checks); matched against the pathname */
  ignorePaths?: string[];
  /** Optional destination stream for the request logger (tests / custom sinks) */
  destination?: DestinationStream;
}

/**
 * PRC-L353 — log only the pathname plus query keys; every query value is replaced
 * so tokens / OTPs / codes in query strings never reach the log sink.
 */
export function sanitizeUrlForLog(url: string): string {
  const q = url.indexOf('?');
  if (q === -1) return url;
  const path = url.slice(0, q);
  const params = new URLSearchParams(url.slice(q + 1));
  const keys = [...new Set([...params.keys()])];
  return keys.length === 0 ? path : `${path}?${keys.map((k) => `${k}=[Redacted]`).join('&')}`;
}

function pathnameOf(url: string): string {
  const q = url.indexOf('?');
  return q === -1 ? url : url.slice(0, q);
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

/** PRC-L148 — client-supplied ids must be short opaque tokens; anything else is replaced. */
const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

function safeHeaderId(value: string | string[] | undefined): string {
  return typeof value === 'string' && SAFE_ID.test(value) ? value : uuidv4();
}

const loggingPluginImpl: FastifyPluginAsync<LoggingPluginOptions> = async (
  fastify: FastifyInstance,
  options: LoggingPluginOptions = {},
) => {
  const {
    name = 'http',
    level,
    requestIdHeader = 'x-request-id',
    correlationIdHeader = 'x-correlation-id',
    logBody = false,
    ignorePaths = [],
    destination,
  } = options;

  const baseLogger = createLogger({ name, level, destination });
  const isProduction = isProductionNodeEnv(process.env['NODE_ENV']);
  // PRC-L353: body logging is refused in production regardless of the option.
  const shouldLogBody = logBody && !isProduction;
  if (logBody && isProduction) {
    baseLogger.warn('logBody is ignored in production (PRC-L353)');
  }
  const isIgnored = (url: string): boolean => ignorePaths.includes(pathnameOf(url));

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
    const requestId = safeHeaderId(request.headers[requestIdHeader]); // PRC-L148

    // Extract or generate correlation ID
    const correlationId = safeHeaderId(request.headers[correlationIdHeader]);

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
    if (!isIgnored(request.url)) {
      request.requestLog.info(
        {
          method: request.method,
          url: sanitizeUrlForLog(request.url),
          userAgent: request.headers['user-agent'],
        },
        'request started',
      );
    }
  });

  // Hook: preHandler - tenant resolution runs after this plugin's onRequest, so
  // re-bind the request logger with tenant_id once it is known (PRC-L148).
  fastify.addHook('preHandler', async (request: FastifyRequest) => {
    const tenantId = (request as unknown as { tenantId?: string }).tenantId;
    if (!tenantId || !request.requestLog) return;
    if (request.requestLog.bindings()['tenant_id'] === tenantId) return;
    request.requestLog = request.requestLog.child({ tenant_id: tenantId });
  });
  // Hook: preHandler - body is parsed by now (it never is in onRequest). Values go
  // through the logger's redact paths (password/token/otp/...) (PRC-L353).
  if (shouldLogBody) {
    fastify.addHook('preHandler', async (request: FastifyRequest) => {
      if (request.body === undefined || isIgnored(request.url)) return;
      request.requestLog.debug(
        { url: sanitizeUrlForLog(request.url), body: request.body },
        'request body',
      );
    });
  }
  // Hook: onResponse - log response with duration
  fastify.addHook('onResponse', async (request: FastifyRequest, reply: FastifyReply) => {
    if (isIgnored(request.url)) {
      return;
    }

    const duration = reply.elapsedTime;

    const logData = {
      method: request.method,
      url: sanitizeUrlForLog(request.url),
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
  fastify.addHook(
    'onError',
    async (request: FastifyRequest, _reply: FastifyReply, error: Error) => {
      request.requestLog.error(
        {
          method: request.method,
          url: sanitizeUrlForLog(request.url),
          error: {
            message: error.message,
            name: error.name,
            ...(isProduction ? {} : { stack: error.stack }),
          },
        },
        'request error',
      );
    },
  );

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
  fastify: '5.x',
});
