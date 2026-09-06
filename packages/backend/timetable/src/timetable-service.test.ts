import { describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableClashError } from './timetable-errors.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffB = '66666666-6666-4666-8666-666666666666';
const sectionA = '77777777-7777-4777-8777-777777777777';
const sectionB = '88888888-8888-4888-8888-888888888888';

describe('TimetableService', () => {
  it('CRUD bell schedule + periods', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Standard day',
      code: 'STD',
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
    expect(period.bellScheduleId).toBe(schedule.id);
    const listed = await service.listPeriods(tenantId, schedule.id);
    expect(listed).toHaveLength(1);
  });

  it('rejects teacher double-book with TIMETABLE_CLASH (409 semantics)', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'DAY1',
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

    await service.createMeeting(tenantId, {
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

    await expect(
      service.createMeeting(tenantId, {
        institutionId,
        academicPeriodId,
        sectionId: sectionB,
        subjectId: null,
        staffId: staffA,
        periodId: period.id,
        roomId: null,
        dayOfWeek: 1,
        status: 'active',
      }),
    ).rejects.toBeInstanceOf(TimetableClashError);
  });

  it('rejects substitute clash when substitute already teaches that slot', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'DAY2',
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

    const meetingA = await service.createMeeting(tenantId, {
      institutionId,
      academicPeriodId,
      sectionId: sectionA,
      subjectId: null,
      staffId: staffA,
      periodId: period.id,
      roomId: null,
      dayOfWeek: 2,
      status: 'active',
    });
    await service.createMeeting(tenantId, {
      institutionId,
      academicPeriodId,
      sectionId: sectionB,
      subjectId: null,
      staffId: staffB,
      periodId: period.id,
      roomId: null,
      dayOfWeek: 2,
      status: 'active',
    });

    await expect(
      service.createSubstitution(tenantId, {
        sectionMeetingId: meetingA.id,
        substituteStaffId: staffB,
        substitutionDate: '2026-09-08',
      }),
    ).rejects.toMatchObject({ code: 'TIMETABLE_CLASH' });
  });
});
