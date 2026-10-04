/**
 * PRC-H005: the platform-admin console must show real health, real audit rows and act on the
 * real tenant lifecycle — not hard-coded payloads and a console-only tenant store.
 */
import type { TenantAdminProvisioner, TenantService } from '@proctira/backend-tenant';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';
import { probePostgres, queryPlatformAudit, type SqlPool } from './platform-admin-live.js';

delete process.env['DATABASE_URL'];

const testAdminProvisioner: TenantAdminProvisioner = {
  // PRC-H099: the lifecycle refuses to create a tenant without an admin provisioner.
  provisionTenantAdmin: ({ tenantId }) => Promise.resolve({ adminUserId: `admin-of-${tenantId}` }),
};

describe('probePostgres', () => {
  it('reports down (not up) when the database probe fails', async () => {
    const dead: SqlPool = {
      query: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    };
    const probe = await probePostgres(dead);
    expect(probe.status).toBe('down');
    expect(probe.note).toContain('ECONNREFUSED');
  });

  it('reports healthy only after a successful round-trip', async () => {
    const live: SqlPool = { query: () => Promise.resolve({ rows: [{ '?column?': 1 }] }) };
    expect((await probePostgres(live)).status).toBe('healthy');
  });

  it('reports unknown when no database is configured', async () => {
    expect((await probePostgres(null)).status).toBe('unknown');
  });
});

describe('queryPlatformAudit', () => {
  it('returns only rows read from audit_log_entries', async () => {
    const statements: string[] = [];
    const pool: SqlPool = {
      query: (text) => {
        statements.push(text);
        if (!text.includes('audit_log_entries')) return Promise.resolve({ rows: [] });
        return Promise.resolve({
          rows: [
            {
              id: 'a1',
              tenant_id: 't1',
              entity_type: 'student',
              entity_id: 's1',
              operation: 'UPDATE',
              user_id: 'u1',
              user_name: 'Registrar',
              occurred_at: new Date('2026-01-01T00:00:00Z'),
              metadata: { reason: 'correction' },
            },
          ],
        });
      },
    };
    const rows = await queryPlatformAudit(pool);
    // FORCE RLS: the read must run with the platform-admin GUC bound first.
    const scopeIdx = statements.findIndex((q) =>
      q.includes("set_config('app.platform_admin', '1'"),
    );
    const readIdx = statements.findIndex((q) => q.includes('FROM audit_log_entries'));
    expect(scopeIdx).toBeGreaterThanOrEqual(0);
    expect(readIdx).toBeGreaterThan(scopeIdx);
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'a1',
        action: 'student.update',
        actor: 'Registrar',
        tenantId: 't1',
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain('Live gateway');
  });
});

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

