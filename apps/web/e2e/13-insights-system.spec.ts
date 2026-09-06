import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

/**
 * Insights & System production smoke (Reports / DW / Admin / Public track).
 *
 * Screens: reports, data-warehouse (+ import, field-mapping, GIS map),
 * admin hub + nested settings, public /track.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const REPORT_ID = process.env.REPORT_TEMPLATE_ID ?? 'rrrrrrrr-rrrr-4rrr-8rrr-rrrrrrrrrrr1';

test.describe('Insights & System E2E', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend Insights & System e2e.',
  );

  test.beforeEach(async ({ page }) => {
    await loginAsTenantAdmin(page);
  });

  test('reports catalog renders heading and new-report CTA', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /new report/i }).first()).toBeVisible();
  });

  test('report builder route renders', async ({ page }) => {
    await page.goto('/reports/new');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('report results route resolves for seeded id', async ({ page }) => {
    await page.goto(`/reports/${REPORT_ID}/results`);
    await expect(page.locator('h1').first()).toBeVisible();
    const body = await page.locator('body').innerText();
    expect(body.length).toBeGreaterThan(20);
  });

  test('data warehouse overview links import, mapping, and GIS', async ({ page }) => {
    await page.goto('/data-warehouse');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /import data/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /field mapping/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /gis map/i }).first()).toBeVisible();
  });

  test('import page exposes continue-to-mapping CTA', async ({ page }) => {
    await page.goto('/data-warehouse/import');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /continue to mapping/i }).first()).toBeVisible();
  });

  test('field mapping is distinct from GIS map', async ({ page }) => {
    await page.goto('/data-warehouse/field-mapping');
    await expect(page.getByRole('heading', { name: /field mapping/i })).toBeVisible();
    await expect(page.getByLabel(/warehouse field for student_id/i)).toBeVisible();

    await page.goto('/data-warehouse/map');
    await expect(page.getByRole('heading', { name: /gis map/i })).toBeVisible();
  });

  test('admin hub and nested settings routes render', async ({ page }) => {
    for (const path of [
      '/admin',
      '/admin/users',
      '/admin/roles',
      '/admin/permissions',
      '/admin/tenant',
    ]) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});

test.describe('Insights & System — public track (no backend)', () => {
  test('public track form is reachable', async ({ page }) => {
    await page.route('**/api/v1/registration/applications/**', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'NOT_FOUND' }),
      });
    });
    await page.goto('/track');
    await expect(page.getByLabel(/tracking number/i)).toBeVisible();
  });
});
