import { expect, test } from '@playwright/test';
import { runAxe } from './helpers/axe';
/**
 * PRC-M154: `/tenant-suspended` is where middleware sends a suspended tenant. It is a
 * public path, so it must render for an anonymous visitor (no redirect loop to /login).
 */
test.describe('Tenant suspended notice', () => {
  test('/tenant-suspended renders for an anonymous visitor', async ({ page }) => {
    const response = await page.goto('/tenant-suspended');
    expect(response?.status()).toBeLessThan(400);
    expect(new URL(page.url()).pathname).toBe('/tenant-suspended');
    await expect(page.getByTestId('tenant-suspended-page')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
  test('/tenant-suspended has no WCAG 2.1 AA violations', async ({ page }) => {
    await page.goto('/tenant-suspended');
    await expect(page.getByTestId('tenant-suspended-page')).toBeVisible();
    await runAxe(page, { checkpointLabel: '/tenant-suspended' });
  });
});
