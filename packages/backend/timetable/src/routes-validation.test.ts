/** PRC-M399: ids, times, enums and query params are validated (400), never a PG 500. */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTimetableOpsStore } from './generation-store.js';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';

let app: FastifyInstance;

beforeEach(async () => {
  app = Fastify({ logger: false });
  app.addHook('onRequest', async (request) => {
    (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
    (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
      id: 'actor-1',
      roles: ['admin'],
    };
  });
  await app.register(timetablePlugin, {
    repository: new InMemoryTimetableRepository(),
    // Pin the in-memory ops store: with DATABASE_URL set (integration CI) the default
    // factory picks Postgres, where these fixture ids have no institution rows (FK -> 409).
    opsStore: new InMemoryTimetableOpsStore(),
    prefix: '/timetable',
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe('timetable input validation (PRC-M399)', () => {
  it('POST with a non-UUID id returns 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/timetable/bell-schedules',
      payload: { institutionId: 'abc', academicPeriodId: TERM, name: 'Day' },
    });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    '/timetable/bell-schedules/abc',
    '/timetable/sections/1',
    '/timetable/generation-jobs/x',
  ])('GET %s with a non-UUID path id returns 400', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    '/timetable/sections?status=x',
    '/timetable/meetings?institutionId=abc',
    '/timetable/substitutions?fromDate=2025-02-30',
    '/timetable/attendance-periods?institutionId=' + INST + '&dayOfWeek=9',
  ])('GET %s with an invalid query returns 400', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
  });

  it('rejects 99:99 times and unknown meeting status', async () => {
    const sched = await app.inject({
      method: 'POST',
      url: '/timetable/bell-schedules',
      payload: { institutionId: INST, academicPeriodId: TERM, name: 'Day' },
    });
    expect(sched.statusCode).toBe(201);
    const id = sched.json().id as string;
    const bad = await app.inject({
      method: 'POST',
      url: `/timetable/bell-schedules/${id}/periods`,
      payload: { name: 'P1', periodOrder: 1, startTime: '99:99', endTime: '10:00' },
    });
    expect(bad.statusCode).toBe(400);
    const status = await app.inject({
      method: 'POST',
      url: `/timetable/bell-schedules`,
      payload: { institutionId: INST, academicPeriodId: TERM, name: 'D2', status: 'weird' },
    });
    expect(status.statusCode).toBe(400);
  });

  it('PUT period with merged end < start returns 400; overlapping sibling returns 400', async () => {
    const sched = await app.inject({
      method: 'POST',
      url: '/timetable/bell-schedules',
      payload: { institutionId: INST, academicPeriodId: TERM, name: 'Day' },
    });
    const id = sched.json().id as string;
    const p1 = await app.inject({
      method: 'POST',
      url: `/timetable/bell-schedules/${id}/periods`,
      payload: { name: 'P1', periodOrder: 1, startTime: '09:00', endTime: '09:45' },
    });
    expect(p1.statusCode).toBe(201);
    const p2 = await app.inject({
      method: 'POST',
      url: `/timetable/bell-schedules/${id}/periods`,
      payload: { name: 'P2', periodOrder: 2, startTime: '09:45', endTime: '10:30' },
    });
    expect(p2.statusCode).toBe(201);
    const endBeforeStart = await app.inject({
      method: 'PUT',
      url: `/timetable/periods/${p1.json().id}`,
      headers: { 'if-match': `"${p1.json().updatedAt}"` },
      payload: { endTime: '08:30' },
    });
    expect(endBeforeStart.statusCode).toBe(400);
    const overlap = await app.inject({
      method: 'PUT',
      url: `/timetable/periods/${p2.json().id}`,
      headers: { 'if-match': `"${p2.json().updatedAt}"` },
      payload: { startTime: '09:30' },
    });
    expect(overlap.statusCode).toBe(400);
  });

  it('maps Postgres data errors to 400 instead of 500', async () => {
    const local = Fastify({ logger: false });
    local.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId?: string }).tenantId = TENANT;
      (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
        id: 'a',
        roles: ['admin'],
      };
    });
    const repo = new InMemoryTimetableRepository();
    repo.listBellSchedules = async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    };
    await local.register(timetablePlugin, { repository: repo, prefix: '/timetable' });
    const res = await local.inject({ method: 'GET', url: '/timetable/bell-schedules' });
    expect(res.statusCode).toBe(400);
    await local.close();
  });

  // Review #554: demand subjects are solver grouping keys (codes or UUIDs); e2e spec 50 sends 'math'.
  describe('generation demand subjectId', () => {
    const demandBody = (subjectId: unknown) => ({
      institutionId: INST,
      academicPeriodId: TERM,
      demands: [
        {
          sectionId: '77777777-7777-4777-8777-777777777777',
          subjectId,
          staffId: '55555555-5555-4555-8555-555555555555',
          periodsPerWeek: 1,
        },
      ],
    });

    it.each(['math', 'ENG-101', 'sci_lab.2', '99999999-9999-4999-8999-999999999999'])(
      'accepts subject reference %s',
      async (subjectId) => {
        const res = await app.inject({
          method: 'POST',
          url: '/timetable/generation-jobs',
          payload: demandBody(subjectId),
        });
        // Schema accepts it; the job itself then fails on the (deliberately) missing bell schedule.
        expect(res.statusCode).toBe(201);
        expect(res.json().errorMessage).toMatch(/bell schedule/i);
      },
    );

    it.each(['', ' math', 'math; drop table', '../x', 'a'.repeat(65), 42])(
      'rejects malformed subject reference %j with 400',
      async (subjectId) => {
        const res = await app.inject({
          method: 'POST',
          url: '/timetable/generation-jobs',
          payload: demandBody(subjectId),
        });
        expect(res.statusCode).toBe(400);
      },
    );

    it('still requires UUID section/staff ids on demands', async () => {
      const body = demandBody('math');
      body.demands[0]!.sectionId = 'section-a';
      const res = await app.inject({
        method: 'POST',
        url: '/timetable/generation-jobs',
        payload: body,
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
