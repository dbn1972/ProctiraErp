/**
 * PRC-H040: student_attendance has a single-row identity per
 * (tenant, student, class, date, subject, period). The DB enforces this via a
 * COALESCE unique index (db/sql/123) and the repository returns the existing
 * row on a duplicate create. This test asserts the repository contract that the
 * pg layer and the DB index back.
 */
import { AttendanceStatus } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { InMemoryAttendanceRepository } from './in-memory-repository.js';

const TENANT = 'tenant-h040';
const INSTITUTION = '11111111-1111-4111-8111-111111111111';
const CLASS = '22222222-2222-4222-8222-222222222222';
const STUDENT = '33333333-3333-4333-8333-333333333333';
const PERIOD = '55555555-5555-4555-8555-555555555555';

function row(
  overrides: Partial<Parameters<InMemoryAttendanceRepository['createStudentAttendance']>[0]> = {},
) {
  return {
    id: overrides.id ?? '44444444-4444-4444-8444-444444444441',
    tenantId: TENANT,
    studentId: STUDENT,
    institutionId: INSTITUTION,
    classId: CLASS,
    academicPeriodId: PERIOD,
    date: '2024-06-15',
    subjectId: null,
    periodId: null,
    status: AttendanceStatus.PRESENT,
    comment: null,
    recordedBy: 'teacher-1',
    ...overrides,
  };
}

describe('student_attendance identity (PRC-H040)', () => {
  it('a duplicate create returns the existing row (no second record)', async () => {
    const repo = new InMemoryAttendanceRepository();
    const first = await repo.createStudentAttendance(
      row({ id: '44444444-4444-4444-8444-444444444441' }),
    );
    const second = await repo.createStudentAttendance(
      row({ id: '44444444-4444-4444-8444-444444444442', status: AttendanceStatus.ABSENT }),
    );
    // Same identity → same row returned, not a conflicting duplicate.
    expect(second.id).toBe(first.id);
    expect(repo.getStudentAttendanceRecords()).toHaveLength(1);
  });

  it('allows the same student/date in a different tenant (tenant-scoped identity)', async () => {
    const repo = new InMemoryAttendanceRepository();
    await repo.createStudentAttendance(row({ id: '44444444-4444-4444-8444-444444444441' }));
    const other = await repo.createStudentAttendance(
      row({ id: '44444444-4444-4444-8444-444444444443', tenantId: 'tenant-other' }),
    );
    expect(other.tenantId).toBe('tenant-other');
    expect(repo.getStudentAttendanceRecords()).toHaveLength(2);
  });

  it('treats differing subject/period as distinct rows', async () => {
    const repo = new InMemoryAttendanceRepository();
    await repo.createStudentAttendance(row({ id: '44444444-4444-4444-8444-444444444441' }));
    const perSubject = await repo.createStudentAttendance(
      row({
        id: '44444444-4444-4444-8444-444444444444',
        subjectId: '66666666-6666-4666-8666-666666666666',
      }),
    );
    expect(perSubject.subjectId).toBe('66666666-6666-4666-8666-666666666666');
    expect(repo.getStudentAttendanceRecords()).toHaveLength(2);
  });
});
