/**
 * Tenant admin console — users / roles / permissions / tenant settings
 * (Wave 9 / G-910).
 *
 * Before G-910 the four `/admin/*` pages read the platform user service and
 * every button (Invite user, Create role, Edit, Save changes) was inert. They
 * now read the gateway `/tenant/*` console and mutate through Server Actions.
 *
 * Ungated: the pages render with their headings.
 * Gated (E2E_BACKEND_READY): invite → suspend → role create → settings save
 * through the UI, plus cross-tenant isolation on `/tenant/users`.
 */
import { expect, test } from '@playwright/test';

import { createSignedJwt, setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const GATEWAY_URL =
  process.env.E2E_GATEWAY_URL ?? process.env.NEXT_PUBLIC_GATEWAY_URL ?? 'http://127.0.0.1:3000';
const TENANT_A = '00000000-0000-4000-8000-000000000001';
const TENANT_B = '00000000-0000-4000-8000-0000000000bb';

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

test.describe('Admin console — pages render (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  for (const [path, heading] of [
    ['/admin/users', 'Users'],
    ['/admin/roles', 'Roles'],
    ['/admin/permissions', 'Permissions'],
    ['/admin/tenant', 'Tenant settings'],
  ] as const) {
    test(`${path} renders its heading`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
    });
  }
});

test.describe('Admin console — live chain (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1 and a live gateway + Postgres');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page);
  });

  test('invite → suspend → reactivate a user from the UI', async ({ page }) => {
    const stamp = Date.now().toString(36);
    const email = `ui-${stamp}@tenant-a.test`;

    await page.goto('/admin/users', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('invite-user').click();
    await page.getByLabel('E-mail').fill(email);
    await page.getByLabel('Full name').fill(`UI Invitee ${stamp}`);
    await page.getByRole('button', { name: /send invite/i }).click();

    const row = page.getByTestId(`user-row-${email}`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByTestId('user-status')).toHaveText('Invited');

    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`toggle-status-${email}`).click();
    await expect(row.getByTestId('user-status')).toHaveText('Suspended', { timeout: 15_000 });

    await page.getByTestId(`toggle-status-${email}`).click();
    await expect(row.getByTestId('user-status')).toHaveText('Active', { timeout: 15_000 });
  });

  test('create a custom role and see it in the permission matrix', async ({ page }) => {
    const name = `Clerk ${Date.now().toString(36).toUpperCase()}`;

    await page.goto('/admin/roles', { waitUntil: 'domcontentloaded' });
    await page.getByTestId('create-role').click();
    await page.getByLabel('Role name').fill(name);
    await page.getByLabel('Description').fill('E2E custom role');
    await page.getByRole('checkbox', { name: 'All student permissions' }).click();
    await page.getByRole('button', { name: /^create role$/i }).click();

    await expect(page.getByTestId(`role-card-${name}`)).toBeVisible({ timeout: 15_000 });

    await page.goto('/admin/permissions', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(name).first()).toBeVisible();

    await page.goto('/admin/roles', { waitUntil: 'domcontentloaded' });
    page.once('dialog', (d) => d.accept());
    await page.getByTestId(`delete-role-${name}`).click();
    await expect(page.getByTestId(`role-card-${name}`)).toHaveCount(0, { timeout: 15_000 });
  });

  test('tenant settings save and reload', async ({ page, request }) => {
    const displayName = `Tenant A ${Date.now().toString(36)}`;

    await page.goto('/admin/tenant', { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Display name').fill(displayName);
    await page.getByLabel('Timezone').fill('Asia/Kolkata');
    await page.getByLabel('Academic year starts in month').fill('6');
    await page.getByTestId('save-tenant-settings').click();
    await expect(page.getByRole('status')).toHaveText(/saved/i, { timeout: 15_000 });

    const res = await request.get(`${GATEWAY_URL}/api/v1/tenant/settings`, { headers: headers() });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.displayName).toBe(displayName);
    expect(body.academicYearStartMonth).toBe(6);
  });

  test('cross-tenant: tenant B cannot see tenant A users', async ({ request }) => {
    const email = `iso-${Date.now().toString(36)}@tenant-a.test`;
    const invite = await request.post(`${GATEWAY_URL}/api/v1/tenant/users`, {
      headers: headers(),
      data: { email, displayName: 'Isolation probe', roleIds: [] },
    });
    expect(invite.status(), await invite.text()).toBe(201);

    const other = await request.get(`${GATEWAY_URL}/api/v1/tenant/users?search=${email}`, {
      headers: headers(TENANT_B),
    });
    expect(other.status()).toBe(200);
    expect((await other.json()).data).toEqual([]);
  });
});
