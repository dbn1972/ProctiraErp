import { expect, test } from '@playwright/test';

/**
 * Install Wizard production smoke.
 * First-run UI always runs. Live configure/finalize gates on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Install Wizard — first-run UI', () => {
  test('home loads with brand and Step 1 database fields', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/Proctira/i).first()).toBeVisible();
    await expect(
      page.getByRole('heading', { name: /step 1.*database|database/i }).first(),
    ).toBeVisible();
    await expect(page.getByLabel(/host/i).first()).toBeVisible();
  });

  test('footer links are not empty hash stubs', async ({ page }) => {
    await page.goto('/');
    const docs = page.getByRole('link', { name: /installation guide/i });
    const support = page.getByRole('link', { name: /get help/i });
    await expect(docs).toBeVisible();
    await expect(support).toBeVisible();
    const docsHref = await docs.getAttribute('href');
    const supportHref = await support.getAttribute('href');
    expect(docsHref).toBeTruthy();
    expect(supportHref).toBeTruthy();
    expect(docsHref).not.toMatch(/^#/);
    expect(supportHref).not.toMatch(/^#/);
  });

  test('health endpoint reports install-wizard', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();
    const body = await response.json();
    expect(body).toMatchObject({ status: 'ok', service: 'install-wizard' });
  });
});

test.describe('Install Wizard — live install API', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live install e2e.');

  test('status endpoint reachable when backend ready', async ({ request }) => {
    const base =
      process.env.NEXT_PUBLIC_INSTALL_API_URL ?? 'http://127.0.0.1:3000/install';
    const response = await request.get(`${base}/status`);
    expect(response.ok()).toBeTruthy();
  });
});
