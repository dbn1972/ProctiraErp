/**
 * Training routes — HTTP-level validation, pagination bounds, authz and tenant isolation.
 * PRC-L154 / PRC-L155 / PRC-L156 / PRC-L158.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { registerTrainingRoutes } from './training-routes.js';
import { TrainingService, clampTrainingPagination } from './training-service.js';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';

interface Ctx {
  tenantId: string | undefined;
  roles: unknown;
}

let app: FastifyInstance | undefined;

async function mount(initial: Partial<Ctx> = {}) {
  const ctx: Ctx = { tenantId: TENANT_A, roles: ['hr_officer'], ...initial };
  const service = new TrainingService(
    new InMemoryTrainingProgramRepository(),
    new InMemoryTrainingSessionRepository(),
    new InMemoryTrainingAttendanceRepository(),
    new InMemoryCertificationRepository(),
  );
  app = Fastify();
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    const r = request as unknown as { tenantId?: string; user?: { roles: unknown } };
    r.tenantId = ctx.tenantId;
    r.user = { roles: ctx.roles };
  });
  await registerTrainingRoutes(app, { trainingService: service });
  await app.ready();
  return { app, ctx, service };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('PRC-L154 training list pagination bounds', () => {
  const lists = [
    '/staff/training/programs',
    '/staff/training/certifications',
    '/staff/training/programs/880e8400-e29b-41d4-a716-446655440003/sessions',
  ];

  it.each(lists)('GET %s?pageSize=-1 -> 400', async (url) => {
    const { app: a } = await mount();
    const res = await a.inject({ method: 'GET', url: `${url}?pageSize=-1` });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });

  it.each(lists)('GET %s?pageSize=1000 -> 400', async (url) => {
    const { app: a } = await mount();
    const res = await a.inject({ method: 'GET', url: `${url}?pageSize=1000` });
    expect(res.statusCode).toBe(400);
  });

  it.each(lists)('GET %s?page=0 and non-numeric page -> 400', async (url) => {
    const { app: a } = await mount();
    expect((await a.inject({ method: 'GET', url: `${url}?page=0` })).statusCode).toBe(400);
    expect((await a.inject({ method: 'GET', url: `${url}?page=abc` })).statusCode).toBe(400);
  });

  it('valid paging is coerced from the query string', async () => {
    const { app: a } = await mount();
    const res = await a.inject({
      method: 'GET',
      url: '/staff/training/programs?page=2&pageSize=5',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().meta).toMatchObject({ page: 2, pageSize: 5 });
  });

  it('service clamps paging as defense in depth', () => {
    expect(clampTrainingPagination({ page: -3, pageSize: -1 })).toMatchObject({
      page: 1,
      pageSize: 1,
    });
    expect(clampTrainingPagination({ page: 1, pageSize: 1000 })).toMatchObject({ pageSize: 100 });
    expect(clampTrainingPagination({ page: Number.NaN, pageSize: Number.NaN })).toMatchObject({
      page: 1,
      pageSize: 20,
    });
  });
});
