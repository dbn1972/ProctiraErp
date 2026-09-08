/**
 * Platform surfaces + help + 404 — G-727.
 *
 * Ungated: /billing, /audit-logs, /tenant-lifecycle, /help redirect to /login
 * without a session; with a session the help centre renders its guides and an
 * unknown route renders the app-level not-found boundary.
 *
 * Gated (E2E_BACKEND_READY): a platform administrator sees live data on all
 * three surfaces (no scaffold banner, no forbidden notice) and an audit entry
 * written through the gateway is filterable on /audit-logs; a tenant admin is
 * shown the explicit "platform administrator required" notice instead of an
 * empty table.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupFakeTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_ID = '00000000-0000-4000-8000-000000000001';
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001';

const PLATFORM_ROLES = [{ roleId: 'platform_admin', roleName: 'Platform Admin', areaId: null }];
const TENANT_ADMIN_ROLES = [{ roleId: 'admin', roleName: 'Administrator', areaId: null }];

const SURFACES = [
  { id: 'billing', path: '/billing', testId: 'billing-page', heading: 'Billing' },
  { id: 'audit-logs', path: '/audit-logs', testId: 'audit-logs-page', heading: 'Audit logs' },
  {
    id: 'tenant-lifecycle',
    path: '/tenant-lifecycle',
    testId: 'tenant-lifecycle-page',
    heading: 'Tenant lifecycle',
  },
] as const;

async function signedSession(
  page: import('@playwright/test').Page,
  roles: Array<{ roleId: string; roleName: string; areaId: string | null }>,
  sub: string,
) {
  const token = createSignedJwt({
    sub,
    email: `${sub}@tenant.test`,
    displayName: sub,
    tenantId: TENANT_ID,
    roles,
  });
  await page.context().addCookies([
    { name: 'access_token', value: token, url: BASE_URL },
    { name: 'refresh_token', value: token, url: BASE_URL },
  ]);
  return token;
}

test.describe('Platform surfaces — inventory smoke (ungated)', () => {
  for (const surface of [
    ...SURFACES,
    { id: 'help', path: '/help', testId: 'help-page', heading: 'Help' },
  ]) {
    test(`${surface.id} unauthenticated → /login`, async ({ page }) => {
      await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test('help centre renders guides, shortcuts, runbooks and support', async ({ page }) => {
    await setupFakeTenantSession(page);
    await page.goto('/help', { waitUntil: 'domcontentloaded' });
    const help = page.getByTestId('help-page');
    await expect(help).toBeVisible();
    await expect(help.getByRole('heading', { level: 1, name: 'Help' })).toBeVisible();
    await expect(help.getByRole('link', { name: /^Students/ })).toHaveAttribute(
      'href',
      '/students',
    );
    await expect(help.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
    await expect(help.getByText('database-migration-rollback.md')).toBeVisible();
    await expect(help.getByRole('link', { name: 'Audit logs' })).toHaveAttribute(
      'href',
      '/audit-logs',
    );
  });

  test('unknown route renders the app-level not-found boundary', async ({ page }) => {
    await setupFakeTenantSession(page);
    const response = await page.goto('/this-route-does-not-exist-g727', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status()).toBe(404);
    await expect(page.getByTestId('not-found-page')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
  });

  for (const surface of SURFACES) {
    test(`${surface.id} renders its shell with a session (offline-tolerant)`, async ({ page }) => {
      await setupFakeTenantSession(page);
      await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId(surface.testId)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1, name: surface.heading })).toBeVisible();
      await expect(page.getByRole('form', { name: /^Filter/ })).toBeVisible();
    });
  }
});

test.describe('Platform surfaces — live gateway (E2E_BACKEND_READY)', () => {
  test.skip(
    !BACKEND_READY,
    'Requires E2E_BACKEND_READY=1 and a live gateway with platform plugins',
  );

  test('platform admin sees live billing, audit and tenant data with no scaffold/forbidden state', async ({
    page,
    request,
  }) => {
    const token = await signedSession(page, PLATFORM_ROLES, `platform-e2e-${Date.now()}`);
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Tenant-ID': TENANT_ID,
    };

    const stamp = Date.now();
    const created = await request.post(`${GATEWAY_URL}/api/v1/tenant-lifecycle`, {
      headers,
      data: {
        name: `G727 Tenant ${stamp}`,
        slug: `g727-${stamp}`,
        plan: 'starter',
        region: 'ap-south-1',
        admin: {
          firstName: 'E2E',
          lastName: 'Admin',
          email: `g727-${stamp}@tenant.test`,
          password: `E2e-Passw0rd-${stamp}`,
        },
      },
    });
    expect(created.status(), await created.text()).toBe(201);

    const entityId = `g727-${stamp}`;
    const recorded = await request.post(`${GATEWAY_URL}/api/v1/audit-logs`, {
      headers,
      data: {
        entityType: 'e2e-platform-surface',
        entityId,
        operation: 'UPDATE',
        beforeValues: { status: 'draft' },
        afterValues: { status: 'published' },
      },
    });
    expect(recorded.status(), await recorded.text()).toBe(201);

    for (const surface of SURFACES) {
      await page.goto(surface.path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId(surface.testId)).toBeVisible();
      await expect(page.getByTestId('scaffold-mode-banner')).toHaveCount(0);
      await expect(page.getByTestId('platform-forbidden-notice')).toHaveCount(0);
      await expect(page.getByTestId('platform-error-notice')).toHaveCount(0);
    }

    await page.goto(`/audit-logs?entityType=e2e-platform-surface&entityId=${entityId}`, {
      waitUntil: 'domcontentloaded',
    });
    const rows = page.getByTestId('audit-log-row');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('UPDATE');
    await expect(rows.first()).toContainText(entityId);
    await expect(rows.first().getByText('status', { exact: true })).toBeVisible();

    await page.goto(`/tenant-lifecycle?search=g727-${stamp}`, { waitUntil: 'domcontentloaded' });
    const tenantRows = page.getByTestId('tenant-row');
    await expect(tenantRows).toHaveCount(1);
    await expect(tenantRows.first()).toContainText(`g727-${stamp}`);
  });

  test('tenant admin is told platform access is required instead of an empty table', async ({
    page,
  }) => {
    await signedSession(page, TENANT_ADMIN_ROLES, `tenant-admin-e2e-${Date.now()}`);
    await page.goto('/audit-logs', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('audit-logs-page')).toBeVisible();
    await expect(page.getByTestId('platform-forbidden-notice')).toBeVisible();
    await expect(page.getByTestId('scaffold-mode-banner')).toHaveCount(0);
  });
});
