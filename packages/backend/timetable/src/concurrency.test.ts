import { describe, expect, it } from 'vitest';

import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableVersionConflictError, normalizeIfMatchToken } from './timetable-errors.js';
import { TimetableService } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const staffA = '55555555-5555-4555-8555-555555555555';
const staffB = '66666666-6666-4666-8666-666666666666';

describe('timetable optimistic concurrency (P1-TT)', () => {
  it('normalizeIfMatchToken strips weak tags and quotes', () => {
    expect(normalizeIfMatchToken('"2026-09-12T12:00:00.000Z"')).toBe('2026-09-12T12:00:00.000Z');
    expect(normalizeIfMatchToken('W/"2026-09-12T12:00:00.000Z"')).toBe('2026-09-12T12:00:00.000Z');
    expect(normalizeIfMatchToken('  ')).toBeUndefined();
  });

  it('section update with stale If-Match → VERSION_CONFLICT (409)', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: '9-A',
      code: '9A',
    });

    const first = await service.updateSection(
      tenantId,
      section.id,
      { name: '9-A Morning' },
      { expectedUpdatedAt: section.updatedAt },
    );
    expect(first?.name).toBe('9-A Morning');
    expect(first!.updatedAt).not.toBe(section.updatedAt);

    await expect(
      service.updateSection(
        tenantId,
        section.id,
        { name: 'stale writer' },
        { expectedUpdatedAt: section.updatedAt },
      ),
    ).rejects.toMatchObject({
      code: 'VERSION_CONFLICT',
      statusCode: 409,
      entityType: 'section',
    });

    const current = await service.getSection(tenantId, section.id);
    expect(current?.name).toBe('9-A Morning');
  });

  it('meeting update with matching token succeeds; stale token conflicts', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const schedule = await service.createBellSchedule(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Day',
      code: 'DAY',
      dayPattern: '1,2,3,4,5',
    });
    const period = await service.createPeriod(tenantId, {
      bellScheduleId: schedule.id,
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: '9-B',
      code: '9B',
    });
    const meeting = await service.createMeeting(tenantId, {
      institutionId,
      academicPeriodId,
      sectionId: section.id,
      staffId: staffA,
      periodId: period.id,
      dayOfWeek: 1,
      roomId: null,
    });

    const ok = await service.updateMeeting(
      tenantId,
      meeting.id,
      { staffId: staffB },
      { expectedUpdatedAt: meeting.updatedAt },
    );
    expect(ok?.staffId).toBe(staffB);

    await expect(
      service.updateMeeting(
        tenantId,
        meeting.id,
        { staffId: staffA },
        { expectedUpdatedAt: meeting.updatedAt },
      ),
    ).rejects.toBeInstanceOf(TimetableVersionConflictError);

    const again = await service.getMeeting(tenantId, meeting.id);
    expect(again?.staffId).toBe(staffB);
  });

  it('omitting If-Match remains backward-compatible (last write wins)', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: '10-A',
      code: '10A',
    });
    const updated = await service.updateSection(tenantId, section.id, { name: '10-A Revised' });
    expect(updated?.name).toBe('10-A Revised');
  });
});
