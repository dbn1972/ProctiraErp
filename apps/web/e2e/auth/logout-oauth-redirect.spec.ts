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
    // Captured from a navigation that is same-origin by construction, so the assertion
    // below compares against the app's real origin rather than a hard-coded port.
    const appOrigin = new URL(page.url()).origin;
    await page.getByRole('textbox', { name: /email/i }).fill('admin@school.edu');
    await page.getByRole('textbox', { name: /^password$/i }).fill('CorrectHorse9!');
    await page.getByRole('button', { name: /sign in/i }).click();

    // sanitizeReturnTo must force the fallback `/` — never leave the origin.
    //
    // Waits for the navigation rather than sleeping 500ms and hoping. The fixed sleep was
    // the single flakiest assertion in the suite: the handler is bound by
    // `<form onSubmit>` inside `<Suspense fallback={null}>`, so on a loaded runner the
    // client had not hydrated and navigated within 500ms, leaving the URL as the seeded
    // `/login?returnTo=https://evil.example/phish` — which trivially contains
    // `evil.example`. A timing miss was reported as an open-redirect failure.
    //
    // It also asserts the destination instead of merely the absence of a substring:
    // `not.toContain('evil.example')` was satisfied by *any* navigation away from the
    // seeded URL, including a wrong one.
    // Waits on the property under test. A predicate that also accepted `/login` resolved
    // instantly while still on the seeded URL, reproducing the original bug with extra
    // steps. Landing back on `/login` is legitimate here — the mocked login sets no cookie,
    // so middleware bounces `/` straight back — which is why the condition is the absence
    // of the attacker host rather than a specific destination.
    await page.waitForURL((url) => !url.href.includes('evil.example'), { timeout: 15_000 });
    expect(new URL(page.url()).origin).toBe(appOrigin);
    expect(page.url()).not.toContain('evil.example');
  });
});
