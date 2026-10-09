/**
 * PRC-H044 — gateway integration: billing entitlement enforcement (G-811) and
 * the tenant self-service read GET /api/v1/billing/me/entitlements.
 *
 * Proves the production code path (not just the pure helper): with
 * BILLING_ENTITLEMENTS_ENFORCED=true a tenant with no plan is denied on a
 * quota-limited create, a seeded plan lets the create through, and the
 * self-service read returns the tenant's entitlements. Cross-tenant: tenant A's
 * read never reflects tenant B.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.js';
import type { GatewayConfig } from './config.js';

delete process.env['DATABASE_URL'];
process.env['BILLING_ENTITLEMENTS_ENFORCED'] = 'true';

const TENANT_NO_PLAN = '550e8400-e29b-41d4-a716-4466554400a1';
const TENANT_WITH_PLAN = '550e8400-e29b-41d4-a716-4466554400a2';

function jwtPayload(tenantId: string) {
  return {
    sub: `user-${tenantId}`,
    tenantId,
    email: 'test@example.com',
    displayName: 'Test User',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: 'root' }],
    areas: [],
    institutions: [],
    jti: `jti-${tenantId}`,
    sessionId: `session-${tenantId}`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

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
      students: { prefix: '/students', target: 'http://localhost:3003', healthCheck: '/health' },
    },
  };
}

describe('PRC-H044 gateway billing entitlement enforcement', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();

    // Seed a plan + subscription for TENANT_WITH_PLAN with a student seat cap.
    const plan = await app.billingService.createPlan({
      name: 'Seat Plan',
      description: 'seat-limited',
      tier: 'starter',
      features: [{ featureKey: 'library', enabled: true }],
      quotas: [{ metric: 'students', limit: 5 }],
      trialDays: 0,
    });
    await app.billingService.updatePlan(plan.id, { status: 'active' });
    await app.billingService.subscribeTenant({
      tenantId: TENANT_WITH_PLAN,
      planId: plan.id,
      startTrial: false,
    });
  });

  afterAll(async () => {
    delete process.env['BILLING_ENTITLEMENTS_ENFORCED'];
    await app.close();
  });

  it('denies student create with 402 when the tenant has no plan (fail closed)', async () => {
    const token = app.jwt.sign(jwtPayload(TENANT_NO_PLAN));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_NO_PLAN,
        'content-type': 'application/json',
      },
      payload: { firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '2010-01-01' },
    });
    expect(res.statusCode).toBe(402);
    expect(res.json().code).toBe('SUBSCRIPTION_REQUIRED');
  });

  it('allows student create (past the billing gate) when the tenant has quota', async () => {
    const token = app.jwt.sign(jwtPayload(TENANT_WITH_PLAN));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/students',
      headers: {
        authorization: `Bearer ${token}`,
        'x-tenant-id': TENANT_WITH_PLAN,
        'content-type': 'application/json',
      },
      payload: { firstName: 'Ada', lastName: 'Lovelace', dateOfBirth: '2010-01-01' },
    });
    // The downstream proxy target is unreachable in this test, so we only assert
    // the billing gate did not block (no 402/403/429 billing code).
    expect([402, 403, 429]).not.toContain(res.statusCode);
    const code = res.json()?.code;
    expect(['SUBSCRIPTION_REQUIRED', 'FEATURE_NOT_ENTITLED', 'QUOTA_EXCEEDED']).not.toContain(code);
  });

  it('serves GET /billing/me/entitlements for a subscribed tenant', async () => {
    const token = app.jwt.sign(jwtPayload(TENANT_WITH_PLAN));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/me/entitlements',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_WITH_PLAN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscribed).toBe(true);
    expect(body.features.some((f: { featureKey: string }) => f.featureKey === 'library')).toBe(
      true,
    );
    expect(body.quotas.some((q: { metric: string }) => q.metric === 'students')).toBe(true);
  });

  it('fails closed on GET /billing/me/entitlements for a tenant with no plan', async () => {
    const token = app.jwt.sign(jwtPayload(TENANT_NO_PLAN));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/me/entitlements',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_NO_PLAN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.subscribed).toBe(false);
    expect(body.status).toBe('none');
    expect(body.features).toEqual([]);
    expect(body.quotas).toEqual([]);
  });

  it('does not let tenant A read tenant B entitlements (scoped to JWT tenant)', async () => {
    // TENANT_NO_PLAN asks; even if it spoofs the header to TENANT_WITH_PLAN, the
    // JWT tenant governs. Here the JWT is TENANT_NO_PLAN so the result is empty.
    const token = app.jwt.sign(jwtPayload(TENANT_NO_PLAN));
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/billing/me/entitlements',
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_WITH_PLAN },
    });
    const body = res.json();
    // Must reflect the caller's own (empty) entitlements, never TENANT_WITH_PLAN's.
    expect(body.subscribed).toBe(false);
    expect(body.quotas).toEqual([]);
  });
});
