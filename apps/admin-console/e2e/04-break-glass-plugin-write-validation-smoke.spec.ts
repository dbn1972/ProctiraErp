import { expect, test, type Page } from '@playwright/test';

/**
 * Platform Admin — ungated break-glass + plugin decision validation smokes.
 *
 * Submits values that fail zod (short justification / reason). Does not claim
 * live elevated sessions or marketplace decisions.
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

  const baseUrl = new URL(page.url() === 'about:blank' ? 'http://127.0.0.1:3014' : page.url());

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

test.describe('Platform Admin — break-glass / plugin write validation (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupOperatorSession(page);
  });

  test('rejects short break-glass justification via server action', async ({ page }) => {
    await page.goto('/break-glass');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/break-glass access/i);

    await page.locator('#targetTenantId').fill('tnt_001');
    await page.locator('#justification').fill('too short');
    await page.getByRole('button', { name: /submit for approval/i }).click();

    await expect(page.getByText(/please fix the highlighted fields/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#justification')).toHaveAttribute('aria-invalid', 'true');
  });

  test('rejects short plugin decision reason via server action', async ({ page }) => {
    await page.goto('/plugins/plg_001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.locator('#reason').fill('short');
    await page.getByRole('button', { name: /^approve$/i }).click();

    await expect(page.getByText(/please fix the highlighted fields/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.locator('#reason')).toHaveAttribute('aria-invalid', 'true');
  });
});
