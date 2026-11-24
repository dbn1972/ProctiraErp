/**
 * S-D2 — GET /api/v1/timetable/substitutions through the real gateway (JWT, RBAC hook,
 * institution scope, timetable package guard). Before the fix, student, parent, teacher and
 * staff JWTs all read every substitution in the tenant, including the free-text reason.
 * Only the substitution-desk roles (the scheduler roles that may create substitutions) read it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400b2';
const INST = '22222222-2222-4222-8222-222222222222';
const TERM = '33333333-3333-4333-8333-333333333333';
const REASON = 'medical leave S-D2 gateway';

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 10000 },
    cors: {
      origins: ['http://localhost:3000'],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      credentials: true,
    },
    jwt: {
      secret: 'test-secret-key-for-testing-only',
      issuer: 'proctira-test',
      audience: 'proctira-test-api',
      accessTokenExpiresIn: '15m',
    },
    tenant: { baseDomain: 'proctira.org', headerName: 'x-tenant-id' },
    services: {
      auth: { prefix: '/auth', target: 'http://127.0.0.1:1', healthCheck: '/health' },
    },
  };
}

describe('GET /api/v1/timetable/substitutions authorization (S-D2)', () => {
  let app: FastifyInstance;
  let absentStaffId: string;

  function bearer(roleId: string, tenantId: string): string {
    return app.jwt.sign({
      sub: `user-${roleId}-${tenantId.slice(-2)}`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: 'root' }],
      areas: [],
      institutions: [],
      jti: `jti-sd2-${roleId}-${tenantId.slice(-2)}`,
      sessionId: `session-sd2-${roleId}-${tenantId.slice(-2)}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  async function call(
    method: 'GET' | 'POST',
    url: string,
    roleId: string,
    payload?: unknown,
    tokenTenant = TENANT_A,
    headerTenant = tokenTenant,
  ) {
    return app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${bearer(roleId, tokenTenant)}`,
        'x-tenant-id': headerTenant,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
    });
  }

  async function adminCreate(url: string, body: unknown): Promise<{ id: string }> {
    const res = await call('POST', url, 'admin', body);
    expect(res.statusCode, `${url}: ${res.body}`).toBe(201);
    return res.json() as { id: string };
  }

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
    const staff = async (lastName: string) =>
      adminCreate('/api/v1/staff', {
        firstName: 'Sub',
        lastName,
        dateOfBirth: '1985-02-03',
        identityNumber: `SD2-${lastName}`,
        contactPhone: '+15550001111',
        position: 'Teacher',
      });
    const absent = await staff('Absent');
    const cover = await staff('Cover');
    absentStaffId = absent.id;
    for (const s of [absent, cover]) {
      await adminCreate('/api/v1/staff/assignments', {
        staffId: s.id,
        institutionId: INST,
        subjectId: '00000000-0000-4000-8000-0000000005b1',
        classId: '00000000-0000-4000-8000-0000000005c1',
        role: 'Teacher',
        allocationPercentage: 50,
        startDate: '2026-01-01',
      });
    }
    const bell = await adminCreate('/api/v1/timetable/bell-schedules', {
      institutionId: INST,
      academicPeriodId: TERM,
      name: 'SD2 Bell',
      code: 'SD2B',
      dayPattern: '1,2,3,4,5',
    });
    const period = await adminCreate(`/api/v1/timetable/bell-schedules/${bell.id}/periods`, {
      name: 'P1',
      periodOrder: 1,
      startTime: '08:00',
      endTime: '08:45',
    });
    const section = await adminCreate('/api/v1/timetable/sections', {
      institutionId: INST,
      academicPeriodId: TERM,
      name: 'SD2 Section',
      code: 'SD2S',
      capacity: 30,
    });
    const meeting = await adminCreate('/api/v1/timetable/meetings', {
      institutionId: INST,
      academicPeriodId: TERM,
      sectionId: section.id,
      staffId: absent.id,
      periodId: period.id,
      dayOfWeek: 1,
      status: 'active',
    });
    await adminCreate('/api/v1/timetable/substitutions', {
      sectionMeetingId: meeting.id,
      substituteStaffId: cover.id,
      substitutionDate: '2026-09-07',
      reason: REASON,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([['student'], ['parent'], ['guardian'], ['teacher'], ['staff']])(
    '%s gets 403 and never the reason or the absent teacher',
    async (roleId) => {
      const res = await call('GET', '/api/v1/timetable/substitutions', roleId);
      expect(res.statusCode, res.body).toBe(403);
      expect(res.body).not.toContain(REASON);
      expect(res.body).not.toContain(absentStaffId);
    },
  );

  it.each([['admin'], ['principal']])('%s still reads the row with its reason', async (roleId) => {
    const res = await call('GET', `/api/v1/timetable/substitutions?institutionId=${INST}`, roleId);
    expect(res.statusCode, res.body).toBe(200);
    const rows = (res.json() as { data: Array<Record<string, unknown>> }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ originalStaffId: absentStaffId, reason: REASON });
  });

  it('another tenant cannot read tenant A substitutions', async () => {
    const own = await call('GET', '/api/v1/timetable/substitutions', 'admin', undefined, TENANT_B);
    expect(own.statusCode, own.body).toBe(200);
    expect((own.json() as { data: unknown[] }).data).toEqual([]);
    // A tenant-B token sent with tenant A's header is still served as tenant B (SEC-2: the
    // JWT tenant wins over x-tenant-id), so none of tenant A's rows come back.
    const crossed = await call(
      'GET',
      `/api/v1/timetable/substitutions?institutionId=${INST}`,
      'admin',
      undefined,
      TENANT_B,
      TENANT_A,
    );
    expect(crossed.statusCode, crossed.body).toBe(200);
    expect((crossed.json() as { data: unknown[] }).data).toEqual([]);
    expect(crossed.body).not.toContain(REASON);
    expect(crossed.body).not.toContain(absentStaffId);
  });
});
