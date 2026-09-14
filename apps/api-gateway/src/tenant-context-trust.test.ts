/**
 * W1-SEC-01 (A4) — tenant authorization scope must come from verified
 * JWT/session only; client X-Tenant-ID must never grant cross-tenant access.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import { healthUiPlugin } from './health-ui-plugin.js';
import { HEALTH_DEMO_TENANT_ID, HEALTH_STUDENT_A_ID } from './health-ui-seed.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = HEALTH_DEMO_TENANT_ID;
const TENANT_B = '11111111-1111-4111-8111-111111111111';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    tenantId: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    areas: [],
    institutions: [],
    jti: 'test-jti-123',
    sessionId: 'test-session-123',
    ...overrides,
  } as Record<string, unknown>;
}

function createTestConfig(overrides?: Partial<GatewayConfig>): GatewayConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    env: 'test',
    rateLimiting: { windowMs: 60000, maxRequests: 100 },
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
      auth: {
        prefix: '/auth',
        target: 'http://127.0.0.1:1',
        healthCheck: '/health',
      },
    },
    ...overrides,
  };
}

describe('W1-SEC-01 (A4) tenant context trust', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects authenticated requests when JWT lacks tenantId and only X-Tenant-ID is supplied', async () => {
    const { tenantId: _omit, ...payloadWithoutTenant } = createTestJwtPayload();
    const token = app.jwt.sign(payloadWithoutTenant);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_B,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('TENANT_RESOLUTION_FAILED');
  });

  it('JWT-bound tenant wins over mismatched X-Tenant-ID on protected routes', async () => {
    const jwtTenant = '550e8400-e29b-41d4-a716-446655440000';
    const token = app.jwt.sign(createTestJwtPayload({ tenantId: jwtTenant }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/institutions',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_B,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toBeInstanceOf(Array);
  });

  it('health UI must not prefer X-Tenant-ID over JWT user.tenantId when request.tenantId is unset', async () => {
    const local = Fastify();
    local.addHook('onRequest', async (request) => {
      (request as { user?: { sub: string; tenantId: string; roles: unknown[] } }).user = {
        sub: 'u1',
        tenantId: TENANT_A,
        roles: [{ roleId: 'health_officer', roleName: 'HEALTH_OFFICER', areaId: 'area-1' }],
      };
    });
    await local.register(healthUiPlugin);
    await local.ready();

    const response = await local.inject({
      method: 'GET',
      url: '/health/records',
      headers: { 'x-tenant-id': TENANT_B },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { data: unknown[] };
    expect(body.data.length).toBeGreaterThan(0);

    await local.close();
  });
});
