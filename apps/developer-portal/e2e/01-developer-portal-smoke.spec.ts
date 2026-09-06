import { expect, test } from '@playwright/test';

/**
 * Developer Portal production smoke.
 * Route inventory always runs. Live API-key issuance gates on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

const DEVELOPER_ROUTES: ReadonlyArray<{ path: string; heading: RegExp }> = [
  { path: '/', heading: /build for|every school/i },
  { path: '/docs', heading: /documentation/i },
  { path: '/dashboard', heading: /developer dashboard/i },
  { path: '/marketplace', heading: /plugin marketplace/i },
];

test.describe('Developer Portal — public surfaces', () => {
  for (const route of DEVELOPER_ROUTES) {
    test(`${route.path} renders`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(route.heading);
    });
  }

  test('home shows ProctiraERP Developers brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(/Proctira/i).first()).toBeVisible();
    await expect(page.getByText(/Developers/i).first()).toBeVisible();
  });

  test('health endpoint reports developer-portal', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'developer-portal' });
  });
});

test.describe('Developer Portal — live API keys', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live API-key e2e.');

  test('placeholder for keyed dashboard once auth ships', async () => {
    expect(BACKEND_READY).toBe(true);
  });
});
