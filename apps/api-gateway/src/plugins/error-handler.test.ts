import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  ValidationError,
  ConflictError,
  NotFoundError,
  BusinessRuleError,
  ErrorCode,
} from '@proctira/common';
import errorHandlerPlugin from './error-handler.js';

describe('errorHandlerPlugin', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify();
    await app.register(errorHandlerPlugin);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('AppError handling', () => {
    it('should return structured response for ValidationError', async () => {
      app.get('/test', async () => {
        throw new ValidationError('Name is required', [
          { field: 'body.name', rule: 'required', message: 'Name is required' },
        ]);
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.message).toBe('Name is required');
      expect(body.statusCode).toBe(400);
      expect(body.errors).toBeDefined();
      expect(body.errors[0].field).toBe('body.name');
      expect(body.errors[0].rule).toBe('required');
      expect(body.errors[0].message).toBe('Name is required');
    });

    it('should return structured response for ConflictError', async () => {
      app.get('/test', async () => {
        throw new ConflictError('Institution code already exists');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.CONFLICT);
      expect(body.message).toBe('Institution code already exists');
      expect(body.statusCode).toBe(409);
    });

    it('should return structured response for NotFoundError', async () => {
      app.get('/test', async () => {
        throw new NotFoundError('Student not found');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(body.message).toBe('Student not found');
      expect(body.statusCode).toBe(404);
    });

    it('should return structured response for BusinessRuleError', async () => {
      app.get('/test', async () => {
        throw new BusinessRuleError('Cannot transfer to inactive institution');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(422);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.BUSINESS_RULE_ERROR);
      expect(body.message).toBe('Cannot transfer to inactive institution');
      expect(body.statusCode).toBe(422);
    });

    it('should omit errors array when empty', async () => {
      app.get('/test', async () => {
        throw new ValidationError('Validation failed', []);
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      const body = response.json();
      // When errors array is empty, it should not be included
      expect(body.errors).toBeUndefined();
    });
  });

  describe('Fastify validation error handling', () => {
    it('should map Fastify validation errors to structured field-level errors', async () => {
      app.post(
        '/test',
        {
          schema: {
            body: Type.Object({
              name: Type.String({ minLength: 1 }),
              email: Type.String({ format: 'email' }),
            }),
          },
        },
        async () => {
          return { ok: true };
        }
      );

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: { name: '', email: 'not-an-email' },
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.message).toBe('Request validation failed');
      expect(body.statusCode).toBe(400);
      expect(body.errors).toBeDefined();
      expect(Array.isArray(body.errors)).toBe(true);
      expect(body.errors.length).toBeGreaterThan(0);

      // Each error should have field, rule, message
      for (const error of body.errors) {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('rule');
        expect(error).toHaveProperty('message');
      }
    });

    it('should map required field validation errors correctly', async () => {
      app.post(
        '/test',
        {
          schema: {
            body: Type.Object({
              name: Type.String(),
              age: Type.Number(),
            }),
          },
        },
        async () => {
          return { ok: true };
        }
      );

      const response = await app.inject({
        method: 'POST',
        url: '/test',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.errors).toBeDefined();

      // Should have errors for missing required fields
      const fieldNames = body.errors.map((e: { field: string }) => e.field);
      expect(fieldNames.some((f: string) => f.includes('name'))).toBe(true);
    });

    it('should handle querystring validation errors', async () => {
      app.get(
        '/test',
        {
          schema: {
            querystring: Type.Object({
              page: Type.Number({ minimum: 1 }),
            }),
          },
        },
        async () => {
          return { ok: true };
        }
      );

      const response = await app.inject({
        method: 'GET',
        url: '/test?page=0',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.errors).toBeDefined();
      expect(body.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Prisma error handling', () => {
    it('should map P2002 (unique constraint) to 409 Conflict', async () => {
      app.get('/test', async () => {
        const error = new Error('Unique constraint failed') as unknown as {
          name: string;
          code: string;
          meta: Record<string, unknown>;
          message: string;
        };
        Object.assign(error, {
          name: 'PrismaClientKnownRequestError',
          code: 'P2002',
          meta: { target: ['email'] },
        });
        throw error;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(409);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.CONFLICT);
      expect(body.message).toContain('email');
      expect(body.statusCode).toBe(409);
    });

    it('should map P2025 (not found) to 404 Not Found', async () => {
      app.get('/test', async () => {
        const error = new Error('Record not found') as unknown as {
          name: string;
          code: string;
          meta: Record<string, unknown>;
          message: string;
        };
        Object.assign(error, {
          name: 'PrismaClientKnownRequestError',
          code: 'P2025',
          meta: { cause: 'Record to update not found.' },
        });
        throw error;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.NOT_FOUND);
      expect(body.message).toBe('Record to update not found.');
      expect(body.statusCode).toBe(404);
    });

    it('should map P2003 (foreign key constraint) to 400', async () => {
      app.get('/test', async () => {
        const error = new Error('Foreign key constraint failed') as unknown as {
          name: string;
          code: string;
          meta: Record<string, unknown>;
          message: string;
        };
        Object.assign(error, {
          name: 'PrismaClientKnownRequestError',
          code: 'P2003',
          meta: { field_name: 'institution_id' },
        });
        throw error;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.VALIDATION_ERROR);
      expect(body.message).toContain('institution_id');
    });

    it('should map unknown Prisma errors to 500', async () => {
      app.get('/test', async () => {
        const error = new Error('Unknown Prisma error') as unknown as {
          name: string;
          code: string;
          meta: Record<string, unknown>;
          message: string;
        };
        Object.assign(error, {
          name: 'PrismaClientKnownRequestError',
          code: 'P9999',
          meta: {},
        });
        throw error;
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
    });
  });

  describe('Not found handler', () => {
    it('should return 404 for unmatched routes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/nonexistent',
      });

      expect(response.statusCode).toBe(404);
      const body = response.json();
      expect(body).toEqual({
        code: ErrorCode.NOT_FOUND,
        message: 'Route not found',
        statusCode: 404,
      });
    });
  });

  describe('Unexpected errors', () => {
    it('should return 500 with generic message for unexpected errors', async () => {
      app.get('/test', async () => {
        throw new Error('Something went wrong internally');
      });

      const response = await app.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(body.message).toBe('Internal server error');
      expect(body.statusCode).toBe(500);
    });

    it('should include error message when includeStackTrace is enabled', async () => {
      const appWithStack = Fastify();
      await appWithStack.register(errorHandlerPlugin, { includeStackTrace: true });

      appWithStack.get('/test', async () => {
        throw new Error('Detailed error message');
      });

      const response = await appWithStack.inject({
        method: 'GET',
        url: '/test',
      });

      expect(response.statusCode).toBe(500);
      const body = response.json();
      expect(body.message).toBe('Detailed error message');

      await appWithStack.close();
    });
  });

  describe('Response structure consistency', () => {
    it('should always include code, message, and statusCode in error responses', async () => {
      app.get('/validation', async () => {
        throw new ValidationError('Bad input', [
          { field: 'body.x', rule: 'type', message: 'Must be string' },
        ]);
      });
      app.get('/conflict', async () => {
        throw new ConflictError('Duplicate');
      });
      app.get('/notfound', async () => {
        throw new NotFoundError('Missing');
      });
      app.get('/business', async () => {
        throw new BusinessRuleError('Rule violated');
      });
      app.get('/unexpected', async () => {
        throw new Error('Oops');
      });

      const routes = ['/validation', '/conflict', '/notfound', '/business', '/unexpected'];

      for (const route of routes) {
        const response = await app.inject({ method: 'GET', url: route });
        const body = response.json();

        expect(body).toHaveProperty('code');
        expect(body).toHaveProperty('message');
        expect(body).toHaveProperty('statusCode');
        expect(typeof body.code).toBe('string');
        expect(typeof body.message).toBe('string');
        expect(typeof body.statusCode).toBe('number');
      }
    });
  });
});
