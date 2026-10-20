/**
 * PRC-M173: leave approval previously marked an unbounded EXCUSED range —
 * no academic-period bound, no future-date cap, and it silently overwrote
 * confirmed PRESENT/LATE rows. This file covers the four determined
 * sub-fixes in AttendanceOpsService.decideLeave / excusedDayOp.
 */
import { AttendanceStatus } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';
const PARENT = { userId: 'parent-1', roles: ['parent'] };
const APPROVER = { userId: 'principal-1', roles: ['principal'] };

function seedPeriod(
  repo: InMemoryAttendanceRepository,
  startDate: string,
  endDate: string,
): void {
  repo.addAcademicPeriod({
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'AY',
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    status: 'active',
  });
}

describe('PRC-M173 part 1: leave EXCUSED range is bound to the academic period', () => {
  it('writes no EXCUSED row past the academic period end date', async () => {
    const repo = new InMemoryAttendanceRepository();
    // Period ends 2024-06-12 (a Wednesday); the leave requests through Friday.
    seedPeriod(repo, '2024-01-01', '2024-06-12');
    const ops = new AttendanceOpsService(new InMemoryAttendanceOpsStore(), repo);
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-14',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const rows = repo.getStudentAttendanceRecords();
    expect(rows.every((r) => r.date <= '2024-06-12')).toBe(true);
    expect(rows.some((r) => r.date === '2024-06-13' || r.date === '2024-06-14')).toBe(false);
  });
});

describe('PRC-M173 part 2: future-date cap via injectable clock', () => {
  it('only marks past/today dates EXCUSED, never future ones', async () => {
    const repo = new InMemoryAttendanceRepository();
    seedPeriod(repo, '2024-01-01', '2024-12-31');
    // Injected "today" is 2024-06-11 (Tuesday); leave range extends to Friday.
    const ops = new AttendanceOpsService(
      new InMemoryAttendanceOpsStore(),
      repo,
      {},
      { now: () => new Date('2024-06-11T12:00:00Z') },
    );
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-14',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const rows = repo.getStudentAttendanceRecords();
    expect(rows.every((r) => r.date <= '2024-06-11')).toBe(true);
    expect(rows.some((r) => r.date === '2024-06-12')).toBe(false);
  });
});

describe('PRC-M173 part 3: PRESENT/LATE rows are protected (failing-first, data integrity)', () => {
  let repo: InMemoryAttendanceRepository;
  let ops: AttendanceOpsService;

  beforeEach(() => {
    repo = new InMemoryAttendanceRepository();
    seedPeriod(repo, '2024-01-01', '2024-12-31');
    ops = new AttendanceOpsService(new InMemoryAttendanceOpsStore(), repo);
  });

  it('does not overwrite a PRESENT row inside the approved leave range', async () => {
    await repo.createStudentAttendance({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: '2024-06-11',
      subjectId: null,
      periodId: null,
      status: AttendanceStatus.PRESENT,
      comment: 'attended despite later-approved leave',
      recordedBy: 'teacher-1',
    });
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const row = repo
      .getStudentAttendanceRecords()
      .find((r) => r.date === '2024-06-11' && r.studentId === STUDENT_ID);
    // Failing-first: before this fix, excusedDayOp unconditionally overwrote
    // any existing row to EXCUSED regardless of its current status.
    expect(row?.status).toBe(AttendanceStatus.PRESENT);
  });

  it('does not overwrite a LATE row inside the approved leave range', async () => {
    await repo.createStudentAttendance({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: '2024-06-11',
      subjectId: null,
      periodId: null,
      status: AttendanceStatus.LATE,
      comment: null,
      recordedBy: 'teacher-1',
    });
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const row = repo
      .getStudentAttendanceRecords()
      .find((r) => r.date === '2024-06-11' && r.studentId === STUDENT_ID);
    expect(row?.status).toBe(AttendanceStatus.LATE);
  });

  it('still overwrites an ABSENT row to EXCUSED (unchanged behavior)', async () => {
    await repo.createStudentAttendance({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: '2024-06-11',
      subjectId: null,
      periodId: null,
      status: AttendanceStatus.ABSENT,
      comment: null,
      recordedBy: 'teacher-1',
    });
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const row = repo
      .getStudentAttendanceRecords()
      .find((r) => r.date === '2024-06-11' && r.studentId === STUDENT_ID);
    expect(row?.status).toBe(AttendanceStatus.EXCUSED);
  });
});

describe('PRC-M173 part 4: optional holidayLookup (disabled by default)', () => {
  it('skips EXCUSED writes for dates the holidayLookup reports, leaves siblings intact', async () => {
    const repo = new InMemoryAttendanceRepository();
    seedPeriod(repo, '2024-01-01', '2024-12-31');
    const ops = new AttendanceOpsService(
      new InMemoryAttendanceOpsStore(),
      repo,
      {},
      {
        holidayLookup: async () => new Set(['2024-06-11']),
      },
    );
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    const dates = repo.getStudentAttendanceRecords().map((r) => r.date);
    expect(dates).not.toContain('2024-06-11');
    expect(dates).toContain('2024-06-10');
    expect(dates).toContain('2024-06-12');
  });

  it('with no holidayLookup configured, every weekday still gets an EXCUSED row (unchanged default)', async () => {
    const repo = new InMemoryAttendanceRepository();
    seedPeriod(repo, '2024-01-01', '2024-12-31');
    const ops = new AttendanceOpsService(new InMemoryAttendanceOpsStore(), repo);
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
      },
      PARENT,
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER, undefined);
    expect(repo.getStudentAttendanceRecords()).toHaveLength(3);
  });
});
