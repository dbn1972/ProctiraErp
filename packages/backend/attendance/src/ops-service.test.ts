import { describe, expect, it, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { AttendanceStatus } from '@proctira/common';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceOpsRoutes } from './ops-routes.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';
import { registerAttendanceRoutes } from './routes.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

describe('AttendanceOpsService (G-919)', () => {
  let repo: InMemoryAttendanceRepository;
  let ops: AttendanceOpsService;

  beforeEach(() => {
    repo = new InMemoryAttendanceRepository();
    repo.addAcademicPeriod({
      id: PERIOD_ID,
      tenantId: TENANT_ID,
      name: 'AY',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      status: 'active',
    });
    ops = new AttendanceOpsService(new InMemoryAttendanceOpsStore(), repo);
  });

  it('approves regularisation and updates the attendance row with audit', async () => {
    const record = await repo.createStudentAttendance({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
      tenantId: TENANT_ID,
      studentId: STUDENT_ID,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      date: '2024-06-10',
      subjectId: null,
      periodId: null,
      status: AttendanceStatus.ABSENT,
      comment: null,
      recordedBy: 'teacher-1',
    });
    const req = await ops.requestRegularisation(
      TENANT_ID,
      {
        attendanceId: record.id,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-10',
        fromStatus: 'ABSENT',
        toStatus: 'PRESENT',
        reason: 'bus delay',
      },
      { userId: 'parent-1', roles: ['parent'] },
    );
    const decided = await ops.decideRegularisation(TENANT_ID, req.id, 'approved', {
      userId: 'registrar-1',
      roles: ['registrar'],
    });
    expect(decided.status).toBe('approved');
    const rows = repo.getStudentAttendanceRecords();
    expect(rows[0]?.status).toBe(AttendanceStatus.PRESENT);
    expect(repo.getAuditEntries()).toHaveLength(1);
  });

  it('rejects regularisation without mutating the attendance row', async () => {
    const record = await repo.createStudentAttendance({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
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
    const req = await ops.requestRegularisation(
      TENANT_ID,
      {
        attendanceId: record.id,
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-11',
        fromStatus: 'ABSENT',
        toStatus: 'EXCUSED',
      },
      { userId: 't', roles: ['teacher'] },
    );
    await ops.decideRegularisation(TENANT_ID, req.id, 'rejected', {
      userId: 'admin-1',
      roles: ['admin'],
    });
    expect(repo.getStudentAttendanceRecords()[0]?.status).toBe(AttendanceStatus.ABSENT);
  });

  it('leave approve auto-marks weekday dates EXCUSED', async () => {
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-12',
        reason: 'family',
      },
      { userId: 'parent-1', roles: ['parent'] },
    );
    await ops.decideLeave(TENANT_ID, leave.id, 'approved', {
      userId: 'principal-1',
      roles: ['principal'],
    });
    const rows = repo.getStudentAttendanceRecords();
    expect(rows.every((r) => r.status === AttendanceStatus.EXCUSED)).toBe(true);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it('denies approve for a teacher role', async () => {
    const leave = await ops.requestLeave(
      TENANT_ID,
      {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-10',
      },
      { userId: 'p', roles: ['parent'] },
    );
    await expect(
      ops.decideLeave(TENANT_ID, leave.id, 'approved', { userId: 't', roles: ['teacher'] }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('POST /attendance/ingest contract (G-919)', () => {
  it('is idempotent on deviceId+eventId and writes PRESENT on IN', async () => {
    const repo = new InMemoryAttendanceRepository();
    const store = new InMemoryAttendanceOpsStore();
    const ops = new AttendanceOpsService(store, repo);
    const registered = await ops.registerDevice(
      TENANT_ID,
      { institutionId: INSTITUTION_ID, deviceId: 'gate-1', label: 'Main gate' },
      { userId: 'admin', roles: ['admin'] },
    );

    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    });
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
        sub: 'admin',
        roles: ['admin'],
      };
    });
    const attendanceService = new AttendanceService(repo);
    await registerAttendanceRoutes(app, { attendanceService });
    await registerAttendanceOpsRoutes(app, { opsService: ops });
    await app.ready();

    const body = {
      deviceId: 'gate-1',
      institutionId: INSTITUTION_ID,
      events: [
        {
          eventId: 'evt-1',
          studentId: STUDENT_ID,
          punchedAt: '2024-06-15T08:05:00.000Z',
          type: 'IN',
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
        },
      ],
    };
    const first = await app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': registered.apiKey },
      payload: body,
    });
    expect(first.statusCode).toBe(202);
    const firstJson = JSON.parse(first.body) as { accepted: number; duplicates: number };
    expect(firstJson.accepted).toBe(1);
    expect(firstJson.duplicates).toBe(0);

    const second = await app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': registered.apiKey },
      payload: body,
    });
    expect(second.statusCode).toBe(202);
    const secondJson = JSON.parse(second.body) as { accepted: number; duplicates: number };
    expect(secondJson.duplicates).toBe(1);
    expect(secondJson.accepted).toBe(0);
    expect(repo.getStudentAttendanceRecords()).toHaveLength(1);
    expect(repo.getStudentAttendanceRecords()[0]?.status).toBe(AttendanceStatus.PRESENT);

    const denied = await app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': 'wrong' },
      payload: body,
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });
});
