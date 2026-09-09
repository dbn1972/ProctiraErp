/**
 * G-901 — the academics sub-domains defined in @proctira/backend-institution
 * are reachable through the gateway (previously only `/institutions` was
 * proxied, so `/academic-periods`, `/grades`, `/classes`, `/subjects` and
 * `/infrastructure/*` 404'd and the web pages rendered empty).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440001';

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

describe('G-901 academics mount', () => {
  let app: FastifyInstance;

  const adminHeaders = (tenantId = TENANT_A) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'admin-1',
      tenantId,
      email: 'admin@example.com',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${tenantId}`,
      sessionId: `session-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  });

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves /academic-periods → /grades → /classes for an admin and isolates tenants', async () => {
    const period = await app.inject({
      method: 'POST',
      url: '/api/v1/academic-periods',
      headers: adminHeaders(),
      payload: { name: 'AY 2026-27', code: 'AY26', startDate: '2026-04-01', endDate: '2027-03-31' },
    });
    expect(period.statusCode).toBe(201);

    const grade = await app.inject({
      method: 'POST',
      url: '/api/v1/grades',
      headers: adminHeaders(),
      payload: { name: 'Grade 7', code: 'G7', order: 7 },
    });
    expect(grade.statusCode).toBe(201);

    const institution = await app.inject({
      method: 'POST',
      url: '/api/v1/institutions',
      headers: adminHeaders(),
      payload: {
        name: 'Gateway School',
        code: `SCH-${Date.now()}`,
        areaId: '770e8400-e29b-41d4-a716-446655440002',
        typeId: '770e8400-e29b-41d4-a716-446655440003',
        sectorId: '770e8400-e29b-41d4-a716-446655440004',
        ownershipId: '770e8400-e29b-41d4-a716-446655440005',
      },
    });
    expect(institution.statusCode).toBe(201);

    const cls = await app.inject({
      method: 'POST',
      url: '/api/v1/classes',
      headers: adminHeaders(),
      payload: {
        institutionId: institution.json().id,
        gradeId: grade.json().id,
        academicPeriodId: period.json().id,
        name: '7-A',
        capacity: 40,
      },
    });
    expect(cls.statusCode).toBe(201);

    const classes = await app.inject({
      method: 'GET',
      url: `/api/v1/classes?institutionId=${institution.json().id}`,
      headers: adminHeaders(),
    });
    expect(classes.statusCode).toBe(200);
    expect(classes.json()).toHaveLength(1);

    const otherTenant = await app.inject({
      method: 'GET',
      url: '/api/v1/academic-periods',
      headers: adminHeaders(TENANT_B),
    });
    expect(otherTenant.statusCode).toBe(200);
    expect(otherTenant.json()).toHaveLength(0);
  });

  it('serves /infrastructure/hierarchy/:institutionId', async () => {
    const institutionId = '880e8400-e29b-41d4-a716-446655440006';
    const land = await app.inject({
      method: 'POST',
      url: '/api/v1/infrastructure/lands',
      headers: adminHeaders(),
      payload: { name: 'Main campus', institutionId, capacity: 5000, condition: 'GOOD' },
    });
    expect(land.statusCode).toBe(201);

    const hierarchy = await app.inject({
      method: 'GET',
      url: `/api/v1/infrastructure/hierarchy/${institutionId}`,
      headers: adminHeaders(),
    });
    expect(hierarchy.statusCode).toBe(200);
    expect(hierarchy.json().lands).toHaveLength(1);
  });

  it('denies unauthenticated access to the new prefixes', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/grades' });
    expect(res.statusCode).toBe(401);
  });
});
