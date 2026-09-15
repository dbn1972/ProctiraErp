/**
 * W1-SEC-01 — authenticated tenant scope is the verified JWT UUID. Client
 * headers and supported hostname slugs may only corroborate that identity.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';
const TENANT_B = '660e8400-e29b-41d4-a716-446655440000';

function createTestJwtPayload(overrides?: Record<string, unknown>) {
  return {
    sub: 'user-123',
    tenantId: TENANT_A,
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

function createTestConfig(): GatewayConfig {
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
  };
}

describe('W1-SEC-01 tenant context trust', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const tenantsBySlug: Record<string, string> = {
      'tenant-a': TENANT_A,
      'tenant-b': TENANT_B,
    };
    app = await buildApp({
      config: createTestConfig(),
      tenantSlugResolver: async (slug) => tenantsBySlug[slug],
    });
    app.get('/_test/tenant-context', async (request) => ({
      tenantId: request.tenantId ?? null,
      tenantSource: request.tenantSource ?? null,
      tenantHeader: request.headers['x-tenant-id'] ?? null,
    }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects JWT tenant A with X-Tenant-ID B using 403', async () => {
    const token = app.jwt.sign(createTestJwtPayload());

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_B,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'TENANT_CONTEXT_MISMATCH',
      statusCode: 403,
    });
  });

  it('rejects JWT tenant A with trusted hostname tenant B using 403', async () => {
    const token = app.jwt.sign(createTestJwtPayload());

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: {
        authorization: `Bearer ${token}`,
        host: 'tenant-b.proctira.org',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 'TENANT_CONTEXT_MISMATCH',
      statusCode: 403,
    });
  });

  it('rejects an authenticated request missing a JWT tenant even when a header is supplied', async () => {
    const { tenantId: _omit, ...payloadWithoutTenant } = createTestJwtPayload();
    const token = app.jwt.sign(payloadWithoutTenant);

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_A,
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'TENANT_RESOLUTION_FAILED',
      statusCode: 401,
    });
  });

  it('rejects an authenticated request missing a JWT tenant even when a trusted host is supplied', async () => {
    const { tenantId: _omit, ...payloadWithoutTenant } = createTestJwtPayload();
    const token = app.jwt.sign(payloadWithoutTenant);

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: {
        authorization: `Bearer ${token}`,
        host: 'tenant-a.proctira.org',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'TENANT_RESOLUTION_FAILED',
      statusCode: 401,
    });
  });

  it('rejects a malformed authenticated JWT tenant claim without echoing it', async () => {
    const malformedTenant = 'not-a-tenant-uuid';
    const token = app.jwt.sign(createTestJwtPayload({ tenantId: malformedTenant }));

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      code: 'TENANT_RESOLUTION_FAILED',
      statusCode: 401,
    });
    expect(response.body).not.toContain(malformedTenant);
  });

  it('keeps excluded public flows available without trusting tenant candidates', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: {
        host: 'tenant-b.proctira.org',
        'x-tenant-id': 'malformed-public-candidate',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('healthy');
  });

  it('accepts matching JWT, header, and trusted hostname contexts and strips the header', async () => {
    const token = app.jwt.sign(createTestJwtPayload());

    const response = await app.inject({
      method: 'GET',
      url: '/_test/tenant-context',
      headers: {
        authorization: `Bearer ${token}`,
        host: 'tenant-a.proctira.org',
        'x-tenant-id': TENANT_A,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      tenantId: TENANT_A,
      tenantSource: 'jwt',
      tenantHeader: null,
    });
  });
});
