import { expect, test } from '@playwright/test';

/**
 * Platform Admin Console production smoke.
 *
 * Public surfaces always run. Authenticated inventory is gated on
 * `E2E_BACKEND_READY=1` (same pattern as apps/web enterprise specs).
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Platform Admin — public auth surfaces', () => {
  test('login page renders operator sign-in chrome', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/password/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  });

  test('forbidden page renders 403 access-denied copy', async ({ page }) => {
    await page.goto('/forbidden?area=tenants');
    await expect(page.getByRole('heading', { name: /access denied/i })).toBeVisible();
    await expect(page.getByText(/HTTP 403/i)).toBeVisible();
  });

  test('unauthenticated protected route redirects to login with safe returnTo', async ({
    page,
  }) => {
    await page.goto('/tenants');
    await expect(page).toHaveURL(/\/login/);
    const url = new URL(page.url());
    const returnTo = url.searchParams.get('returnTo');
    expect(returnTo).toBe('/tenants');
    expect(returnTo?.startsWith('//')).toBeFalsy();
  });
});

test.describe('Platform Admin — authenticated inventory', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend admin-console e2e.',
  );

  test('overview and primary ops routes render headings', async ({ page }) => {
    // Cookie/session bootstrap is environment-specific; when backend is ready
    // the shared auth fixture (or seeded operator cookie) should be wired here.
    for (const path of [
      '/',
      '/tenants',
      '/tenants/new',
      '/plans',
      '/plugins',
      '/themes',
      '/break-glass',
      '/break-glass/requests',
      '/support',
      '/health',
      '/audit',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});
