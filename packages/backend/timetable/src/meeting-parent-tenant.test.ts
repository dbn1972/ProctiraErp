/**
 * PR B1 (FKB-091..094, FKB-096): meetings and sections resolve their parent ids
 * (bell period, room, section, subject, default room) inside the caller's tenant.
 * Another tenant's row and an unknown id give the same NotFoundError and nothing
 * is written.
 */
import { NotFoundError } from '@proctira/common';
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService } from './timetable-service.js';

const TENANT_A = '11111111-1111-4111-8111-1111111111aa';
const TENANT_B = '11111111-1111-4111-8111-1111111111bb';
const INST = '22222222-2222-4222-8222-222222222222';
const PERIOD = '33333333-3333-4333-8333-333333333333';
const STAFF = '55555555-5555-4555-8555-555555555555';
const SUBJECT_A = '88888888-8888-4888-8888-8888888888aa';
const SUBJECT_B = '88888888-8888-4888-8888-8888888888bb';
const UNKNOWN = '99999999-9999-4999-8999-999999999999';

function sectionInput(name: string, code: string, defaultRoomId: string | null = null) {
  return {
    institutionId: INST,
    academicPeriodId: PERIOD,
    gradeId: null,
    name,
    code,
    primaryTeacherId: null,
    defaultRoomId,
    capacity: 40,
  };
}

async function tree(service: TimetableService, tenantId: string, code: string) {
  const schedule = await service.createBellSchedule(tenantId, {
    institutionId: INST,
    academicPeriodId: PERIOD,
    name: 'Day',
    code,
    dayPattern: '1,2,3,4,5',
    status: 'active',
  });
  const bell = await service.createPeriod(tenantId, {
    bellScheduleId: schedule.id,
    name: 'P1',
    periodOrder: 1,
    startTime: '08:00',
    endTime: '08:45',
  });
  const room = await service.createRoom(tenantId, {
    institutionId: INST,
    code: `R-${code}`,
    name: 'Room',
    capacity: 30,
    roomType: 'CLASSROOM',
    status: 'active',
  });
  const section = await service.createSection(
    tenantId,
    sectionInput(`Section ${code}`, `S-${code}`),
  );
  return { bellId: bell.id, roomId: room.id, sectionId: section.id };
}

async function setup() {
  const repo = new InMemoryTimetableRepository();
  repo.seedSubject(TENANT_A, SUBJECT_A);
  repo.seedSubject(TENANT_B, SUBJECT_B);
  const service = new TimetableService(repo);
  const a = await tree(service, TENANT_A, 'A');
  const b = await tree(service, TENANT_B, 'B');
  const meeting = (over: Record<string, unknown> = {}) => ({
    institutionId: INST,
    academicPeriodId: PERIOD,
    sectionId: a.sectionId,
    subjectId: SUBJECT_A,
    staffId: STAFF,
    periodId: a.bellId,
    roomId: a.roomId,
    dayOfWeek: 1,
    status: 'active' as const,
    ...over,
  });
  return { repo, service, a, b, meeting };
}

describe('timetable parent ids resolve inside the caller tenant (PR B1)', () => {
  it('own-tenant meeting and section writes still succeed', async () => {
    const { service, a, meeting } = await setup();
    const created = await service.createMeeting(TENANT_A, meeting());
    expect(created.roomId).toBe(a.roomId);
    const section = await service.createSection(
      TENANT_A,
      sectionInput('With room', 'S-ROOM', a.roomId),
    );
    expect(section.defaultRoomId).toBe(a.roomId);
  });

  const meetingCases = [
    ['FKB-091', 'periodId', 'Bell period', 'bellId'],
    ['FKB-092', 'roomId', 'Room', 'roomId'],
    ['FKB-093', 'sectionId', 'Section', 'sectionId'],
  ] as const;
  for (const [finding, field, label, key] of meetingCases) {
    it(`${finding} createMeeting/updateMeeting: other tenant's ${field} and unknown id -> NotFoundError`, async () => {
      const { repo, service, a, b, meeting } = await setup();
      for (const id of [b[key], UNKNOWN]) {
        const create = service.createMeeting(TENANT_A, meeting({ [field]: id }));
        await expect(create).rejects.toBeInstanceOf(NotFoundError);
        await expect(create).rejects.toThrow(`${label} with id '${id}' not found`);
      }
      expect(await repo.listMeetings(TENANT_A)).toEqual([]);

      const existing = await service.createMeeting(TENANT_A, meeting());
      for (const id of [b[key], UNKNOWN]) {
        const update = service.updateMeeting(TENANT_A, existing.id, { [field]: id });
        await expect(update).rejects.toThrow(`${label} with id '${id}' not found`);
      }
      const after = await repo.getMeeting(TENANT_A, existing.id);
      expect(after?.[field]).toBe(a[key]);
    });
  }

  it("FKB-094 createMeeting: other tenant's subject and unknown id -> NotFoundError", async () => {
    const { service, meeting } = await setup();
    for (const id of [SUBJECT_B, UNKNOWN]) {
      await expect(service.createMeeting(TENANT_A, meeting({ subjectId: id }))).rejects.toThrow(
        `Subject with id '${id}' not found`,
      );
    }
  });

  it("FKB-096 createSection/updateSection: other tenant's default room and unknown id -> NotFoundError", async () => {
    const { service, a, b } = await setup();
    for (const id of [b.roomId, UNKNOWN]) {
      await expect(
        service.createSection(TENANT_A, sectionInput('Bad room', `S-${id.slice(0, 4)}`, id)),
      ).rejects.toThrow(`Room with id '${id}' not found`);
      await expect(
        service.updateSection(TENANT_A, a.sectionId, { defaultRoomId: id }),
      ).rejects.toThrow(`Room with id '${id}' not found`);
    }
  });
});
