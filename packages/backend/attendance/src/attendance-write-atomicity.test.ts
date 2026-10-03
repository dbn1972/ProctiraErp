/**
 * PRC-M168: attendance change + audit row are all-or-nothing.
 */
import { AttendanceStatus } from '@proctira/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';
const APPROVER = { userId: 'registrar-1', roles: ['registrar'] };
const PARENT = { userId: 'parent-1', roles: ['parent'] };

function seedRow(repo: InMemoryAttendanceRepository, id: string, date: string) {
  return repo.createStudentAttendance({
    id,
    tenantId: TENANT_ID,
    studentId: STUDENT_ID,
    institutionId: INSTITUTION_ID,
    classId: CLASS_ID,
    academicPeriodId: PERIOD_ID,
    date,
    subjectId: null,
    periodId: null,
    status: AttendanceStatus.ABSENT,
    comment: null,
    recordedBy: 'teacher-1',
  });
}

describe('PRC-M168 attendance write atomicity', () => {
  let repo: InMemoryAttendanceRepository;
  let store: InMemoryAttendanceOpsStore;
  let ops: AttendanceOpsService;

  beforeEach(() => {
    repo = new InMemoryAttendanceRepository();
    repo.addAcademicPeriod({
      id: PERIOD_ID,
      tenantId: TENANT_ID,
      name: 'AY',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2030-12-31'),
      status: 'active',
    });
    store = new InMemoryAttendanceOpsStore();
    ops = new AttendanceOpsService(store, repo);
  });

  it('injected audit failure rolls back a single-record status change', async () => {
    await seedRow(repo, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '2024-06-10');
    repo.failAuditOnCall = 1;
    const svc = new AttendanceService(repo);
    await expect(
      svc.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2024-06-10',
          status: 'PRESENT',
        } as never,
        'teacher-2',
      ),
    ).rejects.toThrow('injected audit failure');
    expect(repo.getStudentAttendanceRecords()[0]?.status).toBe(AttendanceStatus.ABSENT);
    expect(repo.getAuditEntries()).toHaveLength(0);
  });

  it('injected audit failure on regularisation approval leaves status unchanged', async () => {
    const rec = await seedRow(repo, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', '2024-06-11');
    const req = await ops.requestRegularisation(
      TENANT_ID,
      {
        attendanceId: rec.id,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-11',
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
      },
      PARENT,
    );
    repo.failAuditOnCall = 1;
    await expect(ops.decideRegularisation(TENANT_ID, req.id, 'approved', APPROVER)).rejects.toThrow();
    expect(repo.getStudentAttendanceRecords()[0]?.status).toBe(AttendanceStatus.ABSENT);
    expect((await store.getRegularisation(TENANT_ID, req.id))?.status).toBe('requested');
  });

  it('failing day 3 of a 5-day leave approval writes no EXCUSED day and keeps the leave requested', async () => {
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10', // Monday
        toDate: '2024-06-14', // Friday
      },
      PARENT,
    );
    repo.failAuditOnCall = 3;
    await expect(ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER)).rejects.toThrow(
      'injected audit failure',
    );
    expect(
      repo.getStudentAttendanceRecords().filter((r) => r.status === AttendanceStatus.EXCUSED),
    ).toHaveLength(0);
    expect(repo.getAuditEntries()).toHaveLength(0);
    expect((await store.getLeave(TENANT_ID, leave.id))?.status).toBe('requested');
  });

  it('successful leave approval writes one EXCUSED row + audit per weekday', async () => {
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
    const decided = await ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER);
    expect(decided.status).toBe('approved');
    expect(repo.getStudentAttendanceRecords()).toHaveLength(5);
    expect(repo.getAuditEntries()).toHaveLength(5);
  });
});

describe('PRC-M171 decision compare-and-set', () => {
  let repo: InMemoryAttendanceRepository;
  let store: InMemoryAttendanceOpsStore;
  let ops: AttendanceOpsService;

  beforeEach(() => {
    repo = new InMemoryAttendanceRepository();
    store = new InMemoryAttendanceOpsStore();
    ops = new AttendanceOpsService(store, repo);
  });

  async function newReg() {
    const rec = await seedRow(repo, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaab1', '2024-06-12');
    return ops.requestRegularisation(
      TENANT_ID,
      {
        attendanceId: rec.id,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-12',
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
      },
      PARENT,
    );
  }

  it('two simultaneous approvals: one audit row and one 409', async () => {
    const req = await newReg();
    const results = await Promise.allSettled([
      ops.decideRegularisation(TENANT_ID, req.id, 'approved', APPROVER),
      ops.decideRegularisation(TENANT_ID, req.id, 'approved', {
        userId: 'registrar-2',
        roles: ['registrar'],
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect((rejected.reason as { statusCode?: number }).statusCode).toBe(409);
    expect(repo.getAuditEntries()).toHaveLength(1);
  });

  it('concurrent approve + reject: exactly one succeeds, other 409', async () => {
    const req = await newReg();
    const results = await Promise.allSettled([
      ops.decideRegularisation(TENANT_ID, req.id, 'approved', APPROVER),
      ops.decideRegularisation(TENANT_ID, req.id, 'rejected', {
        userId: 'registrar-2',
        roles: ['registrar'],
      }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      results.filter(
        (r) =>
          r.status === 'rejected' && (r.reason as { statusCode?: number }).statusCode === 409,
      ),
    ).toHaveLength(1);
  });

  it('concurrent leave approvals apply the leave once', async () => {
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-11',
      },
      PARENT,
    );
    const results = await Promise.allSettled([
      ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER),
      ops.decideLeave(TENANT_ID, leave.id, 'approved', APPROVER),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(repo.getAuditEntries()).toHaveLength(2);
  });
});
