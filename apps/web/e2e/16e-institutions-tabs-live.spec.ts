/**
 * Live Sunrise gradebook, curriculum, and infrastructure tabs.
 * Requires Postgres seeded with db/seeds/006, the gateway, and E2E_BACKEND_READY=1.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const SUNRISE = '00000000-0000-4000-8000-00000000a501';
const MAYUR = '00000000-0000-4000-8000-00000000a551';

test.describe('Institution detail tabs — Sunrise live', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, and the Sunrise seed');

  test.beforeEach(async ({ page }) => {
    await setupGatewayTenantSession(page, {
      sub: 'priya-sharma',
      email: 'priya.sharma@school.edu',
      displayName: 'Priya Sharma',
      tenantId: SUNRISE,
      roles: [{ roleId: 'principal', roleName: 'Principal', areaId: null }],
    });
  });

  test('gradebook shows seeded Class 9-B rows and a section picker', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/institutions/${MAYUR}/gradebook`, { waitUntil: 'domcontentloaded' });
    const root = page.getByTestId('institution-gradebook').filter({ visible: true });
    await expect(root).toBeVisible();
    await expect(
      page.getByTestId('gradebook-section-picker').filter({ visible: true }),
    ).toBeVisible();
    await expect(root).toContainText('Aarav Mehta');
    await expect(root).toContainText('Published');
    await expect(root).not.toContainText('db/sql');
    await expect(root).not.toContainText('db/seeds');
    await page.goto(
      `/institutions/${MAYUR}/gradebook/report-cards/00000000-0000-4000-8000-00000000a5b1`,
      {
        waitUntil: 'domcontentloaded',
      },
    );
    await expect(page.getByTestId('report-card-preview').filter({ visible: true })).toBeVisible();
  });

  test('curriculum shows MATH units and taught coverage', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/institutions/${MAYUR}/curriculum`, { waitUntil: 'domcontentloaded' });
    const root = page.getByTestId('institution-curriculum').filter({ visible: true });
    await expect(root).toBeVisible();
    await expect(root).toContainText('Number systems');
    await expect(root).toContainText('M9.1');
  });

  test('infrastructure shows the facility tree and repair highlights', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/institutions/${MAYUR}/infrastructure`, { waitUntil: 'domcontentloaded' });
    const root = page.getByTestId('institution-infrastructure').filter({ visible: true });
    await expect(root).toBeVisible();
    await expect(root).toContainText('Room 204');
    await expect(root).toContainText('Chemistry lab L2');
    await expect(page.getByTestId('log-repair-request').filter({ visible: true })).toBeVisible();
  });
});
