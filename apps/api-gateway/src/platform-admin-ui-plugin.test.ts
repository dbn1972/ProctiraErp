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
      const res = await app.inject({ method: 'GET', url: '/api/v1/tenants', headers: as('x', roles) });
      expect(res.statusCode).toBe(403);
    }
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/break-glass', headers: as('t', ['teacher']) }))
        .statusCode,
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
      payload: { reason: 'test' },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
