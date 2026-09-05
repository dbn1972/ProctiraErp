/**
 * Auth UI enterprise smokes — logout + OAuth callback + open-redirect guard.
 *
 * Always-on (mocked) so tip CI keeps a security/wiring signal for the Auth
 * surface covered by the enterprise production-ready skill.
 *
 * Note: App Router `redirect()` can resolve the logout/OAuth hop on the
 * server, so the browser may never emit a separate document request to the
 * API path. We assert the **observable** outcomes (land on /login, never
 * leave origin) rather than requiring `page.route` to see the API hop.
 */
import { expect, test } from '@playwright/test';

test.describe('auth — enterprise smokes (always on)', () => {
  test('logout page ends on the login screen', async ({ page }) => {
    await page.goto('/logout');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: /welcome back/i })).toBeVisible();
  });

  test('oauth callback without a valid code returns to login', async ({ page }) => {
    // Missing/invalid code should bounce to login via the API handler
    // (or the page forward). Either way the user must not stay on a blank
    // callback URL and must not be sent off-origin.
    await page.goto('/oauth/callback?error=access_denied&returnTo=https://evil.example/phish');
    await expect(page).toHaveURL(/\/login/);
    expect(page.url()).not.toContain('evil.example');
  });

  test('login rejects open-redirect returnTo values', async ({ page }) => {
    await page.route('**/api/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto('/login?returnTo=https://evil.example/phish');
    await page.getByRole('textbox', { name: /email/i }).fill('admin@school.edu');
    await page.getByRole('textbox', { name: /^password$/i }).fill('CorrectHorse9!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // sanitizeReturnTo must force fallback `/` — never leave the origin.
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('evil.example');
  });
});
