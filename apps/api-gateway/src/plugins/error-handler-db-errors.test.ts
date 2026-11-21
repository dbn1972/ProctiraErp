/**
 * H-D4a / D1-T7: the gateway never returns database internals (SQL text, constraint, table or
 * column names) in a response body, in development (the e2e gateway) or production mode.
 * pg SQLSTATEs map to safe codes and fixed messages, Prisma errors stop echoing
 * `meta.target`/`meta.field_name`, and AppError 5xx keeps its code with a generic message.
 * Mapped and 5xx bodies carry the request correlation id; the details go to the server log.
 */
import { Writable } from 'node:stream';
import { AppError } from '@proctira/common';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import errorHandlerPlugin from './error-handler.js';
const CORRELATION_ID = 'corr-0123456789abcdef';
/** Words that must never reach a client for the synthetic DB errors below. */
const LEAK =
  /constraint|foreign key|_fkey|_key\b|hostel_leaves|\bstudents\b|\brelation\b|\bcolumn\b|violates|transaction is aborted|\bSELECT\b|\bINSERT\b/i;
function pgError(fields: {
  code: string;
  message: string;
  constraint?: string;
  table?: string;
  detail?: string;
  column?: string;
}): Error {
  // Same shape as pg-protocol's DatabaseError (name 'error', severity, code, detail…).
  return Object.assign(new Error(fields.message), { name: 'error', severity: 'ERROR', ...fields });
}
const FK_INSERT = () =>
  pgError({
    code: '23503',
    message:
      'insert or update on table "hostel_leaves" violates foreign key constraint "hostel_leaves_student_id_fkey"',
    constraint: 'hostel_leaves_student_id_fkey',
    table: 'hostel_leaves',
    detail: 'Key (student_id)=(7d2c) is not present in table "students".',
  });
const FK_DELETE = () =>
  pgError({
    code: '23503',
    message:
      'update or delete on table "students" violates foreign key constraint "hostel_leaves_student_id_fkey" on table "hostel_leaves"',
    constraint: 'hostel_leaves_student_id_fkey',
    table: 'hostel_leaves',
    detail: 'Key (id)=(7d2c) is still referenced from table "hostel_leaves".',
  });
const UNIQUE = () =>
  pgError({
    code: '23505',
    message: 'duplicate key value violates unique constraint "tenants_slug_key"',
    constraint: 'tenants_slug_key',
    table: 'tenants',
    detail: 'Key (slug)=(x) already exists.',
  });
