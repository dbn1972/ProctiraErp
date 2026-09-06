import { expect, test, type Page } from '@playwright/test';

/**
 * Platform Admin — ungated tenant provision validation smoke.
 *
 * Submits values that pass HTML5 required checks but fail zod
 * (short name, invalid slug). Does not claim live gateway provisioning.
 */

function createFakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64');
  return `${header}.${body}.ZmFrZS1zaWduYXR1cmU`;
}

async function setupOperatorSession(page: Page): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const token = createFakeJwt({
    sub: 'ops-e2e-user',
    email: 'ops@proctira.test',
    displayName: 'E2E Operator',
    platformRole: 'platform_admin',
    tenantId: 'platform',
    iat: now,
    exp: now + 60 * 60 * 8,
  });

  const baseUrl = new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:3004' : page.url());

  await page.context().addCookies([
    {
      name: 'admin_access_token',
      value: token,
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
    {
      name: 'admin_refresh_token',
      value: 'fake-refresh',
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Platform Admin — tenant write validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupOperatorSession(page);
  });

  test('rejects invalid provision fields via server action', async ({ page }) => {
    await page.goto('/tenants/new');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/provision a new tenant/i);

    await page.locator('#name').fill('A');
    await page.locator('#slug').fill('BAD_SLUG');
    await page.locator('#contactEmail').fill('ops@proctira.test');
    await page.locator('#region').fill('us-east-1');

    await page.getByRole('button', { name: /provision tenant/i }).click();

    await expect(page.getByText(/please fix the highlighted fields/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#slug')).toHaveAttribute('aria-invalid', 'true');
  });
});