describe('platform-admin console routes (gateway)', () => {
  let app: FastifyInstance;
  const PLATFORM_TENANT = '550e8400-e29b-41d4-a716-446655440000';

  const platformAdmin = () => ({
    authorization: `Bearer ${app.jwt.sign({
      sub: 'platform-op',
      tenantId: PLATFORM_TENANT,
      email: 'op@proctira.org',
      displayName: 'Platform Op',
      roles: [{ roleId: 'platform_admin', roleName: 'Platform admin', areaId: null }],
      areas: [],
      institutions: [],
      jti: 'jti-platform-op',
      sessionId: 'session-platform-op',
    } as never)}`,
    'x-tenant-id': PLATFORM_TENANT,
    'content-type': 'application/json',
  });

  beforeAll(async () => {
    app = await buildApp({ config: config(), tenantAdminProvisioner: testAdminProvisioner });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('health does not claim postgres is up when no database was probed', async () => {
    const health = await app.inject({
      method: 'GET',
      url: '/api/v1/platform/health',
      headers: platformAdmin(),
    });
    expect(health.statusCode).toBe(200);
    const pg = health.json().services.find((s: { name: string }) => s.name === 'postgres');
    expect(pg.status).not.toBe('up');
    expect(health.json().status).toBe('unknown');

    const system = await app.inject({
      method: 'GET',
      url: '/api/v1/health/system',
      headers: platformAdmin(),
    });
    const adapter = system.json().adapters.find((a: { name: string }) => a.name === 'PostgreSQL');
    expect(adapter.status).not.toBe('healthy');
    expect(adapter.note).not.toContain('Live gateway probe');
  });

  it('audit feed contains no fabricated rows', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: platformAdmin() });
    expect(res.statusCode).toBe(200);
    expect(res.json().items).toEqual([]);
    expect(res.json().meta.source).toBe('unavailable');
  });

  it('console suspend changes the real tenant status', async () => {
    const tenantService = (app as FastifyInstance & { tenantService: TenantService }).tenantService;
    const tenant = await tenantService.createTenant({
      name: 'H005 School',
      slug: `h005-${Date.now().toString(36)}`,
      admin: {
        firstName: 'Ada',
        lastName: 'Admin',
        email: 'ada@h005.example',
        password: 'correct-horse-battery',
      },
    });
    expect(tenant.status).toBe('active');

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: platformAdmin(),
    });
    expect(listed.json().items.map((t: { id: string }) => t.id)).toContain(tenant.id);

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.id}/suspend`,
      headers: platformAdmin(),
      payload: { reason: 'Unpaid invoice (H005 test)' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('suspended');
    expect((await tenantService.getTenantById(tenant.id)).status).toBe('suspended');

    // Suspending again is rejected by the real lifecycle rules, not silently accepted.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.id}/suspend`,
      headers: platformAdmin(),
      payload: { reason: 'again' },
    });
    expect(again.statusCode).toBe(422);
  });

  async function makeTenant(slugPrefix: string) {
    const tenantService = (app as FastifyInstance & { tenantService: TenantService }).tenantService;
    const tenant = await tenantService.createTenant({
      name: `${slugPrefix} School`,
      slug: `${slugPrefix}-${Date.now().toString(36)}`,
      admin: {
        firstName: 'A',
        lastName: 'B',
        email: 'a@b.example',
        password: 'correct-horse-battery',
      },
    });
    return { tenantService, tenant };
  }

  it('requires a reason for suspend and decommission (same rule as /tenant-lifecycle)', async () => {
    const { tenant } = await makeTenant('reason');
    for (const action of ['suspend', 'decommission']) {
      for (const payload of [{}, { reason: '' }, { reason: 'x'.repeat(501) }]) {
        const res = await app.inject({
          method: 'POST',
          url: `/api/v1/tenants/${tenant.id}/${action}`,
          headers: platformAdmin(),
          payload,
        });
        expect(res.statusCode, `${action} ${JSON.stringify(payload).slice(0, 30)}`).toBe(400);
      }
    }
  });

  it('decommission honours retainDataDays and reports honest placeholders', async () => {
    const { tenantService, tenant } = await makeTenant('retain');
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${tenant.id}/decommission`,
      headers: platformAdmin(),
      payload: { reason: 'Contract ended', retainDataDays: 90 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('decommissioning');
    expect(res.json().activeUsers).toBeNull();
    expect(res.json().contactEmail).toBeNull();
    const stored = await tenantService.getTenantById(tenant.id);
    const days = (stored.dataRetentionUntil!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    expect(days).toBeLessThan(91);
  });

  it('does not permanently delete a tenant from the console', async () => {
    const { tenantService, tenant } = await makeTenant('nodelete');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/tenants/${tenant.id}`,
      headers: platformAdmin(),
    });
    expect(res.statusCode).toBe(501);
    expect((await tenantService.getTenantById(tenant.id)).id).toBe(tenant.id);
  });

  it('console create refuses instead of creating a console-only tenant', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants',
      headers: platformAdmin(),
      payload: {
        name: 'Console Only',
        slug: 'console-only',
        contactEmail: 'a@b.c',
        plan: 'pilot',
        region: 'eu-west-1',
      },
    });
    expect(res.statusCode).toBe(501);
  });
});