interface Case {
  name: string;
  error: () => Error;
  status: number;
  code: string;
  message: string;
}
const CASES: Case[] = [
  {
    name: '23503 on insert (missing parent)',
    error: FK_INSERT,
    status: 422,
    code: 'REFERENCE_NOT_FOUND',
    message: 'A referenced record does not exist.',
  },
  {
    name: '23503 on delete (row still referenced)',
    error: FK_DELETE,
    status: 409,
    code: 'REFERENCE_IN_USE',
    message: 'This record is still in use.',
  },
  {
    name: '23505 unique violation',
    error: UNIQUE,
    status: 409,
    code: 'CONFLICT',
    message: 'A record with these details already exists.',
  },
  ...(['23502', '23514', '22P02', '22001', '22007', '22008'] as const).map((code) => ({
    name: `${code} invalid value`,
    error: () =>
      pgError({
        code,
        message: `null value in column "student_id" of relation "hostel_leaves" (${code})`,
        column: 'student_id',
        table: 'hostel_leaves',
      }),
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'The request contains an invalid value.',
  })),
  {
    name: '25P02 aborted transaction',
    error: () =>
      pgError({
        code: '25P02',
        message: 'current transaction is aborted, commands ignored until end of transaction block',
      }),
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  {
    name: '42703 undefined column (unmapped SQLSTATE)',
    error: () =>
      pgError({ code: '42703', message: 'column "x" of relation "students" does not exist' }),
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  {
    name: 'pg error wrapped as the cause of a plain Error',
    error: () => new Error('save failed', { cause: FK_INSERT() }),
    status: 422,
    code: 'REFERENCE_NOT_FOUND',
    message: 'A referenced record does not exist.',
  },
  {
    name: 'Prisma P2002',
    error: () =>
      Object.assign(new Error('Unique constraint failed on the fields: (`slug`)'), {
        name: 'PrismaClientKnownRequestError',
        code: 'P2002',
        meta: { target: ['tenants_slug_key'] },
      }),
    status: 409,
    code: 'CONFLICT',
    message: 'A record with these details already exists.',
  },
  {
    name: 'Prisma P2003',
    error: () =>
      Object.assign(
        new Error('Foreign key constraint failed on the field: `hostel_leaves_student_id_fkey`'),
        {
          name: 'PrismaClientKnownRequestError',
          code: 'P2003',
          meta: { field_name: 'hostel_leaves_student_id_fkey (index)' },
        },
      ),
    status: 400,
    code: 'VALIDATION_ERROR',
    message: 'A related record does not exist or is still in use.',
  },
  {
    name: 'Prisma P2010 raw query failure carrying a SQLSTATE',
    error: () =>
      Object.assign(
        new Error(
          'Raw query failed. Code: `23503`. Message: `insert or update on table "hostel_leaves" violates foreign key constraint "hostel_leaves_student_id_fkey"`',
        ),
        {
          name: 'PrismaClientKnownRequestError',
          code: 'P2010',
          meta: {
            code: '23503',
            message: 'violates foreign key constraint "hostel_leaves_student_id_fkey"',
          },
        },
      ),
    status: 422,
    code: 'REFERENCE_NOT_FOUND',
    message: 'A referenced record does not exist.',
  },
  {
    name: 'PrismaClientUnknownRequestError',
    error: () =>
      Object.assign(
        new Error('Invalid `prisma.student.create()` invocation: relation "students" ...'),
        {
          name: 'PrismaClientUnknownRequestError',
        },
      ),
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
  {
    name: 'plain Error whose text carries pg violation wording',
    error: () =>
      new Error('save failed: duplicate key value violates unique constraint "tenants_slug_key"'),
    status: 500,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  },
];
interface Harness {
  app: FastifyInstance;
  logs: string[];
}
async function harness(includeStackTrace: boolean, error: () => Error): Promise<Harness> {
  const logs: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, done) {
      logs.push(String(chunk));
      done();
    },
  });
  const app = Fastify({ logger: { level: 'error', stream } });
  // Same field the logging plugin sets from x-correlation-id.
  app.decorateRequest('correlationId', '');
  app.addHook('onRequest', async (request) => {
    (request as unknown as { correlationId: string }).correlationId = CORRELATION_ID;
  });
  await app.register(errorHandlerPlugin, { includeStackTrace });
  app.post('/write', async () => {
    throw error();
  });
  await app.ready();
  return { app, logs };
}
let open: FastifyInstance | null = null;
afterEach(async () => {
  await open?.close();
  open = null;
});
describe.each([
  ['development (includeStackTrace)', true],
  ['production', false],
])('database errors in %s mode (H-D4a)', (_mode, includeStackTrace) => {
  it.each(CASES)('$name → $status $code with no DB text', async (c) => {
    const { app } = await harness(includeStackTrace, c.error);
    open = app;
    const response = await app.inject({ method: 'POST', url: '/write' });
    expect(response.body).not.toMatch(LEAK);
    expect(response.statusCode).toBe(c.status);
    const body = response.json();
    expect(body).toEqual({
      code: c.code,
      message: c.message,
      statusCode: c.status,
      correlationId: CORRELATION_ID,
    });
  });
});
describe('AppError 5xx (D1-T7)', () => {
  it.each([true, false])(
    'keeps the code and replaces the message (includeStackTrace=%s)',
    async (includeStackTrace) => {
      const { app } = await harness(
        includeStackTrace,
        () =>
          new AppError(
            'relation "report_card_subject_lines" does not exist',
            'REPORT_STORE_DOWN',
            503,
            [{ field: 'sql', message: 'SELECT * FROM report_card_subject_lines', rule: 'db' }],
          ),
      );
      open = app;
      const response = await app.inject({ method: 'POST', url: '/write' });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        code: 'REPORT_STORE_DOWN',
        message: 'Internal server error',
        statusCode: 503,
        correlationId: CORRELATION_ID,
      });
    },
  );
  it('leaves 4xx AppError messages unchanged', async () => {
    const { app } = await harness(
      true,
      () => new AppError('Leave dates overlap', 'LEAVE_OVERLAP', 422),
    );
    open = app;
    const response = await app.inject({ method: 'POST', url: '/write' });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 'LEAVE_OVERLAP',
      message: 'Leave dates overlap',
    });
  });
});
describe('server-side detail and correlation id', () => {
  it('logs SQLSTATE, constraint and table for a mapped pg error', async () => {
    const { app, logs } = await harness(false, FK_INSERT);
    open = app;
    await app.inject({ method: 'POST', url: '/write' });
    const line = logs.join('\n');
    expect(line).toContain('hostel_leaves_student_id_fkey');
    expect(line).toContain('"pgCode":"23503"');
    expect(line).toContain('"pgTable":"hostel_leaves"');
  });
  it('falls back to the Fastify request id when no correlation id is set', async () => {
    const app = Fastify();
    open = app;
    await app.register(errorHandlerPlugin);
    app.post('/write', async () => {
      throw UNIQUE();
    });
    const response = await app.inject({ method: 'POST', url: '/write' });
    const body = response.json() as { correlationId?: unknown };
    expect(typeof body.correlationId).toBe('string');
    expect((body.correlationId as string).length).toBeGreaterThan(0);
  });
});

