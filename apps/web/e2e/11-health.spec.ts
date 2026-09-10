import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

/**
 * Health module production smoke (redesign nav screens).
 *
 * Screens: list, student profile, screenings, counselling, special needs.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const STUDENT_ID = process.env.HEALTH_STUDENT_ID ?? 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

test.describe('Health E2E', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live-backend health e2e.');

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  test('health records list renders heading and navigation CTAs', async ({ page }) => {
    await page.goto('/health');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /screenings/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /special needs/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /counselling/i }).first()).toBeVisible();
  });

  test('student health profile route resolves for seeded student', async ({ page }) => {
    await page.goto(`/health/${STUDENT_ID}`);
    await expect(page.locator('h1').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(20);
  });

  test('screenings list renders', async ({ page }) => {
    await page.goto('/health/screenings');
    await expect(page.getByRole('heading', { name: /screenings/i })).toBeVisible();
  });

  test('counselling list renders', async ({ page }) => {
    await page.goto('/health/counselling');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('special needs list renders', async ({ page }) => {
    await page.goto('/health/special-needs');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
});
