/**
 * PRC-H008 / PRC-H098: suspending a tenant through the tenant lifecycle must reach the gateway
 * suspension gate (it used to be fed only from TENANT_SUSPENDED_IDS).
 */
import type { TenantAdminProvisioner, TenantService } from '@proctira/backend-tenant';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import {
  clearSuspendedTenantsForTests,
  configureTenantStatusSource,
  currentTenantStatusSource,
  noteTenantStatusChange,
  resolveTenantBlocked,
} from './tenant-entitlement.js';

delete process.env['DATABASE_URL'];

const testAdminProvisioner: TenantAdminProvisioner = {
  // PRC-H099: the lifecycle refuses to create a tenant without an admin provisioner.
  provisionTenantAdmin: ({ tenantId }) => Promise.resolve({ adminUserId: `admin-of-${tenantId}` }),
};

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
    app = await buildApp({ config: config(), tenantAdminProvisioner: testAdminProvisioner });
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
        url: '/api/v1/communication/campaigns',
        headers,
        payload: { name: `H008 ${Date.now()}` },
      });

    const before = await write();
    expect(before.statusCode).toBe(201);

    await tenantService.suspendTenant(tenant.id, { reason: 'Unpaid invoice' });
    const during = await write();
    expect(during.statusCode).toBe(403);
    expect(during.json().code).toBe('TENANT_SUSPENDED');

    // Reads stay available while suspended (read-only mode).
    const read = await app.inject({ method: 'GET', url: '/api/v1/students', headers });
    expect(read.json()?.code).not.toBe('TENANT_SUSPENDED');

    await tenantService.reactivateTenant(tenant.id);
    const after = await write();
    expect(after.statusCode).toBe(201);
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

  it('billing remediation and privacy requests stay reachable while suspended', async () => {
    const tenant = await createTenant('remed');
    await tenantService.suspendTenant(tenant.id, { reason: 'Unpaid invoice' });
    for (const url of ['/api/v1/billing/subscriptions/x/reactivate', '/api/v1/privacy/requests']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: adminOf(tenant.id),
        payload: {},
      });
      expect(res.json()?.code, url).not.toBe('TENANT_SUSPENDED');
    }
  });

  it('an in-flight store read cannot overwrite a newer lifecycle event', async () => {
    const tenant = await createTenant('race');
    let release!: (v: 'active') => void;
    const pending = new Promise<'active'>((r) => (release = r));
    const previous = currentTenantStatusSource();
    configureTenantStatusSource(() => pending);
    try {
      const inFlight = resolveTenantBlocked(tenant.id); // reads "active" slowly
      noteTenantStatusChange(tenant.id, 'suspended'); // event lands meanwhile
      release('active');
      expect(await inFlight).toBe(true);
      expect(await resolveTenantBlocked(tenant.id)).toBe(true);
    } finally {
      configureTenantStatusSource(previous);
    }
  });

  it('a second gateway sharing the store enforces a suspension it never received as an event', async () => {
    const tenant = await createTenant('multi');
    // Suspend behind every listener's back (e.g. another instance's write), then drop caches.
    const repo = (
      tenantService as unknown as {
        repository: { updateTenant(id: string, p: object): Promise<unknown> };
      }
    ).repository;
    await repo.updateTenant(tenant.id, { status: 'suspended' });
    clearSuspendedTenantsForTests();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/communication/campaigns',
      headers: adminOf(tenant.id),
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('TENANT_SUSPENDED');
  });

  it('fails closed with 503 for writes when the tenant store lookup fails', async () => {
    const tenant = await createTenant('fail');
    const previous = currentTenantStatusSource();
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
      configureTenantStatusSource(previous);
    }
  });
});
