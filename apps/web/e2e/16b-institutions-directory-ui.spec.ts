/**
 * Institutions directory — production chrome must not ship prototype review controls.
 * Filled rows require a gateway; without one the page still renders the honest error state.
 */
import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

test.describe('Institutions directory UI', () => {
  test('signed-in directory hides prototype review controls', async ({ page }) => {
    await setupFakeTenantSession(page, {
      displayName: 'Priya Sharma',
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/institutions', { waitUntil: 'domcontentloaded' });

    const heading = page.getByRole('heading', { name: 'Institutions', exact: true });
    await expect(heading).toBeVisible();
    await expect(page.getByText('SCREEN STATE')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /UX review/i })).toHaveCount(0);

    const switcher = page.getByTestId('tenant-switcher').filter({ visible: true });
    await expect(switcher).toBeVisible();
    await expect(switcher).not.toContainText('Board:');

    const header = page.getByTestId('desktop-shell-header').filter({ visible: true });
    await expect(header).toBeVisible();
    const headerBox = await header.boundingBox();
    const headingBox = await heading.boundingBox();
    expect(headerBox).not.toBeNull();
    expect(headingBox).not.toBeNull();
    expect(headingBox!.y).toBeGreaterThanOrEqual(headerBox!.y + headerBox!.height - 1);

    const shell = page.locator('[data-shell="desktop"]');
    const shellBox = await shell.boundingBox();
    const sidebarBox = await page.locator('aside').first().boundingBox();
    expect(shellBox).not.toBeNull();
    expect(sidebarBox).not.toBeNull();
    expect(sidebarBox!.height).toBeGreaterThanOrEqual((shellBox!.height ?? 0) - 2);
  });
});
