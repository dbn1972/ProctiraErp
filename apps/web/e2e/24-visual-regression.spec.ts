/**
 * G-403 — Visual regression baselines (desktop Chromium).
 *
 * Ungated public / auth screens so CI can run without E2E_BACKEND_READY.
 * Baselines live under e2e/24-visual-regression.spec.ts-snapshots/.
 */
import { expect, test } from '@playwright/test';

test.describe('Visual regression — top screens (desktop)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  test.use({
    viewport: { width: 1280, height: 720 },
    colorScheme: 'light',
  });

  test('login page desktop baseline', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('login-desktop.png', {
      fullPage: true,
      animations: 'disabled',
      // CI font / antialias variance ~3%; keep assertion CI-stable without rebaselining.
      maxDiffPixelRatio: 0.05,
    });
  });

  test('parent portal unauthenticated redirect → login shell', async ({ page }) => {
    await page.goto('/parent', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('parent-redirect-login-desktop.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
    });
  });

  test('institutions inventory redirect → login desktop baseline', async ({ page }) => {
    await page.goto('/institutions', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot('institutions-redirect-login-desktop.png', {
      fullPage: true,
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
    });
  });
});
