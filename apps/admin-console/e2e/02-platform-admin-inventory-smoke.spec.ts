import { expect, test, type Page } from '@playwright/test';

/**
 * Platform Admin Console — ungated inventory smoke.
 *
 * Always runs (no E2E_BACKEND_READY). Uses a structurally valid fake JWT so
 * middleware/`requireSession` pass; API clients fall back to stub fixtures.
 * Asserts HTTP 200 + primary h1 landmark for each inventory route.
 */

const INVENTORY_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /platform overview/i },
  { path: '/tenants', heading: /^tenants$/i },
  { path: '/tenants/new', heading: /provision a new tenant/i },
  { path: '/tenants/tnt_001', heading: /ministry of education/i },
  { path: '/plans', heading: /plan management/i },
  { path: '/plans/plan_standard', heading: /plan:/i },
  { path: '/plugins', heading: /plugin marketplace/i },
  { path: '/plugins/plg_001', heading: /.+/ },
  { path: '/themes', heading: /theme gallery/i },
  { path: '/themes/thm_001', heading: /.+/ },
  { path: '/break-glass', heading: /break-glass access/i },
  { path: '/break-glass/requests', heading: /break-glass approval queue/i },
  { path: '/support', heading: /support tooling/i },
  { path: '/health', heading: /system health/i },
  { path: '/audit', heading: /audit log/i },
];

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

test.describe('Platform Admin — inventory smoke (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupOperatorSession(page);
  });

  for (const route of INVENTORY_ROUTES) {
    test(`${route.path} returns 200 with h1`, async ({ page }) => {
      const response = await page.goto(route.path, { waitUntil: 'domcontentloaded' });
      expect(response, `missing response for ${route.path}`).toBeTruthy();
      expect(response!.status(), `${route.path} status`).toBeLessThan(400);
      expect(response!.ok() || response!.status() === 304).toBeTruthy();

      const heading = page.locator('main h1').first();
      await expect(heading).toBeVisible();
      await expect(heading).toHaveText(route.heading);

      // Stub honesty banner should be present when gateway is offline (default here).
      await expect(page.getByTestId('stub-data-banner')).toBeVisible();
    });
  }

  test('unknown tenant id renders stable missing state with h1', async ({ page }) => {
    const response = await page.goto('/tenants/does-not-exist');
    expect(response?.ok()).toBeTruthy();
    await expect(page.locator('main h1')).toHaveText(/tenant/i);
    await expect(page.getByTestId('missing-resource')).toBeVisible();
  });
});
