/**
 * PRC-L366 — route-level authz matrix for the student domain through the real
 * gateway (JWT + tenant + RBAC + studentPlugin): enrollments, certificates,
 * bulk import, and parent/guardian access to the student register.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function createTestConfig(): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 1000 },
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

type Case = {
  id: string;
  method: 'GET' | 'POST' | 'PUT';
  url: string;
  payload?: Record<string, unknown>;
  denied: string[];
  allowed: string[];
};

const CASES: Case[] = [
  {
    id: 'enrollment-create',
    method: 'POST',
    url: '/api/v1/enrollments',
    payload: {
      studentId: UUID_A,
      institutionId: UUID_B,
      gradeId: UUID_A,
      classId: UUID_B,
      academicPeriodId: UUID_A,
      enrolledAt: '2024-01-15',
    },
    denied: ['teacher', 'parent', 'guardian', 'student'],
    allowed: ['admin'],
  },
  {
    id: 'enrollment-status',
    method: 'PUT',
    url: `/api/v1/enrollments/${UUID_A}/status`,
    payload: { status: 'WITHDRAWN', effectiveDate: '2024-06-01', reason: 'x' },
    denied: ['teacher', 'parent', 'guardian', 'student'],
    allowed: ['admin'],
  },
  {
    id: 'certificate-issue',
    method: 'POST',
    url: `/api/v1/students/${UUID_A}/certificates`,
    payload: { type: 'bonafide' },
    denied: ['teacher', 'parent', 'guardian', 'student'],
    allowed: ['admin'],
  },
  {
    id: 'student-import',
    method: 'POST',
    url: '/api/v1/students/import',
    payload: {},
    denied: ['teacher', 'parent', 'guardian', 'student'],
    allowed: ['admin'],
  },
  {
    id: 'student-register-list',
    method: 'GET',
    url: '/api/v1/students',
    denied: [],
    allowed: ['admin', 'teacher'],
  },
];

describe('PRC-L366 student-domain authz matrix (gateway)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  function bearer(roleId: string | null): string {
    return app.jwt.sign({
      sub: `user-${roleId ?? 'none'}`,
      tenantId: TENANT_ID,
      email: 'u@example.com',
      displayName: 'U',
      roles: roleId ? [{ roleId, roleName: roleId, areaId: 'root' }] : [],
      areas: [],
      institutions: [],
      jti: `jti-l366-${roleId ?? 'none'}`,
      sessionId: `session-l366-${roleId ?? 'none'}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  }

  function call(c: Case, token?: string) {
    return app.inject({
      method: c.method,
      url: c.url,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'x-tenant-id': TENANT_ID,
        ...(c.payload ? { 'content-type': 'application/json' } : {}),
      },
      ...(c.payload ? { payload: c.payload } : {}),
    });
  }

  /**
   * S16-01 (PRC-L366 residual): parents/guardians must not list the whole
   * tenant register. Closed by PRC-C010 (staff-only roster), so this is a
   * plain `it` now, as the original `it.fails` note required.
   */
  for (const role of ['parent', 'guardian']) {
    it(`student-register-list: ${role} is denied the full register (S16-01)`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/students',
        headers: { authorization: `Bearer ${bearer(role)}`, 'x-tenant-id': TENANT_ID },
      });
      expect(res.statusCode).toBe(403);
    });
  }

  for (const c of CASES) {
    it(`${c.id}: unauthenticated → 401`, async () => {
      expect((await call(c)).statusCode).toBe(401);
    });
    it(`${c.id}: no roles → 403`, async () => {
      expect((await call(c, bearer(null))).statusCode).toBe(403);
    });
    for (const role of c.denied) {
      it(`${c.id}: ${role} → 403`, async () => {
        const res = await call(c, bearer(role));
        expect(res.statusCode).toBe(403);
      });
    }
    for (const role of c.allowed) {
      it(`${c.id}: ${role} passes authz (not 401/403)`, async () => {
        const res = await call(c, bearer(role));
        expect([401, 403]).not.toContain(res.statusCode);
      });
    }
  }
});
