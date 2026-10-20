/**
 * PRC-L278: HTTP-level role x action matrix for every ops route in
 * ops-routes.ts, exercised over `app.inject(...)` (not just the pure
 * attendanceActionForRequest/isAttendanceApprover mapping functions, which
 * attendance-http-guard.test.ts / ops-service.test.ts already cover).
 * Confirms the package RBAC hook actually gates each route end-to-end.
 */
import { randomUUID } from 'node:crypto';

import { AttendanceStatus } from '@proctira/common';
import Fastify from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceOpsRoutes } from './ops-routes.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';

function buildApp(roles: string[], userId = 'u-1') {
  const repo = new InMemoryAttendanceRepository();
  repo.addAcademicPeriod({
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'AY',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    status: 'active',
  });
  const store = new InMemoryAttendanceOpsStore();
  const opsService = new AttendanceOpsService(store, repo);

  const app = Fastify();
  app.decorateRequest('tenantId', '');
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
  });
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
      sub: userId,
      roles,
    };
  });
  return { app, repo, store, opsService };
}

async function readyApp(roles: string[], userId = 'u-1') {
  const ctx = buildApp(roles, userId);
  await registerAttendanceOpsRoutes(ctx.app, { opsService: ctx.opsService });
  await ctx.app.ready();
  return ctx;
}

async function seedAttendanceRecord(repo: InMemoryAttendanceRepository, date: string) {
  return repo.createStudentAttendance({
    id: randomUUID(),
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

describe('PRC-L278: /attendance/regularisation role x action matrix', () => {
  it('GET: parent is denied (403), teacher is allowed (200)', async () => {
    const parentCtx = await readyApp(['parent']);
    const denied = await parentCtx.app.inject({ method: 'GET', url: '/attendance/regularisation' });
    expect(denied.statusCode).toBe(403);
    await parentCtx.app.close();

    const teacherCtx = await readyApp(['teacher']);
    const allowed = await teacherCtx.app.inject({
      method: 'GET',
      url: '/attendance/regularisation',
    });
    expect(allowed.statusCode).toBe(200);
    await teacherCtx.app.close();
  });

  it('POST: parent is denied (403); teacher reaches the handler (201)', async () => {
    const parentCtx = await readyApp(['parent']);
    const denied = await parentCtx.app.inject({
      method: 'POST',
      url: '/attendance/regularisation',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-10',
        toStatus: 'PRESENT',
      },
    });
    expect(denied.statusCode).toBe(403);
    await parentCtx.app.close();

    const teacherCtx = await readyApp(['teacher']);
    await seedAttendanceRecord(teacherCtx.repo, '2024-06-10');
    const allowed = await teacherCtx.app.inject({
      method: 'POST',
      url: '/attendance/regularisation',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        attendanceDate: '2024-06-10',
        toStatus: 'PRESENT',
      },
    });
    expect(allowed.statusCode).toBe(201);
    await teacherCtx.app.close();
  });

  for (const decision of ['approve', 'reject'] as const) {
    it(`POST .../${decision}: teacher is denied (403), registrar is allowed (200)`, async () => {
      const setupCtx = await readyApp(['teacher']);
      await seedAttendanceRecord(setupCtx.repo, '2024-06-10');
      const created = await setupCtx.app.inject({
        method: 'POST',
        url: '/attendance/regularisation',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          attendanceDate: '2024-06-10',
          toStatus: 'PRESENT',
        },
      });
      const { id } = created.json() as { id: string };

      const teacherDecision = await setupCtx.app.inject({
        method: 'POST',
        url: `/attendance/regularisation/${id}/${decision}`,
        payload: {},
      });
      expect(teacherDecision.statusCode).toBe(403);
      await setupCtx.app.close();

      // A requester cannot decide their own request (separate business rule
      // from the RBAC gate under test). Create under one registrar actor and
      // run two apps over the SAME opsService/store so a second registrar
      // actor can decide it — isolating the RBAC assertion from that rule.
      const creatorCtx = await readyApp(['registrar'], 'registrar-creator');
      await seedAttendanceRecord(creatorCtx.repo, '2024-06-11');
      const createdByRegistrar = await creatorCtx.app.inject({
        method: 'POST',
        url: '/attendance/regularisation',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          attendanceDate: '2024-06-11',
          toStatus: 'PRESENT',
        },
      });
      const { id: id2 } = createdByRegistrar.json() as { id: string };
      await creatorCtx.app.close();

      const deciderApp = Fastify();
      deciderApp.decorateRequest('tenantId', '');
      deciderApp.addHook('onRequest', async (request) => {
        (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
      });
      deciderApp.decorateRequest('user', undefined);
      deciderApp.addHook('onRequest', async (request) => {
        (request as typeof request & { user: { sub: string; roles: string[] } }).user = {
          sub: 'registrar-decider',
          roles: ['registrar'],
        };
      });
      await registerAttendanceOpsRoutes(deciderApp, { opsService: creatorCtx.opsService });
      await deciderApp.ready();
      const registrarDecision = await deciderApp.inject({
        method: 'POST',
        url: `/attendance/regularisation/${id2}/${decision}`,
        payload: {},
      });
      expect(registrarDecision.statusCode).toBe(200);
      await deciderApp.close();
    });
  }
});

