/**
 * PRC-M174: percentage reports aggregate in the repository (GROUP BY) and
 * cap the date range.
 */
import { AttendanceStatus } from '@proctira/common';
import { describe, expect, it, vi } from 'vitest';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';

async function seed(repo: InMemoryAttendanceRepository, studentId: string, status: AttendanceStatus, date: string) {
  await repo.createStudentAttendance({
    id: `${studentId}-${date}`,
    tenantId: TENANT_ID,
    studentId,
    institutionId: INSTITUTION_ID,
    classId: CLASS_ID,
    academicPeriodId: 'p',
    date,
    subjectId: null,
    periodId: null,
    status,
    comment: null,
    recordedBy: 't',
  });
}

describe('PRC-M174 attendance aggregation', () => {
  it('range > 366 days is rejected with 400', async () => {
    const svc = new AttendanceService(new InMemoryAttendanceRepository());
    await expect(
      svc.calculateAttendancePercentage(TENANT_ID, {
        scope: 'institution',
        institutionId: INSTITUTION_ID,
        startDate: '2023-01-01',
        endDate: '2024-01-02',
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      svc.listStudentAttendanceInRange(TENANT_ID, 's1', '2020-01-01', '2024-01-01'),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('uses the grouped counts and never loads raw rows', async () => {
    const repo = new InMemoryAttendanceRepository();
    await seed(repo, 's1', AttendanceStatus.PRESENT, '2024-06-10');
    await seed(repo, 's1', AttendanceStatus.ABSENT, '2024-06-11');
    await seed(repo, 's2', AttendanceStatus.LATE, '2024-06-10');
    await seed(repo, 's2', AttendanceStatus.EARLY_DEPARTURE, '2024-06-11');
    const rawSpy = vi.spyOn(repo, 'listStudentAttendanceByDateRange');
    const aggSpy = vi.spyOn(repo, 'countStudentAttendanceByStatus');
    const svc = new AttendanceService(repo);
    const res = await svc.calculateAttendancePercentage(TENANT_ID, {
      scope: 'institution',
      institutionId: INSTITUTION_ID,
      startDate: '2024-01-01',
      endDate: '2024-12-31',
    });
    expect(aggSpy).toHaveBeenCalledTimes(1);
    // the in-memory aggregate reuses the list internally; the service must not call it directly
    expect(rawSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(res.totalRecords).toBe(4);
    expect(res.attendancePercentage).toBe(62.5);
    const s2 = res.studentRows?.find((r) => r.studentId === 's2');
    expect(s2).toMatchObject({ lateCount: 1, earlyDepartureCount: 1, attendancePercentage: 75 });
  });
});
