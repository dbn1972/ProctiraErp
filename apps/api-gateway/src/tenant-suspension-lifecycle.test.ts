/**
 * PRC-H008 / PRC-H098: suspending a tenant through the tenant lifecycle must reach the gateway
 * suspension gate (it used to be fed only from TENANT_SUSPENDED_IDS).
 */
import type { TenantService } from '@proctira/backend-tenant';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  clearSuspendedTenantsForTests,
  configureTenantStatusSource,
  resolveTenantBlocked,
} from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

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

describe('tenant suspension reaches the gateway gate', () => {
  let app: FastifyInstance;
  let tenantService: TenantService;

  beforeAll(async () => {
    app = await buildApp({ config: config() });
    await app.ready();
    tenantService = (app as FastifyInstance & { tenantService: TenantService }).tenantService;
  });

  afterAll(async () => {
    clearSuspendedTenantsForTests();
    await app.close();
  });

  afterEach(() => clearSuspendedTenantsForTests());

  const adminOf = (tenantId: string) => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: `admin-${tenantId.slice(0, 8)}`,
      tenantId,
      email: 'admin@school.example',
      displayName: 'Admin',
      roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
      areas: [],
      institutions: [],
      jti: `jti-${tenantId}`,
      sessionId: `session-${tenantId}`,
    } as never)}`,
    'x-tenant-id': tenantId,
    'content-type': 'application/json',
  });

  async function createTenant(prefix: string) {
    return tenantService.createTenant({
      name: `${prefix} School`,
      slug: `${prefix}-${Date.now().toString(36)}`,
      admin: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.example',
        password: 'correct-horse-battery',
      },
    });
  }

  it('suspend via the lifecycle -> write with a pre-existing JWT is 403; reactivate -> allowed', async () => {
    const tenant = await createTenant('susp');
    const headers = adminOf(tenant.id); // token issued while the tenant was active
    const write = () =>
      app.inject({
        method: 'POST',
        url: '/api/v1/students',
        headers,
        payload: { firstName: 'Ada', lastName: 'Lovelace' },
      });

    const before = await write();
    expect(before.json()?.code).not.toBe('TENANT_SUSPENDED');

    await tenantService.suspendTenant(tenant.id, { reason: 'Unpaid invoice' });
    const during = await write();
    expect(during.statusCode).toBe(403);
    expect(during.json().code).toBe('TENANT_SUSPENDED');

    // Reads stay available while suspended (read-only mode).
    const read = await app.inject({ method: 'GET', url: '/api/v1/students', headers });
    expect(read.json()?.code).not.toBe('TENANT_SUSPENDED');

    await tenantService.reactivateTenant(tenant.id);
    const after = await write();
    expect(after.json()?.code).not.toBe('TENANT_SUSPENDED');
  });

  it('decommissioned tenants are blocked too', async () => {
    const tenant = await createTenant('decom');
    await tenantService.decommissionTenant(tenant.id, { reason: 'Contract ended' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: adminOf(tenant.id),
      payload: { firstName: 'X', lastName: 'Y' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TENANT_SUSPENDED');
  });

  it('another gateway instance sees the suspension from the store (no local event)', async () => {
    const tenant = await createTenant('multi');
    // Simulate a second instance: same store, but it never received the lifecycle event.
    let reads = 0;
    configureTenantStatusSource(
      async () => {
        reads += 1;
        return 'suspended';
      },
      { ttlMs: 50 },
    );
    try {
      expect(await resolveTenantBlocked(tenant.id)).toBe(true);
      expect(reads).toBe(1);
    } finally {
      // Restore the app's own wiring for later tests.
      const repo = tenantService as unknown as {
        repository: { findTenantById(id: string): Promise<{ status: string } | null> };
      };
      configureTenantStatusSource(async (id) => {
        const t = await repo.repository.findTenantById(id);
        return (t?.status as never) ?? null;
      });
    }
  });

  it('fails closed with 503 for writes when the tenant store lookup fails', async () => {
    const tenant = await createTenant('fail');
    configureTenantStatusSource(async () => {
      throw new Error('db down');
    });
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/students',
        headers: adminOf(tenant.id),
        payload: { firstName: 'X', lastName: 'Y' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('TENANT_STATUS_UNAVAILABLE');
    } finally {
      const repo = tenantService as unknown as {
        repository: { findTenantById(id: string): Promise<{ status: string } | null> };
      };
      configureTenantStatusSource(async (id) => {
        const t = await repo.repository.findTenantById(id);
        return (t?.status as never) ?? null;
      });
    }
  });
});
