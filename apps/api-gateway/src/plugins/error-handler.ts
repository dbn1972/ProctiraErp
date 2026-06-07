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
  /** Whether to include detailed error messages for unexpected errors (default: false) */
  includeStackTrace?: boolean;
}

interface ApiErrorResponse {
  code: string;
  message: string;
  statusCode: number;
  errors?: Array<{ field: string; message: string; rule?: string }>;
}

/**
 * Checks if an error is a Prisma known request error.
 */
function isPrismaError(error: unknown): error is { name: string; code: string; meta?: Record<string, unknown>; message: string } {
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

  fastify.setErrorHandler(
    function globalErrorHandler(
      error: Error & { statusCode?: number; code?: string; validation?: unknown[] },
      request: FastifyRequest,
      reply: FastifyReply,
    ) {
      // Log the error
      const log = (request as unknown as { requestLog?: { error: (...args: unknown[]) => void } }).requestLog ?? request.log;
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
        const response: ApiErrorResponse = {
          code: error.code || 'APP_ERROR',
          message: error.message,
          statusCode: error.statusCode || 500,
        };
        if (error.errors && error.errors.length > 0) {
          response.errors = error.errors.map((e) => ({
            field: e.field,
            message: e.message,
            rule: e.rule,
          }));
        }
        return reply.status(error.statusCode || 500).send(response);
      }

      // Handle Prisma errors
      if (isPrismaError(error)) {
        return handlePrismaError(error, reply);
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
    },
  );

  // Handle 404 for unmatched routes
  fastify.setNotFoundHandler(
    function notFoundHandler(_request: FastifyRequest, reply: FastifyReply) {
      const response: ApiErrorResponse = {
        code: ErrorCode.NOT_FOUND,
        message: 'Route not found',
        statusCode: 404,
      };
      return reply.status(404).send(response);
    },
  );
};

/**
 * Handle Prisma-specific errors and map them to appropriate HTTP responses.
 */
function handlePrismaError(
  error: { code: string; meta?: Record<string, unknown>; message: string },
  reply: FastifyReply,
) {
  switch (error.code) {
    case 'P2002': {
      // Unique constraint violation
      const target = error.meta?.target;
      const fields = Array.isArray(target) ? target.join(', ') : 'field';
      const response: ApiErrorResponse = {
        code: ErrorCode.CONFLICT,
        message: `Unique constraint violation on: ${fields}`,
        statusCode: 409,
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
      // Foreign key constraint violation
      const fieldName = error.meta?.field_name as string | undefined;
      const response: ApiErrorResponse = {
        code: ErrorCode.VALIDATION_ERROR,
        message: `Foreign key constraint failed on: ${fieldName || 'unknown field'}`,
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
  fastify: '4.x',
});

export default errorHandlerPlugin;
