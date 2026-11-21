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
 *
 * H-D4a / D1-T7: no response body carries database internals (SQL text, constraint, table or
 * column names) in any environment. pg SQLSTATEs map to safe codes and fixed messages, Prisma
 * errors never echo `meta.target`/`meta.field_name`, and AppError 5xx keeps its code with a
 * generic message. Mapped and 5xx bodies carry `correlationId`; the details are logged only.
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
  /** Whether to include detailed error messages for unexpected errors (default: false) */
  includeStackTrace?: boolean;
}

interface ApiErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  errors?: Array<{ field: string; message: string; rule?: string }>;
  /** H-D4a: request correlation id on mapped database errors and 5xx bodies. */
  correlationId?: string;
}

const INTERNAL_MESSAGE = 'Internal server error';

/** Subset of pg-protocol's DatabaseError fields used for mapping and server-side logs. */
interface PgDatabaseErrorLike {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
  column?: string;
}

/** pg `DatabaseError`: a five-character SQLSTATE plus the protocol `severity` field. */
function isPgDatabaseError(error: unknown): error is PgDatabaseErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof severity === 'string';
}

/** The pg error itself or one nested in `cause` (wrapped by a repository). */
function findPgDatabaseError(error: unknown): PgDatabaseErrorLike | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (isPgDatabaseError(current)) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Fixed client body for a SQLSTATE; never derived from the error text. */
function mapSqlState(
  sqlState: string,
  pgMessage: string,
): { status: number; code: string; message: string } {
  if (sqlState === '23503') {
    // "update or delete on table … still referenced" vs "insert or update … is not present".
    return /^update or delete on table|still referenced/i.test(pgMessage)
      ? { status: 409, code: 'REFERENCE_IN_USE', message: 'This record is still in use.' }
      : {
          status: 422,
          code: 'REFERENCE_NOT_FOUND',
          message: 'A referenced record does not exist.',
        };
  }
  if (sqlState === '23505') {
    return {
      status: 409,
      code: ErrorCode.CONFLICT,
      message: 'A record with these details already exists.',
    };
  }
  if (['23502', '23514', '22P02', '22001', '22007', '22008'].includes(sqlState)) {
    return {
      status: 400,
      code: ErrorCode.VALIDATION_ERROR,
      message: 'The request contains an invalid value.',
    };
  }
  return { status: 500, code: ErrorCode.INTERNAL_ERROR, message: INTERNAL_MESSAGE };
}

/** Text that reads like a database error even when it reaches us as a plain Error. */
const DATABASE_TEXT =
  /violates (?:foreign key|unique|not-null|check) constraint|duplicate key value|current transaction is aborted|relation "[^"]*"|column "[^"]*"|syntax error at or near|invalid input syntax for/i;

function correlationIdOf(request: FastifyRequest): string {
  const value = (request as unknown as { correlationId?: unknown }).correlationId;
  return typeof value === 'string' && value.length > 0 ? value : String(request.id);
}

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
    // Log the error (full detail stays server-side; H-D4a)
    const log =
      (request as unknown as { requestLog?: { error: (...args: unknown[]) => void } }).requestLog ??
      request.log;
    const pgError = findPgDatabaseError(error);
    log.error(
      {
        err: error,
        url: request.url,
        method: request.method,
        ...(pgError
          ? {
              pgCode: pgError.code,
              pgConstraint: pgError.constraint,
              pgTable: pgError.table,
              pgColumn: pgError.column,
            }
          : {}),
      },
      'Request error',
    );
    const correlationId = correlationIdOf(request);

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
      if (statusCode >= 500) {
        // D1-T7: a 5xx AppError message can carry store/driver text; keep only the code.
        const response: ApiErrorResponse = {
          code: error.code || 'APP_ERROR',
          message: INTERNAL_MESSAGE,
          statusCode,
          correlationId,
        };
        return reply.status(statusCode).send(response);
      }
      const response: ApiErrorResponse = {
        code: error.code || 'APP_ERROR',
        message: error.message,
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
      return handlePrismaError(error, reply, correlationId);
    }

    // H-D4a: any other Prisma client error (unknown request, validation, panic) carries query
    // text; never echo it, also in development.
    if (typeof error.name === 'string' && error.name.startsWith('PrismaClient')) {
      const response: ApiErrorResponse = {
        code: ErrorCode.INTERNAL_ERROR,
        message: INTERNAL_MESSAGE,
        statusCode: 500,
        correlationId,
      };
      return reply.status(500).send(response);
    }

    // H-D4a: pg DatabaseError (direct or as a cause) → safe code and fixed message.
    if (pgError) {
      const mapped = mapSqlState(pgError.code, pgError.message);
      const response: ApiErrorResponse = {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.status,
        correlationId,
      };
      return reply.status(mapped.status).send(response);
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

    // PRC-H096: body larger than the route/server bodyLimit (FST_ERR_CTP_BODY_TOO_LARGE) was
    // reported as a 500; it is a client error with an actionable message.
    if (error.statusCode === 413) {
      const response: ApiErrorResponse = {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is larger than this endpoint accepts. Upload a smaller file.',
        statusCode: 413,
      };
      return reply.status(413).send(response);
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
    // Development keeps a plain error's message for debugging, unless it reads like DB text.
    const message =
      includeStackTrace && typeof error.message === 'string' && !DATABASE_TEXT.test(error.message)
        ? error.message
        : INTERNAL_MESSAGE;
    const response: ApiErrorResponse = {
      code: ErrorCode.INTERNAL_ERROR,
      message,
      statusCode: 500,
      correlationId,
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
};

/**
 * Handle Prisma-specific errors and map them to appropriate HTTP responses.
 */
function handlePrismaError(
  error: { code: string; meta?: Record<string, unknown>; message: string },
  reply: FastifyReply,
  correlationId: string,
) {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation (H-D4a: meta.target is logged, never echoed)
      const response: ApiErrorResponse = {
        code: ErrorCode.CONFLICT,
        message: 'A record with these details already exists.',
        statusCode: 409,
        correlationId,
      };
      return reply.status(409).send(response);
    }
    case 'P2025': {
      // Record not found
      const cause = error.meta?.cause as string | undefined;
      const response: ApiErrorResponse = {
        code: ErrorCode.NOT_FOUND,
        message: cause || 'Record not found',
        statusCode: 404,
      };
      return reply.status(404).send(response);
    }
    case 'P2003': {
      // Foreign key constraint violation (H-D4a: meta.field_name is logged, never echoed)
      const response: ApiErrorResponse = {
        code: ErrorCode.VALIDATION_ERROR,
        message: 'A related record does not exist or is still in use.',
        statusCode: 400,
        correlationId,
      };
      return reply.status(400).send(response);
    }
    case 'P2010': {
      // Raw query failed: meta.code is the SQLSTATE; map it like a pg DatabaseError.
      const sqlState = typeof error.meta?.code === 'string' ? error.meta.code : '';
      const pgMessage = typeof error.meta?.message === 'string' ? error.meta.message : '';
      const mapped = mapSqlState(sqlState, pgMessage);
      const response: ApiErrorResponse = {
        code: mapped.code,
        message: mapped.message,
        statusCode: mapped.status,
        correlationId,
      };
      return reply.status(mapped.status).send(response);
    }
    default: {
      // Unknown Prisma error
      const response: ApiErrorResponse = {
        code: ErrorCode.INTERNAL_ERROR,
        message: INTERNAL_MESSAGE,
        statusCode: 500,
        correlationId,
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
