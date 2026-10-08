/**
 * PRC-M018 — platform-admin console routes through buildApp: role gate,
 * break-glass state machine and tenant lifecycle validation.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { authHeaders, createTestConfig, TEST_TENANT_ID } from './__tests__/gateway-test-kit.js';
import { buildApp } from './app.js';

delete process.env['DATABASE_URL'];

describe('platform-admin console (PRC-M018)', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  const as = (sub: string, roles: string[]) => authHeaders(app, { sub, roles });

  it('role gate: tenant admin and teacher are denied, platform admin allowed', async () => {
    for (const roles of [['teacher'], ['admin']]) {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/tenants',
        headers: as('x', roles),
      });
      expect(res.statusCode).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/break-glass',
          headers: as('t', ['teacher']),
        })
      ).statusCode,
    ).toBe(403);
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: as('pa-1', ['super-admin']),
    });
    expect(ok.statusCode).toBe(200);
  });

  it('break-glass: create → second admin approves → revoke; terminal state rejects further decisions', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/break-glass',
      headers: as('pa-requester', ['super-admin']),
      payload: {
        targetTenantId: TEST_TENANT_ID,
        justification: 'Incident INC-1234 data repair needs read access',
        scope: 'read',
        durationMinutes: 30,
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = (created.json() as { id: string; status: string }).id;
    expect(created.json().status).toBe('pending_approval');

    const selfApprove = await app.inject({
      method: 'POST',
      url: `/api/v1/break-glass/${id}/approve`,
      headers: as('pa-requester', ['super-admin']),
    });
    expect(selfApprove.statusCode).toBeGreaterThanOrEqual(400);

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/break-glass/${id}/approve`,
      headers: as('pa-approver', ['super-admin']),
    });
    expect(approved.statusCode, approved.body).toBe(200);

    const revoked = await app.inject({
      method: 'POST',
      url: `/api/v1/break-glass/${id}/revoke`,
      headers: as('pa-approver', ['super-admin']),
      payload: { reason: 'incident closed' },
    });
    expect(revoked.statusCode, revoked.body).toBe(200);

    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/break-glass/${id}/approve`,
      headers: as('pa-other', ['super-admin']),
    });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(again.statusCode).toBeLessThan(500);
  });

  it('break-glass validation: short justification is rejected', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/break-glass',
      headers: as('pa-1', ['super-admin']),
      payload: { targetTenantId: TEST_TENANT_ID, justification: 'too short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('tenant lifecycle: suspend requires a reason; unknown tenant is 404', async () => {
    const noReason = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TEST_TENANT_ID}/suspend`,
      headers: as('pa-1', ['super-admin']),
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/tenants/00000000-0000-4000-8000-00000000dead/suspend',
      headers: as('pa-1', ['super-admin']),
      // A valid (10–500 char) reason, so the request reaches the tenant lookup.
      payload: { reason: 'Suspend an unknown tenant' },
    });
    expect(unknown.statusCode).toBe(404);
  });
});

describe('PRC-H001 per-area platform RBAC', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ config: createTestConfig() });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  const as = (sub: string, roles: string[]) => authHeaders(app, { sub, roles });

  it('a security-only token is 403 on POST /tenants/:id/suspend (billing area)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/tenants/${TEST_TENANT_ID}/suspend`,
      headers: as('sec-1', ['security']),
      payload: { reason: 'should not be allowed for security role' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('FORBIDDEN');
  });

  it('a security-only token is allowed on plugin decisions (not 403)', async () => {
    // Reaches the handler (404 for an unknown plugin id), proving it passed the area gate.
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/plugins/plg_unknown/approve',
      headers: as('sec-1', ['security']),
      payload: { reason: 'approved after security review' },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('a billing-only token is allowed on /tenants but 403 on plugin decisions', async () => {
    const tenants = await app.inject({
      method: 'GET',
      url: '/api/v1/tenants',
      headers: as('bill-1', ['billing']),
    });
    expect(tenants.statusCode).not.toBe(403);

    const plugin = await app.inject({
      method: 'POST',
      url: '/api/v1/plugins/plg_001/approve',
      headers: as('bill-1', ['billing']),
      payload: { reason: 'billing should not approve plugins' },
    });
    expect(plugin.statusCode).toBe(403);
  });

  it('a security-only token cannot create a break-glass request area it lacks? (request allows security)', async () => {
    // breakGlassRequest allows security; the create reaches the handler (201).
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/break-glass',
      headers: as('sec-2', ['security']),
      payload: {
        targetTenantId: TEST_TENANT_ID,
        justification: 'Security review requires temporary read access to logs',
        scope: 'read',
        durationMinutes: 30,
      },
    });
    expect(res.statusCode).not.toBe(403);
  });

  it('a billing-only token is 403 creating a break-glass request (billing not in that area)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/break-glass',
      headers: as('bill-2', ['billing']),
      payload: {
        targetTenantId: TEST_TENANT_ID,
        justification: 'Billing has no break-glass area access at all',
        scope: 'read',
        durationMinutes: 30,
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('super-admin keeps full access across areas', async () => {
    for (const url of ['/api/v1/tenants', '/api/v1/plugins', '/api/v1/break-glass']) {
      const res = await app.inject({ method: 'GET', url, headers: as('pa', ['super-admin']) });
      expect(res.statusCode).not.toBe(403);
    }
  });
});
