/**
 * Institution academics setup — academic periods → grades → class sections →
 * infrastructure (Wave 9 / G-901).
 *
 * Before G-901 these prefixes were not mounted on the gateway, so
 * `/academic-periods`, `/institutions/[id]/classes`, `/institutions/[id]/grades`
 * and `/institutions/[id]/infrastructure` rendered empty against a live stack.
 *
 * Ungated: the pages render with their headings and the Add controls.
 * Gated (E2E_BACKEND_READY): live API create chain + the pages show the rows,
 * plus cross-tenant isolation on the new prefixes.
 */
import { expect, test, type APIRequestContext } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';
/** Seeded by tools/e2e/seed-e2e-tenants.sql. */
const INSTITUTION_A = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';

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

async function ensurePeriod(request: APIRequestContext): Promise<string> {
  const code = `AY-${Date.now().toString(36)}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/academic-periods`, {
    headers: headers(),
    data: { name: `E2E ${code}`, code, startDate: '2026-04-01', endDate: '2027-03-31' },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id as string;
}

async function ensureGrade(request: APIRequestContext): Promise<{ id: string; code: string }> {
  const code = `G${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const res = await request.post(`${GATEWAY_URL}/api/v1/grades`, {
    headers: headers(),
    data: { name: `Grade ${code}`, code, order: 7 },
  });
  expect(res.status(), await res.text()).toBe(201);
  return { id: (await res.json()).id as string, code };
}

test.describe('Academics setup — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/academic-periods renders the manager with a New period action', async ({ page }) => {
    await page.goto('/academic-periods', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /new period/i })).toBeVisible();
  });

  test('/institutions/[id]/grades and /classes expose Add controls', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/grades`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('add-grade')).toBeVisible();
    await page.goto(`/institutions/${INSTITUTION_A}/classes`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('add-section')).toBeVisible();
  });
});

test.describe('Academics setup — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('period → grade → section appear on the institution Classes tab', async ({
    page,
    request,
  }) => {
    const periodId = await ensurePeriod(request);
    const grade = await ensureGrade(request);
    const sectionName = `S${Date.now().toString(36).slice(-4)}`;

    const section = await request.post(`${GATEWAY_URL}/api/v1/classes`, {
      headers: headers(),
      data: {
        institutionId: INSTITUTION_A,
        gradeId: grade.id,
        academicPeriodId: periodId,
        name: sectionName,
        capacity: 40,
      },
    });
    expect(section.status(), await section.text()).toBe(201);

    await page.goto(`/institutions/${INSTITUTION_A}/classes`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`${grade.code} · ${sectionName}`)).toBeVisible();

    await page.goto(`/institutions/${INSTITUTION_A}/grades`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(`Grade ${grade.code}`)).toBeVisible();
  });

  test('Add grade dialog creates a grade from the UI', async ({ page }) => {
    await page.goto(`/institutions/${INSTITUTION_A}/grades`, { waitUntil: 'domcontentloaded' });
    await page.getByTestId('add-grade').click();
    const code = `UI${Date.now().toString(36).slice(-4).toUpperCase()}`;
    await page.getByLabel('Name').fill(`Grade ${code}`);
    await page.getByLabel('Code').fill(code);
    await page.getByLabel('Order').fill('9');
    await page.getByRole('button', { name: /create grade/i }).click();
    await expect(page.getByText(`Grade ${code}`)).toBeVisible({ timeout: 15_000 });
  });

  test('infrastructure hierarchy persists and renders', async ({ page, request }) => {
    const land = await request.post(`${GATEWAY_URL}/api/v1/infrastructure/lands`, {
      headers: headers(),
      data: {
        name: `Campus ${Date.now().toString(36)}`,
        institutionId: INSTITUTION_A,
        capacity: 5000,
        condition: 'GOOD',
      },
    });
    expect(land.status(), await land.text()).toBe(201);

    const hierarchy = await request.get(
      `${GATEWAY_URL}/api/v1/infrastructure/hierarchy/${INSTITUTION_A}`,
      { headers: headers() },
    );
    expect(hierarchy.status()).toBe(200);
    expect((await hierarchy.json()).lands.length).toBeGreaterThan(0);

    await page.goto(`/institutions/${INSTITUTION_A}/infrastructure`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByText((await land.json()).name)).toBeVisible();
  });

  test('cross-tenant: tenant B sees none of tenant A academics or infrastructure', async ({
    request,
  }) => {
    await ensurePeriod(request);
    const periods = await request.get(`${GATEWAY_URL}/api/v1/academic-periods`, {
      headers: headers(TENANT_B),
    });
    expect(periods.status()).toBe(200);
    expect(await periods.json()).toEqual([]);

    const hierarchy = await request.get(
      `${GATEWAY_URL}/api/v1/infrastructure/hierarchy/${INSTITUTION_A}`,
      { headers: headers(TENANT_B) },
    );
    expect(hierarchy.status()).toBe(200);
    expect((await hierarchy.json()).lands).toEqual([]);
  });
});
