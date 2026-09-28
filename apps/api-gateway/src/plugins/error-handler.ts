/**
 * Global Error Handler Plugin
 *
 * Provides consistent error responses across the gateway.
 * Maps various error types to structured ApiError JSON responses:
 * - Application errors (ValidationError, NotFoundError, ConflictError, BusinessRuleError)
 * - Fastify schema validation errors
 * - Prisma database errors (unique constraint, not found, foreign key)
 * - Rate limit errors
 * - Authentication/authorization errors
 * - Unexpected errors (500)
 */

import {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  BusinessRuleError,
  ErrorCode,
} from '@proctira/common';
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';

export interface ErrorHandlerOptions {
  /**
   * Whether to include detailed error messages for unexpected errors (default: false).
   *
   * Despite the name this has never emitted `error.stack` — it selects `error.message`
   * over a fixed string. It is set from `config.env === 'development'`, so it is the
   * gateway's "diagnostics are safe here" switch, and it is what now gates the database
   * identifiers below as well.
   */
  includeStackTrace?: boolean;
}

interface ApiErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  errors?: Array<{ field: string; message: string; rule?: string }>;
  /**
   * The value of `request.id` (`x-request-id`, or a generated uuid).
   *
   * It was already logged and already returned as a response header by the logging
   * plugin, but no client read the header and nothing put it in the body — so a user
   * reporting "it failed" had nothing to quote and support had nothing to search. The
   * body is the only place a person can see it.
   */
  requestId?: string;
}

/**
 * Generic messages for the database errors whose natural text names schema objects.
 *
 * Prisma's `meta` carries column names (`P2002.target`), constraint identifiers
 * (`P2003.field_name`, typically `<table>_<column>_fkey`) and generated prose naming
 * models and relations (`P2025.cause`). Echoing those to a client discloses the schema,
 * and it is not even useful to the caller: `meta.target` is a *database column*, not the
 * API field the client sent, so `tenant_id, admission_number` does not tell a UI which
 * input to highlight.
 *
 * The detail is not lost — the full error is logged at the top of the handler, together
 * with the request id that is now in the response body, so an operator can join the two.
 */
const PRISMA_SAFE_MESSAGES = {
  P2002: 'A record with these details already exists.',
  P2003: 'A referenced record does not exist or is not available in this tenant.',
  P2025: 'The requested record was not found.',
} as const;

/**
 * Checks if an error is a Prisma known request error.
 */
function isPrismaError(
  error: unknown,
): error is { name: string; code: string; meta?: Record<string, unknown>; message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name: string }).name === 'PrismaClientKnownRequestError' &&
    'code' in error
  );
}

