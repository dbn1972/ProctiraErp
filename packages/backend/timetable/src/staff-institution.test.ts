/**
 * PRC-M101 — meetings and substitutions refuse staff from another institution
 * of the same tenant when the membership check is wired.
 */
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const instA = '22222222-2222-4222-8222-222222222222';
const instB = '23232323-2323-4323-8323-232323232323';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffA2 = '57575757-5757-4757-8757-575757575757';
const staffB = '66666666-6666-4666-8666-666666666666';
const sectionA = '77777777-7777-4777-8777-777777777777';

const membership: Record<string, string> = { [staffA]: instA, [staffA2]: instA, [staffB]: instB };

async function setup() {
  const service = new TimetableService(new InMemoryTimetableRepository(), undefined, {
    staffBelongsToInstitution: async (_t, staffId, institutionId) =>
      membership[staffId] === institutionId,
  });
  const schedule = await service.createBellSchedule(tenantId, {
    institutionId: instA,
    academicPeriodId,
    name: 'Day',
    code: 'DAY',
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
  const meeting = (staffId: string) => ({
    institutionId: instA,
    academicPeriodId,
    sectionId: sectionA,
    subjectId: null,
    staffId,
    periodId: period.id,
    roomId: null,
    dayOfWeek: 1,
    status: 'active' as const,
  });
  return { service, meeting };
}

describe('timetable staff institution membership (PRC-M101)', () => {
  it("rejects a meeting for another institution's staff (4xx ValidationError)", async () => {
    const { service, meeting } = await setup();
    await expect(service.createMeeting(tenantId, meeting(staffB))).rejects.toMatchObject({
      statusCode: 400,
      message: 'Staff member is not assigned to this institution',
    });
  });

  it('accepts own staff and rejects re-assigning the meeting to foreign staff', async () => {
    const { service, meeting } = await setup();
    const row = await service.createMeeting(tenantId, meeting(staffA));
    await expect(service.updateMeeting(tenantId, row.id, { staffId: staffB })).rejects.toThrow(
      /not assigned to this institution/,
    );
  });

  it('rejects a substitute from another institution, accepts one from the same', async () => {
    const { service, meeting } = await setup();
    const row = await service.createMeeting(tenantId, meeting(staffA));
    await expect(
      service.createSubstitution(tenantId, {
        sectionMeetingId: row.id,
        substituteStaffId: staffB,
        substitutionDate: '2026-09-07',
      }),
    ).rejects.toThrow(/not assigned to this institution/);
    await expect(
      service.createSubstitution(tenantId, {
        sectionMeetingId: row.id,
        substituteStaffId: staffA2,
        substitutionDate: '2026-09-07',
      }),
    ).resolves.toMatchObject({ substituteStaffId: staffA2 });
  });
});
