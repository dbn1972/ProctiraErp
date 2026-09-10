/**
 * Hostel ops — mess, gate pass, fees, night roll (Wave 9 / G-921).
 *
 * Ungated: overview plus mess, gate-pass, fees, and attendance pages render.
 * Gated (E2E_BACKEND_READY): gate pass request → approve → mark out → mark in;
 * tenant B cannot list tenant A passes.
 */
import { expect, test, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by db/sql/008b_hostel_seed.sql / tools/e2e/seed-e2e-tenants.sql. */
const HOSTEL_A = 'b1000000-0000-4000-8000-000000000001';
const STUDENT_A = '00000000-0000-4000-8000-000000000099';

function headers(tenantId = TENANT_A) {
  const token = createSignedJwt({
    sub: 'e2e-admin',
    email: 'admin@tenant-a.test',
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

async function hydrated(page: Page, testId: string) {
  const el = page.getByTestId(testId);
  await expect(el).toHaveAttribute('data-hydrated', 'true', { timeout: 20_000 });
  return el;
}

test.describe('Hostel ops — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/hostel/mess renders the plan form', async ({ page }) => {
    await page.goto('/hostel/mess', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /mess/i })).toBeVisible();
    await hydrated(page, 'hostel-mess-plan-form');
  });

  test('/hostel/gate-passes renders the request form', async ({ page }) => {
    await page.goto('/hostel/gate-passes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /gate pass/i })).toBeVisible();
    await hydrated(page, 'hostel-gate-pass-form');
  });

  test('/hostel/fees and /hostel/attendance render', async ({ page }) => {
    await page.goto('/hostel/fees', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /fee/i })).toBeVisible();
    await page.goto('/hostel/attendance', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /attendance/i })).toBeVisible();
  });
});

test.describe('Hostel ops — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('gate pass request → approve → out → in', async ({ page, request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/hostel/gate-passes`, {
      headers: headers(),
      data: {
        hostelId: HOSTEL_A,
        studentId: STUDENT_A,
        requestedBy: 'resident',
        reason: `Clinic ${Date.now()}`,
        expectedOutAt: '2026-09-10T08:00:00.000Z',
        expectedInAt: '2026-09-10T20:00:00.000Z',
      },
    });
    expect(create.status(), await create.text()).toBe(201);
    const pass = await create.json();
    expect(pass.status).toBe('pending');

    const jump = await request.post(`${GATEWAY_URL}/api/v1/hostel/gate-passes/${pass.id}/out`, {
      headers: headers(),
    });
    expect(jump.status()).toBe(409);

    const approve = await request.post(
      `${GATEWAY_URL}/api/v1/hostel/gate-passes/${pass.id}/approve`,
      { headers: headers() },
    );
    expect(approve.status(), await approve.text()).toBe(200);
    expect((await approve.json()).status).toBe('approved');

    const out = await request.post(`${GATEWAY_URL}/api/v1/hostel/gate-passes/${pass.id}/out`, {
      headers: headers(),
    });
    expect(out.status(), await out.text()).toBe(200);
    expect((await out.json()).status).toBe('out');

    const inn = await request.post(`${GATEWAY_URL}/api/v1/hostel/gate-passes/${pass.id}/in`, {
      headers: headers(),
    });
    expect(inn.status(), await inn.text()).toBe(200);
    expect((await inn.json()).status).toBe('in');

    const listedB = await request.get(`${GATEWAY_URL}/api/v1/hostel/gate-passes`, {
      headers: headers(TENANT_B),
    });
    expect(listedB.status()).toBe(200);
    const ids = ((await listedB.json()).data as Array<{ id: string }>).map((row) => row.id);
    expect(ids).not.toContain(pass.id);

    await page.goto('/hostel/gate-passes', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('hostel-gate-pass-form')).toBeVisible();
  });
});