const errorHandlerPluginImpl: FastifyPluginAsync<ErrorHandlerOptions> = async (
  fastify: FastifyInstance,
  options: ErrorHandlerOptions = {},
) => {
  const { includeStackTrace = false } = options;

  fastify.setErrorHandler(function globalErrorHandler(
    error: Error & { statusCode?: number; code?: string; validation?: unknown[] },
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    // Log the error
    const log =
      (request as unknown as { requestLog?: { error: (...args: unknown[]) => void } }).requestLog ??
      request.log;
    log.error({ err: error, url: request.url, method: request.method }, 'Request error');

    // Handle Fastify validation errors (from schema validation)
    if (error.validation && Array.isArray(error.validation)) {
      const fieldErrors = error.validation.map((v: unknown) => {
        const validationError = v as {
          instancePath?: string;
          message?: string;
          keyword?: string;
          params?: { missingProperty?: string };
        };
        const field = validationError.instancePath
          ? validationError.instancePath.replace(/^\//, '').replace(/\//g, '.')
          : validationError.params?.missingProperty || 'unknown';
        return {
          field,
          message: validationError.message || 'Validation failed',
          rule: validationError.keyword || 'unknown',
        };
      });

      const response: ApiErrorResponse = {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Request validation failed',
        statusCode: 400,
        errors: fieldErrors,
      };

      return reply.status(400).send(response);
    }

    // Handle application-level errors
    if (error instanceof ValidationError) {
      const response: ApiErrorResponse = {
        code: ErrorCode.VALIDATION_ERROR,
        message: error.message,
        statusCode: 400,
      };
      if (error.errors && error.errors.length > 0) {
        response.errors = error.errors.map((e) => ({
          field: e.field,
          message: e.message,
          rule: e.rule,
        }));
      }
      return reply.status(400).send(response);
    }

    if (error instanceof NotFoundError) {
      const response: ApiErrorResponse = {
        code: ErrorCode.NOT_FOUND,
        message: error.message,
        statusCode: 404,
      };
      return reply.status(404).send(response);
    }

    if (error instanceof ConflictError) {
      const response: ApiErrorResponse = {
        code: ErrorCode.CONFLICT,
        message: error.message,
        statusCode: 409,
      };
      return reply.status(409).send(response);
    }

    if (error instanceof BusinessRuleError) {
      const response: ApiErrorResponse = {
        code: ErrorCode.BUSINESS_RULE_ERROR,
        message: error.message,
        statusCode: 422,
      };
      return reply.status(422).send(response);
    }

    if (error instanceof AppError) {
      const statusCode = error.statusCode || 500;
      // A 5xx `AppError` used to walk out with `error.message` verbatim, because this
      // branch runs *before* the default 500 branch that masks it. Anything wrapping a
      // driver failure therefore published it: `new AppError('connect ECONNREFUSED
      // 10.0.3.14:5432 (database "proctira_prod")', 'DB_DOWN', 500)` reached the client
      // intact in production. Server faults get the same mask as the default branch; the
      // code still travels, because codes are the client contract and are not sensitive.
      const exposeMessage = statusCode < 500 || includeStackTrace;
      const response: ApiErrorResponse = {
        code: error.code || 'APP_ERROR',
        message: exposeMessage ? error.message : 'Internal server error',
        statusCode,
      };
      if (error.errors && error.errors.length > 0) {
        response.errors = error.errors.map((e) => ({
          field: e.field,
          message: e.message,
          rule: e.rule,
        }));
      }
      return reply.status(statusCode).send(response);
    }

    // Handle Prisma errors
    if (isPrismaError(error)) {
      return handlePrismaError(error, reply, includeStackTrace);
    }

    // Handle rate limit errors
    if (error.statusCode === 429) {
      const response: ApiErrorResponse = {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests. Please try again later.',
        statusCode: 429,
      };
      return reply.status(429).send(response);
    }

    // Handle unauthorized errors
    if (error.statusCode === 401) {
      const response: ApiErrorResponse = {
        code: 'UNAUTHORIZED',
        message: error.message || 'Authentication required',
        statusCode: 401,
      };
      return reply.status(401).send(response);
    }

    // Handle forbidden errors
    if (error.statusCode === 403) {
      const response: ApiErrorResponse = {
        code: 'FORBIDDEN',
        message: error.message || 'Access denied',
        statusCode: 403,
      };
      return reply.status(403).send(response);
    }

    // Default: Internal server error
    const response: ApiErrorResponse = {
      code: ErrorCode.INTERNAL_ERROR,
      message: includeStackTrace ? error.message : 'Internal server error',
      statusCode: 500,
    };

    return reply.status(500).send(response);
  });

  // Handle 404 for unmatched routes
  fastify.setNotFoundHandler(function notFoundHandler(
    _request: FastifyRequest,
    reply: FastifyReply,
  ) {
    const response: ApiErrorResponse = {
      code: ErrorCode.NOT_FOUND,
      message: 'Route not found',
      statusCode: 404,
    };
    return reply.status(404).send(response);
  });

  /**
   * Stamp `requestId` onto every error body, including the ones this plugin never sees.
   *
   * Doing it in the handler alone would have missed most of them: the auth hook, the RBAC
   * hook, the tenant guards, the idempotency plugin and the service router all build their
   * own envelope and call `reply.send` directly, so they never throw. A denial — the
   * failure a user is most likely to phone about — is precisely one of those. An `onSend`
   * hook is the one place that sees all of them.
   *
   * Deliberately conservative: it only touches a body that already parses as JSON and
   * already looks like the error envelope (`code` + `statusCode`), and it never overwrites
   * a `requestId` a handler set itself. Anything else is returned untouched, so a
   * streamed payload, a 204, or the differently-shaped health body cannot be corrupted.
   */
  fastify.addHook(
    'onSend',
    async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      if (reply.statusCode < 400) return payload;
      if (typeof payload !== 'string' || payload.length === 0) return payload;

      const contentType = reply.getHeader('content-type');
      if (typeof contentType === 'string' && !contentType.includes('application/json')) {
        return payload;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return payload;
      }
      if (!isErrorEnvelope(parsed)) return payload;
      if (typeof parsed.requestId === 'string' && parsed.requestId.length > 0) return payload;

      const next = JSON.stringify({ ...parsed, requestId: String(request.id) });
      // The body grew; a stale content-length truncates the response. `void` because
      // `FastifyReply` is thenable, so the bare call reads as a floating promise.
      void reply.removeHeader('content-length');
      return next;
    },
  );
};

/** A JSON object carrying the gateway's error contract. */
function isErrorEnvelope(value: unknown): value is Record<string, unknown> & {
  code: string;
  statusCode: number;
  requestId?: unknown;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.code === 'string' && typeof record.statusCode === 'number';
}

/**
 * Handle Prisma-specific errors and map them to appropriate HTTP responses.
 */
function handlePrismaError(
  error: { code: string; meta?: Record<string, unknown>; message: string },
  reply: FastifyReply,
  /** Development only. Keeps the schema identifiers a developer needs while debugging. */
  includeDatabaseDetail = false,
) {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation. `meta.target` is a list of database columns.
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.join(', ') : 'field';
      const response: ApiErrorResponse = {
        code: ErrorCode.CONFLICT,
        message: includeDatabaseDetail
          ? `Unique constraint violation on: ${fields}`
          : PRISMA_SAFE_MESSAGES.P2002,
        statusCode: 409,
      };
      return reply.status(409).send(response);
    }
    case 'P2025': {
      // Record not found. `meta.cause` is Prisma-generated prose naming models/relations.
      const cause = error.meta?.cause as string | undefined;
      const response: ApiErrorResponse = {
        code: ErrorCode.NOT_FOUND,
        message: includeDatabaseDetail ? cause || 'Record not found' : PRISMA_SAFE_MESSAGES.P2025,
        statusCode: 404,
      };
      return reply.status(404).send(response);
    }
    case 'P2003': {
      // Foreign key constraint violation. `meta.field_name` is a constraint identifier.
      const fieldName = error.meta?.field_name as string | undefined;
      const response: ApiErrorResponse = {
        code: ErrorCode.VALIDATION_ERROR,
        message: includeDatabaseDetail
          ? `Foreign key constraint failed on: ${fieldName || 'unknown field'}`
          : PRISMA_SAFE_MESSAGES.P2003,
        statusCode: 400,
      };
      return reply.status(400).send(response);
    }
    default: {
      // Unknown Prisma error
      const response: ApiErrorResponse = {
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Internal server error',
        statusCode: 500,
      };
      return reply.status(500).send(response);
    }
  }
}

/**
 * Fastify plugin that provides global error handling with consistent API error responses.
 */
export const errorHandlerPlugin = fp(errorHandlerPluginImpl, {
  name: '@proctira/error-handler',
  fastify: '5.x',
});

export default errorHandlerPlugin;
