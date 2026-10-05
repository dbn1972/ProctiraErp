/** PRC-M403: atomic capacity check and institution-local enrollment dates. */
import { describe, expect, it } from 'vitest';
import { InMemoryTimetableRepository } from './in-memory-repository.js';
import { TimetableService, calendarDateInZone } from './timetable-service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const institutionId = '22222222-2222-4222-8222-222222222222';
const academicPeriodId = '33333333-3333-4333-8333-333333333333';
const students = Array.from(
  { length: 6 },
  (_, i) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}`,
);

describe('enrollment capacity + dates (PRC-M403)', () => {
  it('concurrent enrolls at capacity-1 yield exactly one success', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Grade 5A',
      capacity: 2,
    });
    await service.enrollStudent(tenantId, section.id, students[0]!);
    const results = await Promise.allSettled(
      students.slice(1).map((s) => service.enrollStudent(tenantId, section.id, s)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const active = (await service.listEnrollments(tenantId, section.id)).filter(
      (e) => e.status === 'ENROLLED',
    );
    expect(active).toHaveLength(2);
  });

  it('re-enrolling a withdrawn student also respects capacity', async () => {
    const service = new TimetableService(new InMemoryTimetableRepository());
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Grade 5B',
      capacity: 1,
    });
    await service.enrollStudent(tenantId, section.id, students[0]!);
    await service.withdrawStudent(tenantId, section.id, students[0]!);
    await service.enrollStudent(tenantId, section.id, students[1]!);
    await expect(service.enrollStudent(tenantId, section.id, students[0]!)).rejects.toThrow(
      /capacity/,
    );
  });

  it('enrolled_at uses the institution timezone across IST midnight', async () => {
    // 2026-04-01T19:00Z is 2026-04-02 00:30 in Asia/Kolkata.
    const instant = new Date('2026-04-01T19:00:00Z');
    const service = new TimetableService(new InMemoryTimetableRepository(), undefined, {
      timeZone: () => 'Asia/Kolkata',
      now: () => instant,
    });
    const section = await service.createSection(tenantId, {
      institutionId,
      academicPeriodId,
      name: 'Grade 6A',
    });
    const row = await service.enrollStudent(tenantId, section.id, students[0]!);
    expect(row?.enrolledAt).toBe('2026-04-02');
    expect(calendarDateInZone(instant, 'UTC')).toBe('2026-04-01');
  });
});
