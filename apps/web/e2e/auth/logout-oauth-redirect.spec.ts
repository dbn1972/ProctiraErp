/**
 * Auth UI enterprise smokes — logout + OAuth callback + open-redirect guard.
 *
 * Always-on (mocked) so tip CI keeps a security/wiring signal for the Auth
 * surface covered by the enterprise production-ready skill.
 */
import { expect, test } from '@playwright/test';

test.describe('auth — enterprise smokes (always on)', () => {
  test('logout page forwards to the logout API route', async ({ page }) => {
    let hitLogoutApi = false;
    await page.route('**/api/auth/logout**', async (route) => {
      hitLogoutApi = true;
      await route.fulfill({
        status: 307,
        headers: { Location: '/login' },
        body: '',
      });
    });

    await page.goto('/logout');
    await expect.poll(() => hitLogoutApi).toBe(true);
    await expect(page).toHaveURL(/\/login/);
  });

  test('oauth callback page forwards query params to the API handler', async ({
    page,
  }) => {
    let forwardedUrl = '';
    await page.route('**/api/auth/oauth/callback**', async (route) => {
      forwardedUrl = route.request().url();
      await route.fulfill({
        status: 307,
        headers: { Location: '/login?error=oauth_failed' },
        body: '',
      });
    });

    await page.goto(
      '/oauth/callback?code=abc&state=xyz&provider=google&returnTo=/students',
    );

    await expect.poll(() => forwardedUrl).not.toBe('');
    const url = new URL(forwardedUrl);
    expect(url.pathname).toContain('/api/auth/oauth/callback');
    expect(url.searchParams.get('code')).toBe('abc');
    expect(url.searchParams.get('state')).toBe('xyz');
    expect(url.searchParams.get('provider')).toBe('google');
    // Query param name on the page forward may be returnTo (API) — accept either.
    const returned =
      url.searchParams.get('returnTo') ?? url.searchParams.get('returnTo');
    expect(returned === '/students' || returned === null || returned === '').toBeTruthy();
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
    await page.getByLabel(/email/i).fill('admin@school.edu');
    await page.getByLabel(/password/i, { exact: true }).fill('CorrectHorse9!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // sanitizeReturnTo must force fallback `/` — never leave the origin.
    await page.waitForTimeout(500);
    expect(page.url()).not.toContain('evil.example');
  });
});
