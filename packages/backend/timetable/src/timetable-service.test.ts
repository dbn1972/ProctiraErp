import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService } from './timetable-service.js';
import { TimetableClashError } from './timetable-clash-error.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const periodId = '33333333-3333-4333-8333-333333333333';
const subjectId = '44444444-4444-4444-8444-444444444444';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffB = '66666666-6666-4666-8666-666666666666';
const classA = '77777777-7777-4777-8777-777777777777';
const classB = '88888888-8888-4888-8888-888888888888';
const roomA = '99999999-9999-4999-8999-999999999999';

function slotInput(overrides: Record<string, unknown> = {}) {
  return {
    institutionId,
    classId: classA,
    subjectId,
    staffId: staffA,
    bellPeriodId: periodId,
    roomId: null as string | null,
    dayOfWeek: 1,
    status: 'active',
    ...overrides,
  };
}

describe('TimetableService', () => {
  it('creates and lists BellPeriod', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const created = await service.createBellPeriod(tenantId, {
      institutionId,
      name: 'sample',
      periodOrder: 1,
      startTime: 'sample',
      endTime: 'sample',
    } as any);
    expect(created.id).toBeTruthy();
    const rows = await service.listBellPeriods(tenantId);
    expect(rows).toHaveLength(1);
  });

  it('rejects staff clash on same day and bell period', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    await service.createTimetableSlot(tenantId, slotInput({ classId: classA, staffId: staffA }));

    await expect(
      service.createTimetableSlot(
        tenantId,
        slotInput({ classId: classB, staffId: staffA, roomId: null }),
      ),
    ).rejects.toMatchObject({
      code: 'TIMETABLE_CLASH',
      conflicts: expect.arrayContaining([
        expect.objectContaining({ reason: 'staff', staffId: staffA }),
      ]),
    });

    try {
      await service.createTimetableSlot(
        tenantId,
        slotInput({ classId: classB, staffId: staffA }),
      );
      expect.unreachable('expected clash');
    } catch (error) {
      expect(error).toBeInstanceOf(TimetableClashError);
      expect((error as Error).message.startsWith('TIMETABLE_CLASH:')).toBe(true);
    }
  });

  it('rejects class clash on same day and bell period', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    await service.createTimetableSlot(tenantId, slotInput({ classId: classA, staffId: staffA }));

    await expect(
      service.createTimetableSlot(
        tenantId,
        slotInput({ classId: classA, staffId: staffB }),
      ),
    ).rejects.toMatchObject({
      code: 'TIMETABLE_CLASH',
      conflicts: expect.arrayContaining([
        expect.objectContaining({ reason: 'class', classId: classA }),
      ]),
    });
  });

  it('rejects room clash when roomId is set', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    await service.createTimetableSlot(
      tenantId,
      slotInput({ classId: classA, staffId: staffA, roomId: roomA }),
    );

    await expect(
      service.createTimetableSlot(
        tenantId,
        slotInput({ classId: classB, staffId: staffB, roomId: roomA }),
      ),
    ).rejects.toMatchObject({
      code: 'TIMETABLE_CLASH',
      conflicts: expect.arrayContaining([
        expect.objectContaining({ reason: 'room', roomId: roomA }),
      ]),
    });
  });

  it('allows same staff on a different day or period', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    await service.createTimetableSlot(tenantId, slotInput({ dayOfWeek: 1 }));
    const otherDay = await service.createTimetableSlot(
      tenantId,
      slotInput({ dayOfWeek: 2, classId: classB }),
    );
    expect(otherDay.id).toBeTruthy();
  });

  it('rejects clash on update', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    await service.createTimetableSlot(
      tenantId,
      slotInput({ classId: classA, staffId: staffA, dayOfWeek: 1 }),
    );
    const second = await service.createTimetableSlot(
      tenantId,
      slotInput({ classId: classB, staffId: staffB, dayOfWeek: 2 }),
    );

    await expect(
      service.updateTimetableSlot(tenantId, second.id, {
        dayOfWeek: 1,
        staffId: staffA,
        classId: classB,
      }),
    ).rejects.toMatchObject({ code: 'TIMETABLE_CLASH' });
  });
});
