import { expect, test, type Page } from '@playwright/test';

/**
 * Staff write-path — ungated client validation smoke.
 * Does not claim a successful staff create against a live API.
 */

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupTenantSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'staff-e2e-user',
    email: 'admin@tenant-a.test',
    displayName: 'Staff E2E Admin',
    tenantId: '00000000-0000-4000-8000-0000000000aa',
    roles: [{ roleId: 'admin', roleName: 'Administrator', areaId: null }],
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  await page.context().addCookies([
    {
      name: 'access_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'refresh_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Staff write validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupTenantSession(page);
  });

  test('/staff/new validates required fields before submit', async ({ page }) => {
    const response = await page.goto('/staff/new', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /add staff/i })).toBeVisible();
    await expect(page.getByTestId('staff-form')).toHaveAttribute('data-hydrated', 'true');

    await page.getByRole('button', { name: /create staff record/i }).click();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Date is required')).toBeVisible();
    await expect(page.getByText('Identity number is required')).toBeVisible();
    await expect(page.getByText('Contact phone is required')).toBeVisible();
    await expect(page.getByText('Position is required')).toBeVisible();
  });
});
