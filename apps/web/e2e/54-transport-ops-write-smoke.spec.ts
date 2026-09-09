/**
 * Transport ops — stops, assignment, GPS live (Wave 9 / G-920).
 *
 * Ungated: the transport hub renders with a heading.
 * Gated (E2E_BACKEND_READY): create route → stop → assign student → GPS ping
 * visible on GET /transport/live; tenant B isolation.
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function headers(tenantId = TENANT_A, sub = 'e2e-admin') {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: 'E2E Admin',
    tenantId,
    roles: [{ roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null }],
    institutions: [],
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Tenant-ID': tenantId,
  };
}

async function postOk(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected: number,
  extraHeaders: Record<string, string> = {},
  tenantId = TENANT_A,
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: { ...headers(tenantId), ...extraHeaders },
    data,
  });
  expect(res.status(), `${path}: ${await res.text()}`).toBe(expected);
  return res.json();
}

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Transport ops — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/transport lists with a heading', async ({ page }) => {
    await page.goto('/transport', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/transport/live lists with a heading', async ({ page }) => {
    await page.goto('/transport/live', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});

test.describe('Transport ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('stop → assign → GPS ping visible on live map', async ({ page, request }) => {
    const stamp = Date.now().toString(36);
    const route = await postOk(
      request,
      '/transport/routes',
      {
        name: `E2E Loop ${stamp}`,
        startLocation: 'Depot',
        endLocation: 'School',
        operatingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        departureTime: '07:30',
      },
      201,
    );
    const stop = await postOk(
      request,
      '/transport/stops',
      {
        routeId: route.id,
        name: `Oak ${stamp}`,
        stopOrder: 1,
        latitude: 19.076,
        longitude: 72.8777,
        pickupTime: '07:15',
      },
      201,
    );
    const student = await postOk(
      request,
      '/students',
      {
        firstName: 'Rider',
        lastName: stamp,
        dateOfBirth: '2012-04-01',
        gender: 'male',
      },
      201,
    );
    await postOk(
      request,
      '/transport/student-assignments',
      {
        studentId: student.id,
        routeId: route.id,
        stopId: stop.id,
        startDate: new Date().toISOString().slice(0, 10),
      },
      201,
    );
    const vehicle = await postOk(
      request,
      '/transport/vehicles',
      { registrationNumber: `E2E-${stamp}`.slice(0, 20), capacity: 40 },
      201,
    );
    const device = await postOk(request, `/transport/vehicles/${vehicle.id}/device`, {}, 201);
    await postOk(
      request,
      '/transport/gps',
      {
        deviceId: device.deviceId,
        pings: [{ pingId: `ping-${stamp}`, latitude: 19.076, longitude: 72.8777 }],
      },
      201,
      { 'X-Transport-Device-Key': device.deviceKey as string },
    );

    const live = await request.get(`${GATEWAY_URL}/api/v1/transport/live`, {
      headers: headers(),
    });
    expect(live.status()).toBe(200);
    const body = await live.json();
    expect(body.vehicles.some((v: { vehicleId: string }) => v.vehicleId === vehicle.id)).toBe(true);

    await page.goto('/transport/live', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('transport-live-bus').first()).toBeVisible();
    await hydrated(page, 'transport-gps-form').catch(() => undefined);
  });

  test('cross-tenant: tenant B cannot read tenant A live GPS', async ({ request }) => {
    const stamp = Date.now().toString(36);
    const vehicle = await postOk(
      request,
      '/transport/vehicles',
      { registrationNumber: `ISO-${stamp}`.slice(0, 20), capacity: 20 },
      201,
    );
    const device = await postOk(request, `/transport/vehicles/${vehicle.id}/device`, {}, 201);
    await postOk(
      request,
      '/transport/gps',
      {
        deviceId: device.deviceId,
        pings: [{ pingId: `iso-${stamp}`, latitude: 19.1, longitude: 72.8 }],
      },
      201,
      { 'X-Transport-Device-Key': device.deviceKey as string },
    );
    const res = await request.get(`${GATEWAY_URL}/api/v1/transport/live`, {
      headers: headers(TENANT_B),
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(
      (body.vehicles as Array<{ vehicleId: string }>).some((v) => v.vehicleId === vehicle.id),
    ).toBe(false);
  });
});
