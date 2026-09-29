import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  InMemoryTimetableRepository,
  TimetableService,
  timetablePlugin,
} from '@proctira/backend-timetable';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '99999999-9999-4999-8999-999999999999';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const sectionA = '44444444-4444-4444-8444-444444444444';
const sectionB = '55555555-5555-4555-8555-555555555555';
const staffA = '66666666-6666-4666-8666-666666666666';

function appFor(
  tenantId: string,
  roles: { roleId: string; roleName: string }[],
  repository: InMemoryTimetableRepository,
) {
  const app = Fastify();
  app.addHook('onRequest', async (request) => {
    const scoped = request as {
      tenantId?: string;
      user?: { tenantId: string; roles: { roleId: string; roleName: string }[] };
    };
    scoped.tenantId = tenantId;
    scoped.user = { tenantId, roles };
  });
  return app.register(timetablePlugin, { repository, prefix: '/api/v1/timetable' }).then(() => app);
}

describe('gateway timetable meetings', () => {
  it('returns 409 when a teacher is already booked, 404 across tenants, and 403 for a teacher role', async () => {
    const repository = new InMemoryTimetableRepository();
    const service = new TimetableService(repository);
    const schedule = await service.createBellSchedule(tenantA, {
      institutionId,
      academicPeriodId,
      name: 'Morning bell',
      code: 'MORNING',
      dayPattern: '1,2,3,4,5,6',
      status: 'active',
    });
    const period = await service.createPeriod(tenantA, {
      bellScheduleId: schedule.id,
      name: 'Period 3',
      periodOrder: 3,
      startTime: '09:20',
      endTime: '10:00',
    });
    const first = await service.createMeeting(tenantA, {
      institutionId,
      academicPeriodId,
      sectionId: sectionA,
      subjectId: null,
      staffId: staffA,
      periodId: period.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
    });

    const principal = await appFor(
      tenantA,
      [{ roleId: 'principal', roleName: 'Principal' }],
      repository,
    );
    await principal.ready();
    const clash = await principal.inject({
      method: 'POST',
      url: '/api/v1/timetable/meetings',
      payload: {
        institutionId,
        academicPeriodId,
        sectionId: sectionB,
        staffId: staffA,
        periodId: period.id,
        dayOfWeek: 1,
      },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: 'TIMETABLE_CLASH' });
    expect(clash.json().conflicts[0]).toMatchObject({ reason: 'staff', sectionId: sectionA });

    const other = await appFor(
      tenantB,
      [{ roleId: 'principal', roleName: 'Principal' }],
      repository,
    );
    await other.ready();
    const missing = await other.inject({
      method: 'DELETE',
      url: `/api/v1/timetable/meetings/${first.id}`,
    });
    expect(missing.statusCode).toBe(404);

    const teacher = await appFor(tenantA, [{ roleId: 'teacher', roleName: 'Teacher' }], repository);
    await teacher.ready();
    const forbidden = await teacher.inject({
      method: 'POST',
      url: '/api/v1/timetable/meetings',
      payload: {
        institutionId,
        academicPeriodId,
        sectionId: sectionB,
        staffId: staffA,
        periodId: period.id,
        dayOfWeek: 2,
      },
    });
    expect(forbidden.statusCode).toBe(403);

    await principal.close();
    await other.close();
    await teacher.close();
  });
});
