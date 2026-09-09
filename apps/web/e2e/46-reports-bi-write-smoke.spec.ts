/**
 * Reports / BI — generate, hash download, schedules, role dashboards (Wave 9 / G-909).
 *
 * Ungated: catalogue, schedules, and dashboards pages render with a heading.
 * Gated (E2E_BACKEND_READY): generate CSV → download sha256 matches; schedule
 * run appears with trigger=schedule; parent cannot fetch principal dashboard.
 */
import { createHash } from 'node:crypto';

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

function headers(
  tenantId = TENANT_A,
  sub = 'e2e-admin',
  roles: Array<{ roleId: string; roleName: string; areaId: null }> = [
    { roleId: 'admin', roleName: 'SUPER_ADMIN', areaId: null },
  ],
) {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant-a.test`,
    displayName: 'E2E Admin',
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

async function postOk(
  request: APIRequestContext,
  path: string,
  data: unknown,
  expected: number,
  extra: ReturnType<typeof headers> = headers(),
) {
  const res = await request.post(`${GATEWAY_URL}/api/v1${path}`, {
    headers: extra,
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

test.describe('Reports BI — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('/reports lists with a heading', async ({ page }) => {
    await page.goto('/reports', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('/reports/schedules lists with a heading', async ({ page }) => {
    await page.goto('/reports/schedules', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /schedules/i })).toBeVisible();
  });

  test('/reports/dashboards lists with a heading', async ({ page }) => {
    await page.goto('/reports/dashboards', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1, name: /dashboard/i })).toBeVisible();
  });
});

test.describe('Reports BI — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('generate CSV hash matches download; scheduled run appears; parent denied principal', async ({
    page,
    request,
  }) => {
    const created = await postOk(
      request,
      '/reports/generate',
      {
        templateId: 'tpl-students-roster',
        format: 'CSV',
      },
      201,
    );
    expect(created.status).toBe('READY');
    expect(created.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(created.artifactId).toBeTruthy();

    const download = await request.get(
      `${GATEWAY_URL}/api/v1/reports/artifacts/${created.artifactId}/download`,
      { headers: headers() },
    );
    expect(download.status()).toBe(200);
    const bytes = Buffer.from(await download.body());
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(digest).toBe(created.sha256);
    expect(download.headers()['x-artifact-sha256']).toBe(created.sha256);

    const schedule = await postOk(
      request,
      '/reports/schedules',
      {
        reportKey: 'attendance_summary',
        format: 'csv',
        cadence: 'daily',
        hour: 7,
        recipients: ['office@school.test'],
      },
      201,
    );
    const forced = await postOk(request, `/reports/schedules/${schedule.id}/run`, {}, 201);
    expect(forced.trigger).toBe('schedule');
    expect(forced.sha256).toMatch(/^[0-9a-f]{64}$/);

    const history = await request.get(
      `${GATEWAY_URL}/api/v1/reports/runs?scheduleId=${schedule.id}`,
      { headers: headers() },
    );
    expect(history.status()).toBe(200);
    const runs = (await history.json()) as { data: Array<{ trigger: string }> };
    expect(runs.data.some((r) => r.trigger === 'schedule')).toBe(true);

    await page.goto('/reports/new?templateId=tpl-students-roster', {
      waitUntil: 'domcontentloaded',
    });
    await hydrated(page, 'report-builder-form');

    const parentDenied = await request.get(
      `${GATEWAY_URL}/api/v1/reports/dashboard?role=principal`,
      {
        headers: headers(TENANT_A, 'e2e-parent', [
          { roleId: 'parent', roleName: 'Parent', areaId: null },
        ]),
      },
    );
    expect(parentDenied.status(), await parentDenied.text()).toBe(403);

    const parentOk = await request.get(`${GATEWAY_URL}/api/v1/reports/dashboard?role=parent`, {
      headers: headers(TENANT_A, 'e2e-parent', [
        { roleId: 'parent', roleName: 'Parent', areaId: null },
      ]),
    });
    expect(parentOk.status()).toBe(200);
    expect((await parentOk.json()).role).toBe('parent');

    const principal = await request.get(`${GATEWAY_URL}/api/v1/reports/dashboard?role=principal`, {
      headers: headers(),
    });
    const teacher = await request.get(`${GATEWAY_URL}/api/v1/reports/dashboard?role=teacher`, {
      headers: headers(),
    });
    expect(principal.status()).toBe(200);
    expect(teacher.status()).toBe(200);
    const pCards = ((await principal.json()) as { cards: Array<{ id: string }> }).cards.map(
      (c) => c.id,
    );
    const tCards = ((await teacher.json()) as { cards: Array<{ id: string }> }).cards.map(
      (c) => c.id,
    );
    expect(pCards).not.toEqual(tCards);
  });

  test('cross-tenant: tenant B cannot download tenant A artifacts', async ({ request }) => {
    const created = await postOk(
      request,
      '/reports/generate',
      {
        templateId: 'tpl-attendance-daily',
        format: 'CSV',
      },
      201,
    );
    const foreign = await request.get(
      `${GATEWAY_URL}/api/v1/reports/artifacts/${created.artifactId}/download`,
      { headers: headers(TENANT_B) },
    );
    expect([403, 404], `foreign download → ${foreign.status()}`).toContain(foreign.status());
  });
});