describe('route-local 5xx bodies (D1-T7)', () => {
  async function routeApp(includeStackTrace: boolean): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorateRequest('correlationId', '');
    app.addHook('onRequest', async (request) => {
      (request as unknown as { correlationId: string }).correlationId = CORRELATION_ID;
    });
    await app.register(errorHandlerPlugin, { includeStackTrace });
    // Same shape as the ~400 package handlers that send `error.toJSON()` themselves.
    app.get('/route-local-503', async (_request, reply) =>
      reply
        .status(503)
        .send(
          new AppError(
            'Dashboard query failed: relation "parent_fee_invoices" does not exist',
            'REPORT_DATA_UNAVAILABLE',
            503,
          ).toJSON(),
        ),
    );
    app.get('/route-local-502', async (_request, reply) =>
      reply
        .status(502)
        .send({ code: 'BAD_GATEWAY', message: "Service 'auth' is unreachable.", statusCode: 502 }),
    );
    app.get('/route-local-409', async (_request, reply) =>
      reply.status(409).send({ code: 'CONFLICT', message: 'Name taken', statusCode: 409 }),
    );
    app.get('/plain-error', async () => {
      throw new Error('Detailed error message');
    });
    await app.ready();
    return app;
  }
  it.each([true, false])(
    'replaces the message of a JSON 5xx sent by a route (includeStackTrace=%s)',
    async (includeStackTrace) => {
      const app = await routeApp(includeStackTrace);
      open = app;
      const res = await app.inject({ method: 'GET', url: '/route-local-503' });
      expect(res.statusCode).toBe(503);
      expect(res.body).not.toMatch(LEAK);
      expect(res.json()).toMatchObject({
        code: 'REPORT_DATA_UNAVAILABLE',
        message: 'Internal server error',
        statusCode: 503,
        correlationId: CORRELATION_ID,
      });
    },
  );
  it('leaves authored 5xx text without database wording unchanged', async () => {
    const app = await routeApp(true);
    open = app;
    const res = await app.inject({ method: 'GET', url: '/route-local-502' });
    expect(res.json()).toEqual({
      code: 'BAD_GATEWAY',
      message: "Service 'auth' is unreachable.",
      statusCode: 502,
    });
  });
  it('leaves 4xx route bodies unchanged', async () => {
    const app = await routeApp(true);
    open = app;
    const res = await app.inject({ method: 'GET', url: '/route-local-409' });
    expect(res.json()).toEqual({ code: 'CONFLICT', message: 'Name taken', statusCode: 409 });
  });
  it('keeps the development debug message of a plain error the handler produced', async () => {
    const app = await routeApp(true);
    open = app;
    const res = await app.inject({ method: 'GET', url: '/plain-error' });
    expect(res.json()).toMatchObject({ message: 'Detailed error message', statusCode: 500 });
  });
});
