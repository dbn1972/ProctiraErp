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

const STAFF_ID = '770e8400-e29b-41d4-a716-446655440002';

async function createProgram(a: FastifyInstance, overrides: Record<string, unknown> = {}) {
  const res = await a.inject({
    method: 'POST',
    url: '/staff/training/programs',
    payload: {
      name: 'Safeguarding',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      certificationValidityDays: 30,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

async function createSession(a: FastifyInstance, programId: string, date = '2026-03-01') {
  const res = await a.inject({
    method: 'POST',
    url: '/staff/training/sessions',
    payload: { programId, title: 'S1', date },
  });
  expect(res.statusCode).toBe(201);
  return res.json().id as string;
}

describe('PRC-L155 training date/time validation', () => {
  it('POST program with impossible date -> 400', async () => {
    const { app: a } = await mount();
    const res = await a.inject({
      method: 'POST',
      url: '/staff/training/programs',
      payload: { name: 'X', startDate: '2026-02-31', endDate: '2026-12-31' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe('startDate');
  });

  it('POST session with date 2026-02-31 -> 400', async () => {
    const { app: a } = await mount();
    const programId = await createProgram(a);
    const res = await a.inject({
      method: 'POST',
      url: '/staff/training/sessions',
      payload: { programId, title: 'S1', date: '2026-02-31' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST session with endTime < startTime -> 400', async () => {
    const { app: a } = await mount();
    const programId = await createProgram(a);
    const res = await a.inject({
      method: 'POST',
      url: '/staff/training/sessions',
      payload: { programId, title: 'S1', date: '2026-03-01', startTime: '14:00', endTime: '09:30' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors[0].field).toBe('endTime');
  });

  it('POST session with malformed time -> 400; valid HH:MM -> 201', async () => {
    const { app: a } = await mount();
    const programId = await createProgram(a);
    const bad = await a.inject({
      method: 'POST',
      url: '/staff/training/sessions',
      payload: { programId, title: 'S1', date: '2026-03-01', startTime: '25:99' },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await a.inject({
      method: 'POST',
      url: '/staff/training/sessions',
      payload: { programId, title: 'S1', date: '2026-03-01', startTime: '09:00', endTime: '10:30' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('leap day only in leap years; certificate dates and asOfDate are calendar-checked', async () => {
    const { app: a } = await mount();
    const programId = await createProgram(a);
    const cert = (issuedDate: string) =>
      a.inject({
        method: 'POST',
        url: '/staff/training/certifications',
        payload: { staffId: STAFF_ID, programId, certificationName: 'C', issuedDate },
      });
    expect((await cert('2026-02-29')).statusCode).toBe(400);
    expect((await cert('2028-02-29')).statusCode).toBe(201);
    const expiry = await a.inject({
      method: 'POST',
      url: '/staff/training/certifications/process-expiry',
      payload: { asOfDate: '2026-13-01' },
    });
    expect(expiry.statusCode).toBe(400);
  });

  it('PG date cast errors map to 400, not 500', async () => {
    const { app: a, service } = await mount();
    const pgErr = Object.assign(new Error('date/time field value out of range'), { code: '22008' });
    service.listPrograms = () => Promise.reject(pgErr);
    service.createProgram = () => Promise.reject(pgErr);
    const res = await a.inject({
      method: 'POST',
      url: '/staff/training/programs',
      payload: { name: 'X', startDate: '2026-01-01', endDate: '2026-02-01' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('PRC-L156 training attendance is insert-once', () => {
  it('concurrent duplicate POSTs: exactly one 201 and one 409', async () => {
    const { app: a } = await mount();
    const programId = await createProgram(a);
    const sessionId = await createSession(a, programId);
    const post = () =>
      a.inject({
        method: 'POST',
        url: '/staff/training/attendance',
        payload: { sessionId, staffId: STAFF_ID, status: 'PRESENT' },
      });
    const codes = (await Promise.all([post(), post()])).map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);
    const list = await a.inject({
      method: 'GET',
      url: `/staff/training/sessions/${sessionId}/attendance`,
    });
    expect(list.json().data).toHaveLength(1);
  });
});
