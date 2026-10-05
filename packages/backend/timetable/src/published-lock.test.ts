/** PRC-M405: published-schedule lock covers periods/bell schedules and meeting moves. */
import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { timetablePlugin } from './timetable-plugin.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffB = '66666666-6666-4666-8666-666666666666';

async function publishedSetup() {
  const service = new TimetableService(new InMemoryTimetableRepository());
  const schedule = await service.createBellSchedule(tenantId, {
    institutionId,
    academicPeriodId,
    name: 'Day',
    code: 'D',
    dayPattern: '1,2,3,4,5',
    status: 'active',
  });
  const period = await service.createPeriod(tenantId, {
    bellScheduleId: schedule.id,
    name: 'P1',
    periodOrder: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const published = await service.createSection(tenantId, {
    institutionId,
    academicPeriodId,
    name: '5A',
  });
  const draft = await service.createSection(tenantId, {
    institutionId,
    academicPeriodId,
    name: '5B',
  });
  await service.createMeeting(tenantId, {
    institutionId,
    academicPeriodId,
    sectionId: published.id,
    subjectId: null,
    staffId: staffA,
    periodId: period.id,
    roomId: null,
    dayOfWeek: 1,
    status: 'active',
  });
  const draftMeeting = await service.createMeeting(tenantId, {
    institutionId,
    academicPeriodId,
    sectionId: draft.id,
    subjectId: null,
    staffId: staffB,
    periodId: period.id,
    roomId: null,
    dayOfWeek: 2,
    status: 'active',
  });
  await service.publishSection(tenantId, published.id);
  return { service, schedule, period, published, draft, draftMeeting };
}

describe('published schedule lock (PRC-M405)', () => {
  it('delete/update of a period used by a published section -> 409', async () => {
    const { service, period } = await publishedSetup();
    await expect(service.deletePeriod(tenantId, period.id)).rejects.toMatchObject({
      statusCode: 409,
    });
    await expect(
      service.updatePeriod(tenantId, period.id, { endTime: '08:50' }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('bell schedule edit/delete is blocked while a published section uses it', async () => {
    const { service, schedule } = await publishedSetup();
    await expect(
      service.updateBellSchedule(tenantId, schedule.id, { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.deleteBellSchedule(tenantId, schedule.id)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('moving a draft meeting into a published section is rejected', async () => {
    const { service, published, draftMeeting } = await publishedSetup();
    await expect(
      service.updateMeeting(tenantId, draftMeeting.id, { sectionId: published.id }),
    ).rejects.toThrow(/locked/i);
  });

  it('PUT bell schedule with institutionId is rejected (400)', async () => {
    const app = Fastify({ logger: false });
    app.addHook('onRequest', async (request) => {
      (request as FastifyRequest & { tenantId?: string }).tenantId = tenantId;
      (request as FastifyRequest & { user: { id: string; roles: string[] } }).user = {
        id: 'a',
        roles: ['admin'],
      };
    });
    await app.register(timetablePlugin, {
      repository: new InMemoryTimetableRepository(),
      prefix: '/timetable',
    });
    const created = await app.inject({
      method: 'POST',
      url: '/timetable/bell-schedules',
      payload: { institutionId, academicPeriodId, name: 'Day' },
    });
    const row = created.json() as { id: string; updatedAt: string };
    const res = await app.inject({
      method: 'PUT',
      url: `/timetable/bell-schedules/${row.id}`,
      headers: { 'if-match': `"${row.updatedAt}"` },
      payload: { institutionId: '99999999-9999-4999-8999-999999999999' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});
