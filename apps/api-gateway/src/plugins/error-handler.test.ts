import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { Type } from '@sinclair/typebox';
import {
  AppError,
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
        },
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
        },
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
        },
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
      // V15: this used to assert `toContain('email')`, i.e. it pinned the disclosure of
      // the unique index's column names as the expected behaviour. The status and code
      // are the contract; the column list is not. See the disclosure suite below for the
      // development branch that still shows it.
      expect(body.message).not.toContain('email');
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
      // V15: was `toBe('Record to update not found.')` — Prisma's own generated `meta.cause`.
      // Harmless in this fixture, but the same field carries text naming models and
      // relations, so the response no longer forwards it verbatim.
      expect(body.message).toBe('The requested record was not found.');
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
      // V15: was `toContain('institution_id')`. Prisma's `field_name` is a constraint
      // identifier (`<table>_<column>_fkey`), not the API field the client sent, so it was
      // disclosing schema without telling the caller which input to fix.
      expect(body.message).not.toContain('institution_id');
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
      // `toMatchObject`, not `toEqual`: every error body now also carries `requestId`, and
      // a whole-object comparison here would force this assertion to be rewritten each
      // time the envelope gains a diagnostic field.
      expect(body).toMatchObject({
        code: ErrorCode.NOT_FOUND,
        message: 'Route not found',
        statusCode: 404,
      });
      expect(typeof body.requestId).toBe('string');
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

/**
 * V15 — what a failure response is allowed to say, and how it is identified.
 *
 * These run against a separate instance because they need production posture
 * (`includeStackTrace: false`) and a deterministic request id, which the shared
 * `beforeEach` above does not provide.
 */
