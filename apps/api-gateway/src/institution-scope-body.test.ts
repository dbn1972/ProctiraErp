/**
 * PRC-H004: the school-scope gate must see a body-carried institutionId. The onRequest gate runs
 * before the body is parsed, so writes with {institutionId: <other school>} were never checked.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const SCHOOL_A = '11111111-1111-4111-8111-111111111111';
const SCHOOL_B = '22222222-2222-4222-8222-222222222222';
/** An institution of a different tenant: never in a tenant-A principal's allowed set. */
const OTHER_TENANT_SCHOOL = '33333333-3333-4333-8333-333333333333';

function config(): GatewayConfig {
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

describe('PRC-H004 body institutionId school scope', () => {
  let app: FastifyInstance;

  const principalOfSchoolA = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'principal-a',
      tenantId: TENANT_A,
      email: 'principal-a@example.com',
      displayName: 'Principal A',
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
      areas: [],
      institutions: [SCHOOL_A],
      jti: 'jti-principal-a',
      sessionId: 'session-principal-a',
    } as never)}`,
    'x-tenant-id': TENANT_A,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  const writes: Array<{ method: 'POST' | 'PUT' | 'PATCH'; url: string }> = [
    { method: 'POST', url: '/api/v1/students' },
    { method: 'POST', url: '/api/v1/staff' },
    { method: 'POST', url: '/api/v1/attendance/student' },
    { method: 'POST', url: '/api/v1/attendance/student/bulk' },
    { method: 'POST', url: '/api/v1/enrollments' },
    { method: 'POST', url: '/api/v1/fees/invoices' },
    { method: 'PUT', url: `/api/v1/students/${SCHOOL_A}` },
    { method: 'PATCH', url: `/api/v1/students/${SCHOOL_A}` },
  ];

  for (const { method, url } of writes) {
    it(`${method} ${url} with another school's institutionId -> 403 INSTITUTION_OUT_OF_SCOPE`, async () => {
      const res = await app.inject({
        method,
        url,
        headers: principalOfSchoolA(),
        payload: { institutionId: SCHOOL_B, firstName: 'X' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('INSTITUTION_OUT_OF_SCOPE');
    });
  }

  it('also rejects snake_case institution_id in the body', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: principalOfSchoolA(),
      payload: { institution_id: SCHOOL_B },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSTITUTION_OUT_OF_SCOPE');
  });

  it('rejects when either key spelling names another school', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: principalOfSchoolA(),
      payload: { institutionId: SCHOOL_A, institution_id: SCHOOL_B },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSTITUTION_OUT_OF_SCOPE');
  });

  it("denies reading or changing another school's institution record by id", async () => {
    for (const [method, url] of [
      ['GET', `/api/v1/institutions/${SCHOOL_B}`],
      ['PUT', `/api/v1/institutions/${SCHOOL_B}`],
      ['POST', `/api/v1/institutions/${SCHOOL_B}/deactivate`],
      // PRC-M018: the per-school overview aggregate is scope-gated too.
      ['GET', `/api/v1/institutions/${SCHOOL_B}/overview`],
    ] as const) {
      const res = await app.inject({
        method,
        url,
        headers: principalOfSchoolA(),
        ...(method === 'GET' ? {} : { payload: { name: 'Hijacked' } }),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().code).toBe('INSTITUTION_OUT_OF_SCOPE');
    }
  });

  it('does not scope-deny the caller own institution record', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/institutions/${SCHOOL_A}`,
      headers: principalOfSchoolA(),
    });
    expect(res.json().code).not.toBe('INSTITUTION_OUT_OF_SCOPE');
  });

  it("rejects another tenant's institutionId (cross-tenant)", async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: principalOfSchoolA(),
      payload: { institutionId: OTHER_TENANT_SCHOOL },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSTITUTION_OUT_OF_SCOPE');
  });

  it('allows the same user writing to their own institution (not a scope denial)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: principalOfSchoolA(),
      payload: { institutionId: SCHOOL_A },
    });
    // The gate lets it through to domain validation, which rejects the incomplete payload.
    expect(res.statusCode).toBe(400);
    expect(res.json().code).not.toBe('INSTITUTION_OUT_OF_SCOPE');
  });
});
