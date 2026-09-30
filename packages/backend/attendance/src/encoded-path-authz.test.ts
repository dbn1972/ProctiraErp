/**
 * The attendance guard picks attendance.approve vs attendance.write from the path. It used the
 * raw request.url, but Fastify routes on the percent-decoded path — so a teacher (write, not
 * approve) could hit `/leave-requests/:id/%61pprove`. A substring `/ingest` check also skipped
 * RBAC for any path containing `/ingest`. Both now classify on the matched route pattern.
 */
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { attendanceActionForRequest } from './attendance-http-guard.js';
import { InMemoryAttendanceRepository } from './in-memory-repository.js';
import { registerAttendanceOpsRoutes } from './ops-routes.js';
import { AttendanceOpsService } from './ops-service.js';
import { InMemoryAttendanceOpsStore } from './ops-store.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const LEAVE_ID = '22222222-2222-4222-8222-222222222222';

describe('attendanceActionForRequest on route patterns', () => {
  it('maps approve/reject/devices patterns to attendance.approve', () => {
    expect(attendanceActionForRequest('POST', '/api/v1/attendance/leave-requests/:id/approve')).toBe(
      'attendance.approve',
    );
    expect(attendanceActionForRequest('POST', '/attendance/devices')).toBe('attendance.approve');
  });

  it('skips user RBAC only for the exact device ingest route', () => {
    expect(attendanceActionForRequest('POST', '/api/v1/attendance/ingest')).toBeNull();
    expect(attendanceActionForRequest('POST', '/attendance/leave-requests/ingest/approve')).toBe(
      'attendance.approve',
    );
    expect(attendanceActionForRequest('POST', '/attendance/ingest-extra')).toBe('attendance.write');
  });
});

describe('attendance approve guard vs percent-encoded paths', () => {
  let app: FastifyInstance;
  let roles: string[] = [];

  beforeEach(async () => {
    roles = [];
    const ops = new AttendanceOpsService(
      new InMemoryAttendanceOpsStore(),
      new InMemoryAttendanceRepository(),
    );
    app = Fastify();
    app.decorateRequest('tenantId', '');
    app.addHook('onRequest', async (request) => {
      (request as typeof request & { tenantId: string }).tenantId = TENANT;
      (request as typeof request & { user?: { sub: string; roles: string[] } }).user = {
        sub: 'user-1',
        roles,
      };
    });
    await app.register(
      async (scope) => {
        await registerAttendanceOpsRoutes(scope, { opsService: ops });
      },
      { prefix: '/api/v1' },
    );
    await app.ready();
  });

  for (const url of [
    `/api/v1/attendance/leave-requests/${LEAVE_ID}/approve`,
    `/api/v1/attendance/leave-requests/${LEAVE_ID}/%61pprove`,
  ]) {
    it(`denies a teacher approving leave via ${url} at the route guard`, async () => {
      roles = ['teacher'];
      const res = await app.inject({ method: 'POST', url, payload: {} });
      expect(res.statusCode).toBe(403);
      // The service has its own leave-decision check; assert the *route guard* made this call
      // (attendance.approve), not the service backstop after a downgraded guard let it through.
      expect(res.json().message).toContain('attendance action attendance.approve');
    });
  }
});