describe('errorHandlerPlugin — disclosure and attribution (V15)', () => {
  function prismaError(code: string, meta: Record<string, unknown>) {
    const e = new Error(`prisma ${code}`) as Error & {
      name: string;
      code: string;
      meta: unknown;
    };
    e.name = 'PrismaClientKnownRequestError';
    e.code = code;
    e.meta = meta;
    return e;
  }

  async function build(includeStackTrace: boolean, reqId = 'req-fixed-1') {
    const instance = Fastify({ requestIdHeader: 'x-request-id', genReqId: () => reqId });
    await instance.register(errorHandlerPlugin, { includeStackTrace });
    return instance;
  }

  describe('database identifiers stay server-side outside development', () => {
    it('P2002 does not name the columns of the unique index', async () => {
      // Reproduced before the fix: the body read
      // "Unique constraint violation on: tenant_id, admission_number".
      const app = await build(false);
      app.get('/t', async () => {
        throw prismaError('P2002', { target: ['tenant_id', 'admission_number'] });
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe(ErrorCode.CONFLICT);
      expect(res.json().message).not.toMatch(/tenant_id|admission_number/);
      await app.close();
    });

    it('P2003 does not name the foreign-key constraint', async () => {
      const app = await build(false);
      app.get('/t', async () => {
        throw prismaError('P2003', { field_name: 'student_guardians_student_id_fkey (index)' });
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).not.toMatch(/_fkey|student_guardians/);
      await app.close();
    });

    it('P2025 does not return Prisma-generated prose naming models and relations', async () => {
      const app = await build(false);
      app.get('/t', async () => {
        throw prismaError('P2025', {
          cause: "No 'StudentGuardian' record(s) (needed to inline the relation) was found",
        });
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(404);
      expect(res.json().message).not.toMatch(/StudentGuardian|relation/);
      await app.close();
    });

    it('development keeps the identifiers a developer needs', async () => {
      // The masking must not cost local debuggability, or it gets reverted.
      const app = await build(true);
      app.get('/t', async () => {
        throw prismaError('P2002', { target: ['admission_number'] });
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json().message).toContain('admission_number');
      await app.close();
    });
  });

  describe('AppError does not bypass the 5xx mask', () => {
    it('masks the message at 500 while keeping the code', async () => {
      // This branch runs before the default 500 branch, so it used to emit
      // `error.message` verbatim in production — including driver text such as
      // "connect ECONNREFUSED 10.0.3.14:5432 (database \"proctira_prod\")".
      const app = await build(false);
      app.get('/t', async () => {
        throw new AppError('connect ECONNREFUSED 10.0.3.14:5432 (database "x")', 'DB_DOWN', 500);
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.statusCode).toBe(500);
      expect(res.json().message).toBe('Internal server error');
      expect(res.json().message).not.toMatch(/5432|ECONNREFUSED/);
      // The code is the client contract and is not sensitive — it must survive.
      expect(res.json().code).toBe('DB_DOWN');
      await app.close();
    });

    it('keeps the message below 500, where it is the user-facing reason', async () => {
      const app = await build(false);
      app.get('/t', async () => {
        throw new AppError('Admission window is closed for this class', 'WINDOW_CLOSED', 422);
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json().message).toBe('Admission window is closed for this class');
      await app.close();
    });
  });

  describe('every failure body is attributable', () => {
    it('stamps requestId on a thrown failure', async () => {
      const app = await build(false);
      app.get('/t', async () => {
        throw new Error('boom');
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json().requestId).toBe('req-fixed-1');
      await app.close();
    });

    it('stamps requestId on a hand-built reply.send failure', async () => {
      // The auth, RBAC and tenant hooks never throw — they call reply.send directly, so a
      // handler-only implementation would have missed every denial, which is the failure
      // users are most likely to report.
      const app = await build(false);
      app.get('/t', async (_req, reply) =>
        reply.status(403).send({ code: 'FORBIDDEN', message: 'Access denied', statusCode: 403 }),
      );
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json()).toMatchObject({ code: 'FORBIDDEN', requestId: 'req-fixed-1' });
      await app.close();
    });

    it('honours an inbound x-request-id so one id spans client and gateway', async () => {
      const app = Fastify({ requestIdHeader: 'x-request-id' });
      await app.register(errorHandlerPlugin, { includeStackTrace: false });
      app.get('/t', async () => {
        throw new Error('boom');
      });
      const res = await app.inject({
        method: 'GET',
        url: '/t',
        headers: { 'x-request-id': 'client-supplied-42' },
      });
      expect(res.json().requestId).toBe('client-supplied-42');
      await app.close();
    });

    it('does not overwrite a requestId a handler already set', async () => {
      const app = await build(false);
      app.get('/t', async (_req, reply) =>
        reply
          .status(409)
          .send({ code: 'CONFLICT', message: 'x', statusCode: 409, requestId: 'handler-owned' }),
      );
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json().requestId).toBe('handler-owned');
      await app.close();
    });

    it('leaves a success body untouched', async () => {
      const app = await build(false);
      app.get('/t', async () => ({ code: 'OK', statusCode: 200, data: 1 }));
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json().requestId).toBeUndefined();
      await app.close();
    });

    it('leaves a non-envelope failure body untouched', async () => {
      // The health endpoints return a different shape; the hook must not reshape it.
      const app = await build(false);
      app.get('/t', async (_req, reply) => reply.status(503).send({ status: 'down', uptime: 3 }));
      const res = await app.inject({ method: 'GET', url: '/t' });
      expect(res.json()).toEqual({ status: 'down', uptime: 3 });
      await app.close();
    });

    it('keeps content-length consistent with the rewritten body', async () => {
      // The body grows by the requestId field; a stale content-length truncates the JSON
      // and the client sees a parse error instead of the failure.
      const app = await build(false);
      app.get('/t', async () => {
        throw new Error('boom');
      });
      const res = await app.inject({ method: 'GET', url: '/t' });
      const declared = res.headers['content-length'];
      if (declared !== undefined) {
        expect(Number(declared)).toBe(Buffer.byteLength(res.body));
      }
      expect(() => JSON.parse(res.body)).not.toThrow();
      await app.close();
    });
  });
});
