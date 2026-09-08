/**
 * Task 49.7 — E2E: federated (OAuth) sign-in.
 *
 * Asserts that the "Continue with Google" / "Continue with Microsoft"
 * buttons on `/login` link to the local
 * `/api/auth/oauth/authorize?provider=…` route handler, which is the
 * boundary the upstream OAuth provider redirect lives behind.
 *
 * The test does NOT actually follow the redirect to a third-party host
 * — that would break offline runs and CI. Instead we assert the
 * `href` carries the right `provider` parameter and `returnTo`
 * preservation, then verify the redirect target by intercepting the
 * route handler.
 *
 * Requirements: 4.16
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockOAuthAuthorize } from './helpers';

test.describe('auth — sign-in (federated providers)', () => {
  test('Microsoft button links to the authorize endpoint with the correct provider', async ({
    page,
  }) => {
    await page.goto('/login?returnTo=%2Fdashboard');

    const microsoft = page.getByRole('link', {
      name: /continue with microsoft/i,
    });
    await expect(microsoft).toBeVisible();
    const href = await microsoft.getAttribute('href');
    expect(href).not.toBeNull();
    const url = new URL(href!, 'http://localhost');
    expect(url.pathname).toBe('/api/auth/oauth/authorize');
    expect(url.searchParams.get('provider')).toBe('microsoft');
    expect(url.searchParams.get('returnTo')).toBe('/dashboard');
  });

  test('Google button links to the authorize endpoint with the correct provider', async ({
    page,
  }) => {
    await page.goto('/login');

    const google = page.getByRole('link', { name: /continue with google/i });
    await expect(google).toBeVisible();
    const href = await google.getAttribute('href');
    const url = new URL(href!, 'http://localhost');
    expect(url.pathname).toBe('/api/auth/oauth/authorize');
    expect(url.searchParams.get('provider')).toBe('google');
  });

  test('clicking the federated button hits the authorize route handler', async ({ page }) => {
    await mockOAuthAuthorize(page);

    await page.goto('/login');
    await Promise.all([
      page.waitForURL((u) => u.searchParams.get('oauth_test') === '1'),
      page.getByRole('link', { name: /continue with google/i }).click(),
    ]);

    // Our mock redirects back to a sentinel URL on the same origin so
    // the assertion does not depend on a real OAuth provider.
    expect(new URL(page.url()).searchParams.get('provider')).toBe('google');
  });
});
