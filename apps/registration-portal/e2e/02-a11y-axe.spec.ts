import { expect, test } from '@playwright/test';

import { runAxe } from './helpers/axe';

/**
 * Registration Portal — ungated axe + client validation on apply/track.
 * Live submit/status remains gated in 01-registration-portal-smoke.
 */
test.describe('Registration Portal — a11y axe (ungated)', () => {
  test('home is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await runAxe(page, { checkpointLabel: '/' });
  });

  test('schools is WCAG 2.1 AA clean', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto('/schools');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.leaflet-container')).toBeVisible();
    await runAxe(page, { checkpointLabel: '/schools' });
    expect(pageErrors.join('\n')).not.toContain('Map container is already initialized');
  });

  test('apply personal-info is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/apply/primary');
    await expect(
      page.getByRole('heading', { name: /personal information|student registration/i }).first(),
    ).toBeVisible();
    await runAxe(page, { checkpointLabel: '/apply/primary' });
  });

  test('apply documents is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/apply/primary/documents');
    await expect(page.locator('body')).toBeVisible();
    await runAxe(page, { checkpointLabel: '/apply/primary/documents' });
  });

  test('apply review is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/apply/primary/review');
    await expect(page.locator('body')).toBeVisible();
    await runAxe(page, { checkpointLabel: '/apply/primary/review' });
  });

  test('track form is WCAG 2.1 AA clean', async ({ page }) => {
    await page.goto('/track');
    await expect(page.getByLabel(/tracking number/i)).toBeVisible();
    await expect(page.getByLabel(/date of birth|dob/i).first()).toBeVisible();
    await runAxe(page, { checkpointLabel: '/track (empty form)' });
  });
});

test.describe('Registration Portal — institution map (ungated)', () => {
  test('marker popup renders institution fields as literal text', async ({ page }) => {
    const institutionName = '<img src=x onerror=alert(1)> Academy';
    const institutionType = '<script>alert(2)</script> Primary';
    const institutionAddress = '1 <b>Main</b> Street';
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.route(
      (url) => url.pathname === '/api/registrations/institutions',
      async (route) => {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            data: [
              {
                id: 'institution-e2e',
                name: institutionName,
                code: 'E2E-001',
                typeId: 'primary',
                typeName: institutionType,
                areaId: 'area-e2e',
                areaName: 'Central Area',
                latitude: 51.505,
                longitude: -0.09,
                address: institutionAddress,
                availableGrades: ['1'],
              },
            ],
            meta: {
              page: 1,
              pageSize: 200,
              totalItems: 1,
              totalPages: 1,
            },
          }),
        });
      },
    );

    await page.goto('/schools');
    const marker = page.locator('.leaflet-marker-icon');
    await expect(marker).toHaveCount(1);
    await marker.click();

    const popup = page.locator('.leaflet-popup-content');
    await expect(popup).toContainText(institutionName);
    await expect(popup).toContainText(institutionType);
    await expect(popup).toContainText(institutionAddress);
    await expect(popup.locator('img, script, b')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Registration Portal — apply/track validation (ungated)', () => {
  test('track empty submit surfaces field errors', async ({ page }) => {
    await page.goto('/track');
    await page.getByRole('button', { name: /track|search|check|look.?up/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/track');
  });

  test('track invalid tracking number stays on form', async ({ page }) => {
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill('BAD');
    await page
      .getByLabel(/date of birth|dob/i)
      .first()
      .fill('2010-01-01');
    await page.getByRole('button', { name: /track|search|check|look.?up/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/track');
  });
});
