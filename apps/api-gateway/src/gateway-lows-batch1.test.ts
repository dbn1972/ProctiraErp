/**
 * Gateway low-severity audit gaps, batch 1 (PRC-L001 … PRC-L528).
 * Each describe block maps to one audit row.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];

const TENANT_A = '550e8400-e29b-41d4-a716-446655440000';

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

function headersFor(app: FastifyInstance, roleId: string, tenantId = TENANT_A) {
  return {
    authorization: `Bearer ${app.jwt.sign({
      sub: `${roleId}-1`,
      tenantId,
      email: `${roleId}@example.com`,
      displayName: roleId,
      roles: [{ roleId, roleName: roleId, areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${roleId}-${tenantId}`,
      sessionId: `session-${roleId}-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
  };
}

describe('gateway lows batch 1', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PRC-L001 /api/v1/meta contract endpoints', () => {
    it('teacher token reads error codes and deprecation policy (200)', async () => {
      for (const url of ['/api/v1/meta/error-codes', '/api/v1/meta/deprecation-policy']) {
        const res = await app.inject({ method: 'GET', url, headers: headersFor(app, 'teacher') });
        expect(res.statusCode, url).toBe(200);
      }
    });

    it('platform admin reads error codes (200)', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/meta/error-codes',
        headers: headersFor(app, 'platform_admin'),
      });
      expect(res.statusCode).toBe(200);
    });

    it('anonymous caller is still rejected (401)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/meta/error-codes' });
      expect(res.statusCode).toBe(401);
    });
  });
  describe('PRC-L003 tenant admin branding shares the lifecycle tenant store', () => {
    it('publish via /api/v1/tenant/branding is visible to the lifecycle TenantService', async () => {
      const tenant = await app.tenantService.createTenant({
        name: 'Shared Store School',
        slug: `shared-store-${Date.now()}`,
        admin: {
          firstName: 'Ada',
          lastName: 'Admin',
          email: 'ada@example.com',
          password: 'correct-horse-battery',
        },
      } as never);
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/tenant/branding/publish',
        headers: headersFor(app, 'admin', tenant.id),
        payload: { tokens: {}, publishedBy: '11111111-1111-4111-8111-111111111111' },
      });
      expect(res.statusCode, res.body).toBe(201);
      const published = res.json<{ id?: string }>();
      const versions = await app.tenantService.listBrandingVersions(tenant.id);
      expect(versions.length).toBe(1);
      expect(versions[0]!.id).toBe(published.id);
    });
  });
});
