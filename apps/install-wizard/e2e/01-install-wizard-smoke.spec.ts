import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * Install Wizard production smoke.
 * First-run UI + axe always run. Live configure/finalize gates on E2E_BACKEND_READY.
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
    await expect(page.getByTestId('database-step')).toBeVisible();
  });

  test('stepper lists all six setup stages', async ({ page }) => {
    await page.goto('/');
    for (const label of [
      'Database',
      'Object Storage',
      'Redis Cache',
      'Message Queue',
      'CDN',
      'Admin Account',
    ]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test('database step shows client validation when credentials empty', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('database-test-submit').click();
    await expect(page.getByTestId('db-error-username')).toContainText(/required/i);
    await expect(page.getByTestId('db-error-password')).toContainText(/required/i);
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

test.describe('Install Wizard — axe WCAG 2.1 AA', () => {
  test('setup home has no critical axe violations', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('database-step')).toBeVisible();
    await runAxe(page, { checkpointLabel: 'install-wizard-home' });
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
