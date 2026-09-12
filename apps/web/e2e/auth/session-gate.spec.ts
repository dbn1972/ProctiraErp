/**
 * Always-on smoke: session BFF is the cookie gate (P0-02), not a stub login.
 *
 * Uses Playwright route interception so CI does not need a live IdP.
 */

import { expect, test } from '@playwright/test';

test.describe('Auth session gate (P0-02)', () => {
  test('GET /api/auth/session returns unauthenticated without cookies', async ({ request }) => {
    const res = await request.get('/api/auth/session');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.authenticated).toBe(false);
    expect(body.user).toBeNull();
  });

  test('login page exposes Keycloak SSO entry (not a stub-only shell)', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('keycloak-sso')).toBeVisible();
    await expect(page.getByTestId('auth-demo-mode-banner')).toHaveCount(0);
  });
});
