/**
 * PRC-M496: attendance date validation hardcoded naive UTC "today" and
 * accepted shape-valid-but-nonexistent calendar dates. This file covers:
 *
 *  - part 1: institution-local "today" via an injectable clock + timeZone
 *    option on AttendanceService (mirrors TimetableServiceOptions /
 *    ExaminationServiceOptions).
 *  - part 2: strict calendar-date parsing at the HTTP layer (routes.ts),
 *    rejecting a shape-valid but nonexistent date like 2026-02-30.
 */
import { AttendanceStatus } from '@proctira/common';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { AttendanceService } from './attendance-service.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceRoutes } from './routes.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const STAFF_ID = '44444444-4444-4444-8444-444444444444';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

function seedRepo(): InMemoryAttendanceRepository {
  const repo = new InMemoryAttendanceRepository();
  repo.addAcademicPeriod({
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'AY',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2027-12-31'),
    status: 'active',
  });
  return repo;
}

describe('PRC-M496 part 1: institution-local "today" (failing-first)', () => {
  it(
    'accepts a 2026-09-14 recording when the injected clock is 23:30 UTC on ' +
      '2026-09-13 and the institution timezone is Asia/Kolkata (which is already 2026-09-14 locally)',
    async () => {
      const repo = seedRepo();
      repo.addAcademicPeriod({
        id: PERIOD_ID,
        tenantId: TENANT_ID,
        name: 'AY',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2027-12-31'),
        status: 'active',
      });
      const service = new AttendanceService(repo, undefined, {
        timeZone: 'Asia/Kolkata',
        now: () => new Date('2026-09-13T23:30:00.000Z'),
      });

      // Failing-first: a naive UTC comparison treats '2026-09-14' as a future
      // date relative to '2026-09-13T23:30:00Z' and rejects it. Under the
      // institution's local Asia/Kolkata clock it is already 2026-09-14,
      // i.e. "today", and must be accepted.
      const record = await service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2026-09-14',
          status: 'PRESENT',
        } as never,
        'teacher-1',
      );
      expect(record.status).toBe(AttendanceStatus.PRESENT);
    },
  );

  it('rejects a date that is genuinely in the future in the institution timezone', async () => {
    const repo = seedRepo();
    const service = new AttendanceService(repo, undefined, {
      timeZone: 'Asia/Kolkata',
      now: () => new Date('2026-09-13T23:30:00.000Z'), // 2026-09-14 05:00 IST
    });
    await expect(
      service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2026-09-15',
          status: 'PRESENT',
        } as never,
        'teacher-1',
      ),
    ).rejects.toThrow(/future/i);
  });

  it('recordStaffAttendance also uses the institution-local "today"', async () => {
    const repo = seedRepo();
    const service = new AttendanceService(repo, undefined, {
      timeZone: 'Asia/Kolkata',
      now: () => new Date('2026-09-13T23:30:00.000Z'),
    });
    const record = await service.recordStaffAttendance(
      TENANT_ID,
      {
        staffId: STAFF_ID,
        institutionId: INSTITUTION_ID,
        date: '2026-09-14',
        status: 'PRESENT',
      } as never,
      'admin-1',
    );
    expect(record.status).toBe('PRESENT');
  });

  it('defaults to UTC when no timeZone option is configured (unchanged behavior)', async () => {
    const repo = seedRepo();
    const service = new AttendanceService(repo, undefined, {
      now: () => new Date('2026-09-13T23:30:00.000Z'),
    });
    await expect(
      service.recordStudentAttendance(
        TENANT_ID,
        {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          date: '2026-09-14',
          status: 'PRESENT',
        } as never,
        'teacher-1',
      ),
    ).rejects.toThrow(/future/i);
  });
});

describe('PRC-M496 part 2: strict calendar-date parsing at the HTTP layer (failing-first)', () => {
  async function buildApp() {
    const repo = seedRepo();
    const service = new AttendanceService(repo);
    const app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    });
    app.decorateRequest('user', undefined);
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
        sub: 'teacher-1',
        roles: ['teacher'],
      };
    });
    await registerAttendanceRoutes(app, { attendanceService: service });
    await app.ready();
    return app;
  }

  it('POST /attendance/student with date: 2026-02-30 returns 400 (not a real date)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/student',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        date: '2026-02-30',
        status: 'PRESENT',
      },
    });
    // Failing-first: the shape-only regex `^\d{4}-\d{2}-\d{2}$` accepts
    // 2026-02-30; before this fix it was only caught (if at all) later by a
    // silently-rolling-over `new Date(...)` construction (March 2).
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('POST /attendance/student with a real date still succeeds', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/student',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        date: '2026-02-20',
        status: 'PRESENT',
      },
    });
    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('POST /attendance/staff with date: 2026-04-31 returns 400 (April has 30 days)', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/staff',
      payload: {
        staffId: STAFF_ID,
        institutionId: INSTITUTION_ID,
        date: '2026-04-31',
        status: 'PRESENT',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('GET /attendance/roster with date: 2026-02-30 returns 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/attendance/roster?classId=${CLASS_ID}&academicPeriodId=${PERIOD_ID}&date=2026-02-30`,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('GET /attendance/percentage with startDate: 2026-02-30 returns 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: `/attendance/percentage?scope=class&classId=${CLASS_ID}&startDate=2026-02-30&endDate=2026-03-01`,
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it('POST /attendance/reports/export with endDate: 2026-02-30 returns 400', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/attendance/reports/export',
      payload: {
        scope: 'class',
        classId: CLASS_ID,
        startDate: '2026-02-01',
        endDate: '2026-02-30',
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });
});
