/**
 * G-403 / G-723 — Visual regression baselines (desktop + tablet + mobile).
 *
 * Ungated public / auth screens so CI can run without E2E_BACKEND_READY.
 * Baselines live under e2e/24-visual-regression.spec.ts-snapshots/.
 *
 * Projects (see playwright.config.ts):
 *   - chromium      → desktop 1280×720
 *   - tablet        → iPad (gen 7)
 *   - mobile-chrome → Pixel 5
 *
 * Screenshot names are screen-only; Playwright appends `-{project}-{platform}`.
 */
import { expect, test } from '@playwright/test';

const SCREENS = [
  {
    name: 'login',
    path: '/login',
    assert: async (page: import('@playwright/test').Page) => {
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'parent-redirect-login',
    path: '/parent',
    assert: async (page: import('@playwright/test').Page) => {
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    },
  },
  {
    name: 'institutions-redirect-login',
    path: '/institutions',
    assert: async (page: import('@playwright/test').Page) => {
      await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
      await expect(page.getByRole('heading').first()).toBeVisible({ timeout: 20_000 });
    },
  },
] as const;

test.describe('Visual regression — top screens (desktop / tablet / mobile)', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(60_000);

  for (const screen of SCREENS) {
    test(`${screen.name} baseline`, async ({ page }, testInfo) => {
      // Desktop project keeps a fixed viewport so CI matches committed baselines.
      if (testInfo.project.name === 'chromium') {
        await page.setViewportSize({ width: 1280, height: 720 });
      }

      await page.goto(screen.path, { waitUntil: 'domcontentloaded' });
      await screen.assert(page);
      // Settle fonts / layout before capture (CI antialias variance is absorbed
      // by maxDiffPixelRatio below).
      await page.waitForTimeout(500);
      await expect(page).toHaveScreenshot(`${screen.name}.png`, {
        fullPage: true,
        animations: 'disabled',
        maxDiffPixelRatio: 0.05,
      });
    });
  }
});
