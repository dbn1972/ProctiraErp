import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

/**
 * Scholarships module production smoke (6 redesign screens).
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
const APPLICATION_ID = '22222222-2222-4222-8222-222222222222';

test.describe('Scholarships E2E', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend scholarships e2e.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  test('programs list renders heading and navigation CTAs', async ({ page }) => {
    await page.goto('/scholarships');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /new program/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /applications/i }).first()).toBeVisible();
  });

  test('new program form exposes required fields', async ({ page }) => {
    await page.goto('/scholarships/programs/new');
    await expect(
      page.getByRole('heading', { name: /new scholarship program/i }),
    ).toBeVisible();
    await expect(page.locator('#program-name')).toBeVisible();
    await expect(page.locator('#program-code')).toBeVisible();
    await expect(page.locator('#program-slots')).toBeVisible();
    await expect(page.locator('#program-amount')).toBeVisible();
    await expect(page.getByRole('button', { name: /create program/i })).toBeVisible();
  });

  test('program detail route resolves for seeded program', async ({ page }) => {
    await page.goto(`/scholarships/programs/${PROGRAM_ID}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(20);
  });

  test('applications list renders', async ({ page }) => {
    await page.goto('/scholarships/applications');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('application detail route resolves for seeded application', async ({ page }) => {
    await page.goto(`/scholarships/applications/${APPLICATION_ID}`);
    await expect(page.locator('h1').first()).toBeVisible();
  });

  test('disbursements list renders', async ({ page }) => {
    await page.goto('/scholarships/disbursements');
    await expect(page.getByRole('heading', { name: /disbursements/i })).toBeVisible();
  });
});
