import { expect, test } from '@playwright/test';

/**
 * PRC-M003: the console cannot be framed and ships CSP/HSTS. Public route, no backend needed.
 */
test.describe('Platform Admin — security headers', () => {
  test('login response carries anti-framing, CSP and HSTS headers', async ({ request }) => {
    const res = await request.get('/login');
    const headers = res.headers();
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['strict-transport-security']).toContain('max-age=');
    expect(headers['referrer-policy']).toBeTruthy();
    expect(headers['permissions-policy']).toBeTruthy();
    expect(headers['x-platform-admin']).toBeUndefined();
  });

  test('page cannot be embedded in an iframe', async ({ page, baseURL }) => {
    await page.setContent(`<iframe id="f" src="${baseURL}/login"></iframe>`);
    const frame = page.frame({ url: /\/login/ });
    // Blocked frames never load the login heading.
    const heading = frame
      ? await frame
          .locator('h1')
          .count()
          .catch(() => 0)
      : 0;
    expect(heading).toBe(0);
  });
});
