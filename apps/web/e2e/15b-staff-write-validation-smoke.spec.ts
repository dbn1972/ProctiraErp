import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

/**
 * Staff write-path — ungated client validation smoke.
 * Does not claim a successful staff create against a live API.
 */

test.describe('Staff write validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, { sub: 'staff-e2e-user', displayName: 'Staff E2E Admin' });
  });

  test('/staff/new validates required fields before submit', async ({ page }) => {
    const response = await page.goto('/staff/new', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /add staff/i })).toBeVisible();
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+attribute pair rather than assuming
    // one oscillation, since `toHaveAttribute` alone does not retry past a
    // strict-mode (multiple-match) violation.
    const staffForm = page.getByTestId('staff-form');
    await expect(async () => {
      await expect(staffForm).toHaveCount(1, { timeout: 2_000 });
      await expect(staffForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await page.getByRole('button', { name: /create staff record/i }).click();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Date is required')).toBeVisible();
    await expect(page.getByText('Identity number is required')).toBeVisible();
    await expect(page.getByText('Contact phone is required')).toBeVisible();
    await expect(page.getByText('Position is required')).toBeVisible();
  });
});
