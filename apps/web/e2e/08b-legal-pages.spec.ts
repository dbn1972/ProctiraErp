import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * E2E for `/legal/privacy` and `/legal/terms`.
 *
 * These components existed, were unit-tested, and had no route: they were mounted by the
 * Vite-era `featureRegistry.ts`, which the App Router does not read. The signup form links
 * to both from its consent copy, so a user was asked to accept terms they could not open.
 *
 * Both pages are anonymous-accessible, so no login fixture is needed — which is also the
 * property most worth pinning: a consent document that requires a session is useless at
 * the moment consent is given.
 */
const PAGES = [
  { path: '/legal/privacy', testId: 'legal-privacy-page' },
  { path: '/legal/terms', testId: 'legal-terms-page' },
] as const;

test.describe('Legal pages linked from signup consent', () => {
  for (const { path, testId } of PAGES) {
    test(`${path} renders for an anonymous visitor`, async ({ page }) => {
      const response = await page.goto(path);

      // Not a 404, and not a redirect to /login.
      expect(response?.status()).toBeLessThan(400);
      expect(new URL(page.url()).pathname).toBe(path);

      await expect(page.getByTestId(testId)).toBeVisible();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    });

    test(`${path} has no WCAG 2.1 AA violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByTestId(testId)).toBeVisible();
      await runAxe(page, { checkpointLabel: path });
    });
  }

  test('the signup consent links actually open the documents', async ({ page }) => {
    // The end-to-end property that matters: the links a user is shown at the moment they
    // are asked to agree must resolve. This is the journey the unit-level dead-link test
    // guards structurally.
    await page.goto('/signup');

    for (const { path, testId } of PAGES) {
      const link = page.locator(`a[href="${path}"]`).first();
      await expect(link).toBeVisible();

      await link.click();
      await expect(page.getByTestId(testId)).toBeVisible();
      await page.goBack();
    }
  });
});
