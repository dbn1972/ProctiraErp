/**
 * PRC-M173 (failing-first, data integrity): the attendance plugin must forward its
 * `holidayLookup` option to AttendanceOpsService, so approving a leave through the mounted
 * routes writes no EXCUSED row on a holiday. Before the fix the plugin built the ops service
 * without options, so the lookup was silently ignored.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

import { attendancePlugin } from './attendance-plugin.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import type { AttendanceHolidayLookup } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';

const TENANT_ID = 'tenant-001';
const INSTITUTION_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const PERIOD_ID = '55555555-5555-4555-8555-555555555555';
const HOLIDAY = '2024-06-11';

interface TestUser {
  sub: string;
  roles: string[];
}

async function buildApp(holidayLookup?: AttendanceHolidayLookup) {
  const repository = new InMemoryAttendanceRepository();
  repository.addAcademicPeriod({
    id: PERIOD_ID,
    tenantId: TENANT_ID,
    name: 'AY',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-12-31'),
    status: 'active',
  });
  const app = Fastify({ logger: false });
  app.decorateRequest('tenantId', '');
  app.decorateRequest('user', undefined);
  app.addHook('onRequest', async (request) => {
    (request as typeof request & { tenantId: string }).tenantId = TENANT_ID;
    const raw = request.headers['x-test-user'];
    (request as typeof request & { user?: TestUser }).user =
      typeof raw === 'string' ? (JSON.parse(raw) as TestUser) : undefined;
  });
  await app.register(attendancePlugin, {
    repository,
    opsStore: new InMemoryAttendanceOpsStore(),
    holidayLookup,
  });
  await app.ready();
  return { app, repository };
}

function as(user: TestUser) {
  return { 'x-test-user': JSON.stringify(user) };
}

async function requestAndApprove(app: FastifyInstance): Promise<void> {
  const created = await app.inject({
    method: 'POST',
    url: '/attendance/leave-requests',
    headers: as({ sub: 'teacher-1', roles: ['teacher'] }),
    payload: {
      studentId: STUDENT_ID,
      institutionId: INSTITUTION_ID,
      classId: CLASS_ID,
      academicPeriodId: PERIOD_ID,
      fromDate: '2024-06-10',
      toDate: '2024-06-12',
    },
  });
  expect(created.statusCode, created.body).toBe(201);
  const { id } = created.json() as { id: string };
  const approved = await app.inject({
    method: 'POST',
    url: `/attendance/leave-requests/${id}/approve`,
    headers: as({ sub: 'principal-1', roles: ['principal'] }),
    payload: {},
  });
  expect(approved.statusCode, approved.body).toBe(200);
}

describe('PRC-M173 attendance plugin forwards holidayLookup', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('approving a leave spanning a holiday writes no EXCUSED row on that date', async () => {
    const calls: Array<[string, string, string, string]> = [];
    const built = await buildApp(async (tenantId, institutionId, from, to) => {
      calls.push([tenantId, institutionId, from, to]);
      return new Set([HOLIDAY]);
    });
    app = built.app;
    await requestAndApprove(app);
    expect(calls).toEqual([[TENANT_ID, INSTITUTION_ID, '2024-06-10', '2024-06-12']]);
    const dates = built.repository
      .getStudentAttendanceRecords()
      .map((r) => r.date)
      .sort();
    expect(dates).toEqual(['2024-06-10', '2024-06-12']);
  });

  it('without a holidayLookup every weekday is still marked (unchanged default)', async () => {
    const built = await buildApp();
    app = built.app;
    await requestAndApprove(app);
    expect(built.repository.getStudentAttendanceRecords()).toHaveLength(3);
  });
});
