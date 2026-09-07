import { expect, test, type Page } from '@playwright/test';

/**
 * Platform Admin — expanded break-glass / tenant / plugin smokes.
 * Prefer live gateway when reachable; validation stays ungated.
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

test.describe('Platform Admin — tenant / break-glass / plugin inventory (ungated)', () => {
  test.beforeEach(async ({ page }) => {
    await setupOperatorSession(page);
  });

  test('tenants list renders with heading', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/tenant/i);
  });

  test('tenant provision form rejects empty required fields', async ({ page }) => {
    await page.goto('/tenants/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.getByRole('button', { name: /provision|create|submit/i }).click();
    await expect(page.getByText(/please fix|required|invalid/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('break-glass page exposes justification field', async ({ page }) => {
    await page.goto('/break-glass');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/break-glass/i);
    await expect(page.locator('#justification')).toBeVisible();
  });

  test('break-glass requests queue renders', async ({ page }) => {
    await page.goto('/break-glass/requests');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('plugin detail exposes decision reason field', async ({ page }) => {
    await page.goto('/plugins/plg_001');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('#reason')).toBeVisible();
  });
});

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Platform Admin — live gateway prefer (E2E_BACKEND_READY)', () => {
  test.skip(!BACKEND_READY, 'Requires platform-admin UI plugin on the live gateway');

  test.beforeEach(async ({ page }) => {
    await setupOperatorSession(page);
  });

  test('tenants list does not show stub-only banner when gateway responds', async ({ page }) => {
    await page.goto('/tenants');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/tenant/i);
    // Stub banner uses data-mode=stub when source==='stub'
    const stub = page.locator('[data-mode="stub"]');
    await expect(stub).toHaveCount(0);
  });
});
