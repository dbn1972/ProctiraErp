import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * Public Website — ungated axe WCAG 2.1 AA smoke on key marketing routes.
 * Always runs (no backend). Contact form is scanned in empty state.
 */
const AXE_ROUTES: ReadonlyArray<{ path: string; waitFor?: RegExp }> = [
  { path: '/', waitFor: /proctira|civitas|education|school/i },
  { path: '/product' },
  { path: '/status' },
  { path: '/contact' },
  { path: '/privacy' },
  { path: '/legal' },
];

test.describe('Public Website — a11y axe (ungated)', () => {
  for (const route of AXE_ROUTES) {
    test(`${route.path} is WCAG 2.1 AA clean`, async ({ page }) => {
      const response = await page.goto(route.path);
      expect(response?.ok()).toBeTruthy();
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      if (route.path === '/contact') {
        await expect(page.getByLabel(/^name$/i)).toBeVisible();
      }
      if (route.path === '/status') {
        await expect(page.getByTestId('status-overall')).toBeVisible();
      }
      await runAxe(page, { checkpointLabel: route.path });
    });
  }
});
