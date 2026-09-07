/**
 * Notifications — gated live prefs write + cross-tenant isolation.
 * Requires E2E_BACKEND_READY=1 and JWT_SECRET aligned with the gateway.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
const USER_SUB = `prefs-e2e-${Date.now()}`;

function gatewayAuthHeaders(sub: string, tenantId: string): Record<string, string> {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

test.describe('Notifications — live prefs (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and live gateway (JWT uses JWT_SECRET or gateway default)',
  );

  test('PATCH preferences and expose sandbox delivery capabilities', async ({ request }) => {
    const caps = await request.get(`${GATEWAY_URL}/api/v1/notifications/delivery-capabilities`, {
      headers: gatewayAuthHeaders(USER_SUB, TENANT_A),
    });
    const capsBody = await caps.json();
    expect(caps.status(), JSON.stringify(capsBody)).toBe(200);
    expect(capsBody.sms.mode).toBe('sandbox');
    expect(capsBody.email.mode).toBe('sandbox');
    expect(capsBody.push.mode).toBe('sandbox');
    expect(String(capsBody.sms.honestyNote)).toMatch(/sandbox/i);
    expect(String(capsBody.email.honestyNote)).toMatch(/sandbox/i);
    expect(String(capsBody.push.honestyNote)).toMatch(/sandbox/i);

    const patch = await request.patch(`${GATEWAY_URL}/api/v1/notifications/preferences`, {
      headers: gatewayAuthHeaders(USER_SUB, TENANT_A),
      data: {
        digestFrequency: 'weekly',
        quietHours: {
          enabled: true,
          startTime: '21:00',
          endTime: '06:00',
          days: [1, 2, 3, 4, 5],
        },
      },
    });
    const prefs = await patch.json();
    expect(patch.status(), JSON.stringify(prefs)).toBe(200);
    expect(prefs.digestFrequency).toBe('weekly');
    expect(prefs.quietHours.enabled).toBe(true);

    const get = await request.get(`${GATEWAY_URL}/api/v1/notifications/preferences`, {
      headers: gatewayAuthHeaders(USER_SUB, TENANT_A),
    });
    const stored = await get.json();
    expect(get.status(), JSON.stringify(stored)).toBe(200);
    expect(stored.digestFrequency).toBe('weekly');
  });

  test('register a push device for the signed-in user', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/notifications/devices`, {
      headers: gatewayAuthHeaders(USER_SUB, TENANT_A),
      data: {
        platform: 'web',
        pushToken: `e2e-token-${Date.now()}`,
      },
    });
    const device = await create.json();
    expect(create.status(), JSON.stringify(device)).toBe(201);
    expect(device.platform).toBe('web');

    const list = await request.get(`${GATEWAY_URL}/api/v1/notifications/devices`, {
      headers: gatewayAuthHeaders(USER_SUB, TENANT_A),
    });
    const body = await list.json();
    expect(list.status(), JSON.stringify(body)).toBe(200);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((d: { id: string }) => d.id === device.id)).toBe(true);
  });

  test('cross-tenant isolation: tenant B does not see tenant A prefs', async ({ request }) => {
    const marker = `iso-${Date.now()}`;
    const sub = `prefs-iso-${marker}`;

    const patchA = await request.patch(`${GATEWAY_URL}/api/v1/notifications/preferences`, {
      headers: gatewayAuthHeaders(sub, TENANT_A),
      data: {
        digestFrequency: 'daily',
        quietHours: {
          enabled: true,
          startTime: '23:00',
          endTime: '05:00',
          days: [0, 6],
        },
      },
    });
    expect(patchA.status()).toBe(200);

    const getB = await request.get(`${GATEWAY_URL}/api/v1/notifications/preferences`, {
      headers: gatewayAuthHeaders(sub, TENANT_B),
    });
    const prefsB = await getB.json();
    expect(getB.status(), JSON.stringify(prefsB)).toBe(200);
    // Same opaque sub, different tenant → defaults, not tenant A weekly/daily patch.
    expect(prefsB.digestFrequency).toBe('immediate');
    expect(prefsB.quietHours.enabled).toBe(false);
  });
});
