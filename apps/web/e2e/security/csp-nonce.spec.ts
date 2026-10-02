/**
 * PRC-H024 / PRC-H033 — real-browser proof that the nonce CSP is enforced and
 * does not break Next.js hydration (always-on, no backend needed).
 *
 * - the document carries an enforced Content-Security-Policy with a nonce,
 *   'strict-dynamic' and no 'unsafe-inline' for scripts;
 * - the login form hydrates (client JS ran under the policy) with no
 *   `securitypolicyviolation` events for scripts;
 * - an injected inline handler / javascript: URL does not execute.
 */
import { expect, test } from '@playwright/test';

test.describe('content security policy (always on)', () => {
  test('login page is served with an enforced nonce CSP and still hydrates', async ({ page }) => {
    const violations: string[] = [];
    await page.exposeFunction('__reportCspViolation', (detail: string) => {
      violations.push(detail);
    });
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (event) => {
        const report = (window as unknown as { __reportCspViolation?: (d: string) => void })
          .__reportCspViolation;
        report?.(`${event.violatedDirective} ${event.blockedURI}`);
      });
    });

    const response = await page.goto('/login');
    expect(response).not.toBeNull();
    const policy = response!.headers()['content-security-policy'] ?? '';
    const scriptSrc = policy
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith('script-src '));
    expect(scriptSrc, policy).toMatch(/'nonce-[A-Za-z0-9+/=]+'/);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");

    // Hydration proof: typing into the controlled email field works only once React ran.
    const email = page.getByRole('textbox', { name: /email/i });
    await expect(email).toBeVisible();
    await email.fill('admin@school.edu');
    await expect(email).toHaveValue('admin@school.edu');

    expect(violations.filter((v) => v.startsWith('script-src'))).toEqual([]);
  });

  test('injected inline script and javascript: URLs do not execute', async ({ page }) => {
    await page.goto('/login');
    const executed = await page.evaluate(async () => {
      const w = window as unknown as { __cspPwned?: boolean };
      w.__cspPwned = false;
      const script = document.createElement('script');
      script.textContent = 'window.__cspPwned = true;';
      document.body.appendChild(script);
      const link = document.createElement('a');
      link.href = 'javascript:window.__cspPwned=true';
      document.body.appendChild(link);
      link.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      return w.__cspPwned;
    });
    expect(executed).toBe(false);
  });
});
