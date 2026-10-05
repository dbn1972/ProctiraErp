/** PRC-M398: clash detection by time overlap across bell schedules, scoped to academic period. */
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableClashError } from './timetable-errors.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const termA = '33333333-3333-4333-8333-333333333333';
const termB = '44444444-4444-4444-8444-444444444444';
const staff = '55555555-5555-4555-8555-555555555555';
const sectionA = '77777777-7777-4777-8777-777777777777';
const sectionB = '88888888-8888-4888-8888-888888888888';

async function setup() {
  const service = new TimetableService(new InMemoryTimetableRepository());
  const juniors = await service.createBellSchedule(tenantId, {
    institutionId,
    academicPeriodId: termA,
    name: 'Juniors',
    code: 'JR',
    dayPattern: '1,2,3,4,5',
    status: 'active',
  });
  const seniors = await service.createBellSchedule(tenantId, {
    institutionId,
    academicPeriodId: termA,
    name: 'Seniors',
    code: 'SR',
    dayPattern: '1,2,3,4,5',
    status: 'active',
  });
  const jr1 = await service.createPeriod(tenantId, {
    bellScheduleId: juniors.id,
    name: 'P1',
    periodOrder: 1,
    startTime: '09:00',
    endTime: '09:45',
  });
  const sr1 = await service.createPeriod(tenantId, {
    bellScheduleId: seniors.id,
    name: 'P1',
    periodOrder: 1,
    startTime: '09:30',
    endTime: '10:15',
  });
  const sr2 = await service.createPeriod(tenantId, {
    bellScheduleId: seniors.id,
    name: 'P2',
    periodOrder: 2,
    startTime: '10:15',
    endTime: '11:00',
  });
  await service.createMeeting(tenantId, {
    institutionId,
    academicPeriodId: termA,
    sectionId: sectionA,
    subjectId: null,
    staffId: staff,
    periodId: jr1.id,
    roomId: null,
    dayOfWeek: 1,
    status: 'active',
  });
  return { service, jr1, sr1, sr2 };
}

describe('time-overlap clash detection (PRC-M398)', () => {
  it('overlapping times with a different period id clash (409)', async () => {
    const { service, sr1 } = await setup();
    await expect(
      service.createMeeting(tenantId, {
        institutionId,
        academicPeriodId: termA,
        sectionId: sectionB,
        subjectId: null,
        staffId: staff,
        periodId: sr1.id,
        roomId: null,
        dayOfWeek: 1,
        status: 'active',
      }),
    ).rejects.toBeInstanceOf(TimetableClashError);
  });

  it('non-overlapping period in another bell schedule is allowed', async () => {
    const { service, sr2 } = await setup();
    const row = await service.createMeeting(tenantId, {
      institutionId,
      academicPeriodId: termA,
      sectionId: sectionB,
      subjectId: null,
      staffId: staff,
      periodId: sr2.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
    });
    expect(row.id).toBeTruthy();
  });

  it('same teacher + same slot in a different academic period is allowed', async () => {
    const { service, jr1 } = await setup();
    const row = await service.createMeeting(tenantId, {
      institutionId,
      academicPeriodId: termB,
      sectionId: sectionB,
      subjectId: null,
      staffId: staff,
      periodId: jr1.id,
      roomId: null,
      dayOfWeek: 1,
      status: 'active',
    });
    expect(row.academicPeriodId).toBe(termB);
  });
});
