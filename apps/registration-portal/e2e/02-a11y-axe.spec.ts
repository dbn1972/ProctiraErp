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
    await page.goto('/schools');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await runAxe(page, { checkpointLabel: '/schools' });
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