describe('PRC-L278: /attendance/leave-requests role x action matrix', () => {
  it('GET: parent is denied (403), teacher is allowed (200)', async () => {
    const parentCtx = await readyApp(['parent']);
    const denied = await parentCtx.app.inject({ method: 'GET', url: '/attendance/leave-requests' });
    expect(denied.statusCode).toBe(403);
    await parentCtx.app.close();

    const teacherCtx = await readyApp(['teacher']);
    const allowed = await teacherCtx.app.inject({ method: 'GET', url: '/attendance/leave-requests' });
    expect(allowed.statusCode).toBe(200);
    await teacherCtx.app.close();
  });

  it('POST: parent is denied (403), teacher is allowed (201)', async () => {
    const parentCtx = await readyApp(['parent']);
    const denied = await parentCtx.app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-11',
      },
    });
    expect(denied.statusCode).toBe(403);
    await parentCtx.app.close();

    const teacherCtx = await readyApp(['teacher']);
    const allowed = await teacherCtx.app.inject({
      method: 'POST',
      url: '/attendance/leave-requests',
      payload: {
        studentId: STUDENT_ID,
        institutionId: INSTITUTION_ID,
        classId: CLASS_ID,
        academicPeriodId: PERIOD_ID,
        fromDate: '2024-06-10',
        toDate: '2024-06-11',
      },
    });
    expect(allowed.statusCode).toBe(201);
    await teacherCtx.app.close();
  });

  for (const decision of ['approve', 'reject'] as const) {
    it(`POST .../${decision}: teacher is denied (403), registrar is allowed (200)`, async () => {
      const teacherCtx = await readyApp(['teacher']);
      const created = await teacherCtx.app.inject({
        method: 'POST',
        url: '/attendance/leave-requests',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          fromDate: '2024-06-10',
          toDate: '2024-06-11',
        },
      });
      const { id } = created.json() as { id: string };
      const teacherDecision = await teacherCtx.app.inject({
        method: 'POST',
        url: `/attendance/leave-requests/${id}/${decision}`,
        payload: {},
      });
      expect(teacherDecision.statusCode).toBe(403);
      await teacherCtx.app.close();

      const registrarCtx = await readyApp(['registrar']);
      const createdByRegistrar = await registrarCtx.app.inject({
        method: 'POST',
        url: '/attendance/leave-requests',
        payload: {
          studentId: STUDENT_ID,
          institutionId: INSTITUTION_ID,
          classId: CLASS_ID,
          academicPeriodId: PERIOD_ID,
          fromDate: '2024-06-12',
          toDate: '2024-06-13',
        },
      });
      const { id: id2 } = createdByRegistrar.json() as { id: string };
      const registrarDecision = await registrarCtx.app.inject({
        method: 'POST',
        url: `/attendance/leave-requests/${id2}/${decision}`,
        payload: {},
      });
      expect(registrarDecision.statusCode).toBe(200);
      await registrarCtx.app.close();
    });
  }
});

describe('PRC-L278: POST /attendance/devices role x action matrix', () => {
  it('teacher is denied (403), registrar is allowed (201)', async () => {
    const teacherCtx = await readyApp(['teacher']);
    const denied = await teacherCtx.app.inject({
      method: 'POST',
      url: '/attendance/devices',
      payload: { institutionId: INSTITUTION_ID, deviceId: 'gate-1' },
    });
    expect(denied.statusCode).toBe(403);
    await teacherCtx.app.close();

    const registrarCtx = await readyApp(['registrar']);
    const allowed = await registrarCtx.app.inject({
      method: 'POST',
      url: '/attendance/devices',
      payload: { institutionId: INSTITUTION_ID, deviceId: 'gate-1' },
    });
    expect(allowed.statusCode).toBe(201);
    await registrarCtx.app.close();
  });
});

describe('PRC-L278: POST /attendance/ingest bypasses package RBAC (device-key auth)', () => {
  let ctx: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    ctx = buildApp(['parent']); // a role with NO attendance package access at all
    await registerAttendanceOpsRoutes(ctx.app, { opsService: ctx.opsService });
    await ctx.app.ready();
  });

  it('is never blocked by the package RBAC hook (401 for a bad key, not 403)', async () => {
    const response = await ctx.app.inject({
      method: 'POST',
      url: '/attendance/ingest',
      headers: { 'x-device-api-key': 'wrong-key' },
      payload: {
        deviceId: 'gate-1',
        institutionId: INSTITUTION_ID,
        events: [
          {
            eventId: 'evt-1',
            studentId: STUDENT_ID,
            punchedAt: '2024-06-15T08:00:00.000Z',
            type: 'IN',
          },
        ],
      },
    });
    // 401 (device auth failure), never 403 (package RBAC) — ingest is
    // exempted at attendanceActionForRequest (returns null for this path).
    expect(response.statusCode).toBe(401);
    await ctx.app.close();
  });
});
