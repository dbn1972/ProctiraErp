/**
 * Reports catalogue — real CSV exports, schedules, role dashboards (Wave 9 / G-909).
 *
 * Ungated: catalogue, schedules, and dashboard pages render (no crash).
 * Gated (E2E_BACKEND_READY): generate CSV, download sha256 matches artifact,
 * create schedule → run appears in history, principal vs teacher dashboard
 * cards differ, tenant B cannot read tenant A artifacts.
 */
import { createHash } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function headers(
  tenantId = TENANT_A,
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }> = [
    { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
  ],
) {
  const token = createSignedJwt({
    sub: 'e2e-reports',
    email: 'admin@tenant-a.test',
    displayName: 'E2E Reports',
    tenantId,
    roles,
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

test.describe('Reports catalogue — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/reports renders with the New report action', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^reports$/i);
    await expect(page.getByRole('link', { name: /new report/i })).toBeVisible();
  });

  test('/reports/dashboard renders', async ({ page }) => {
    await page.goto('/reports/dashboard', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/reports/schedules renders the create form', async ({ page }) => {
    await page.goto('/reports/schedules', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await hydrated(page, 'report-schedule-form');
  });
});

test.describe('Reports catalogue — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('generate CSV download sha256 matches stored artifact hash', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/reports/generate`, {
      headers: headers(),
      data: { templateId: 'tpl-enrolment-summary', format: 'CSV' },
    });
    expect(create.status(), await create.text()).toBe(201);
    const run = (await create.json()) as { artifactId: string; sha256: string };
    expect(run.sha256).toMatch(/^[0-9a-f]{64}$/);

    const download = await request.get(
      `${GATEWAY_URL}/api/v1/reports/artifacts/${run.artifactId}/download`,
      { headers: headers() },
    );
    expect(download.status()).toBe(200);
    const bytes = Buffer.from(await download.body());
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest).toBe(run.sha256);
    expect(download.headers()['x-artifact-sha256']).toBe(run.sha256);
  });

  test('create schedule then run appears in history', async ({ request }) => {
    const created = await request.post(`${GATEWAY_URL}/api/v1/reports/schedules`, {
      headers: headers(),
      data: {
        reportKey: 'attendance_summary',
        format: 'csv',
        cadence: 'daily',
        recipients: ['office@tenant-a.test'],
      },
    });
    expect(created.status(), await created.text()).toBe(201);
    const schedule = (await created.json()) as { id: string };

    const run = await request.post(
      `${GATEWAY_URL}/api/v1/reports/schedules/${schedule.id}/run`,
      { headers: headers() },
    );
    expect(run.status(), await run.text()).toBe(201);

    const history = await request.get(
      `${GATEWAY_URL}/api/v1/reports/runs?scheduleId=${schedule.id}`,
      { headers: headers() },
    );
    expect(history.status()).toBe(200);
    const body = (await history.json()) as { data: Array<{ trigger?: string; status: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.some((r) => r.trigger === 'schedule' || r.status === 'READY')).toBe(true);
  });

  test('principal and teacher dashboards show different cards', async ({ page }) => {
    await setupGatewayTenantSession(page, {
      roles: [{ roleId: 'principal', roleName: 'PRINCIPAL', areaId: null }],
    });
    await page.goto('/reports/dashboard', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'role-dashboard');
    await expect(page.getByTestId('role-dashboard')).toHaveAttribute('data-role', 'principal');
    await expect(page.getByTestId('dashboard-card-principal-enrolment')).toBeVisible();

    await setupGatewayTenantSession(page, {
      sub: 'e2e-teacher',
      email: 'teacher@tenant-a.test',
      displayName: 'E2E Teacher',
      roles: [{ roleId: 'teacher', roleName: 'TEACHER', areaId: null }],
    });
    await page.goto('/reports/dashboard', { waitUntil: 'domcontentloaded' });
    await hydrated(page, 'role-dashboard');
    await expect(page.getByTestId('role-dashboard')).toHaveAttribute('data-role', 'teacher');
    await expect(page.getByTestId('dashboard-card-teacher-students')).toBeVisible();
    await expect(page.getByTestId('dashboard-card-principal-enrolment')).toHaveCount(0);
  });

  test('tenant B cannot download tenant A artifacts', async ({ request }) => {
    const create = await request.post(`${GATEWAY_URL}/api/v1/reports/generate`, {
      headers: headers(TENANT_A),
      data: { reportKey: 'fee_dues', format: 'csv' },
    });
    expect(create.status(), await create.text()).toBe(201);
    const run = (await create.json()) as { artifactId: string };

    const denied = await request.get(
      `${GATEWAY_URL}/api/v1/reports/artifacts/${run.artifactId}/download`,
      { headers: headers(TENANT_B) },
    );
    expect(denied.status()).toBe(404);
  });
});
