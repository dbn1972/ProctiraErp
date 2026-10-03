/** PRC-M404: If-Match is mandatory on PUT; bell/period OCC; publish uses the read version. */
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import { TimetableService } from './timetable-service.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const STAFF = '55555555-5555-4555-8555-555555555555';
const ANY = '5a5a5a5a-0000-4000-8000-000000000001';

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
    prefix: '/timetable',
  });
  await app.ready();
});
afterEach(async () => {
  await app.close();
});

describe('If-Match enforcement (PRC-M404)', () => {
  it.each(['bell-schedules', 'periods', 'meetings', 'sections'])(
    'PUT /%s/:id without If-Match returns 428',
    async (kind) => {
      const res = await app.inject({
        method: 'PUT',
        url: `/timetable/${kind}/${ANY}`,
        payload: { name: 'x' },
      });
      expect(res.statusCode).toBe(428);
    },
  );

  it('stale If-Match on a bell schedule returns 409; fresh ETag succeeds', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/timetable/bell-schedules',
      payload: { institutionId: INST, academicPeriodId: TERM, name: 'Day' },
    });
    const row = created.json() as { id: string; updatedAt: string };
    const ok = await app.inject({
      method: 'PUT',
      url: `/timetable/bell-schedules/${row.id}`,
      headers: { 'if-match': `"${row.updatedAt}"` },
      payload: { name: 'Day v2' },
    });
    expect(ok.statusCode).toBe(200);
    const stale = await app.inject({
      method: 'PUT',
      url: `/timetable/bell-schedules/${row.id}`,
      headers: { 'if-match': `"${row.updatedAt}"` },
      payload: { name: 'Day v3' },
    });
    expect(stale.statusCode).toBe(409);
  });
});

describe('publish carries the section version (PRC-M404)', () => {
  it('a concurrent section edit between read and publish yields 409', async () => {
    const repo = new InMemoryTimetableRepository();
    const service = new TimetableService(repo);
    const schedule = await service.createBellSchedule(TENANT, {
      institutionId: INST,
      academicPeriodId: TERM,
      name: 'Day',
      code: 'D',
      dayPattern: '1,2,3,4,5',
      status: 'active',
    });
    const period = await service.createPeriod(TENANT, {
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const section = await service.createSection(TENANT, {
      institutionId: INST,
      academicPeriodId: TERM,
      name: '5A',
    });
    await service.createMeeting(TENANT, {
      institutionId: INST,
      academicPeriodId: TERM,
      sectionId: section.id,
      subjectId: null,
      staffId: STAFF,
      periodId: period.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
    });
    // Simulate a writer editing the section after publish read it.
    const listMeetings = repo.listMeetings.bind(repo);
    repo.listMeetings = async (t, f) => {
      const rows = await listMeetings(t, f);
      await repo.updateSection(TENANT, section.id, { name: '5A edited' });
      repo.listMeetings = listMeetings;
      return rows;
    };
    await expect(service.publishSection(TENANT, section.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect((await service.getSection(TENANT, section.id))?.status).toBe('DRAFT');
  });
});
