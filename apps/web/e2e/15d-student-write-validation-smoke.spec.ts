import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

/**
 * Student write-path — ungated client validation smoke.
 * Does not claim a successful student create against a live API.
 */

test.describe('Student write validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, {
      sub: 'student-e2e-user',
      displayName: 'Student E2E Admin',
    });
  });

  test('/students/new validates required fields before submit', async ({ page }) => {
    const response = await page.goto('/students/new', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /add student/i })).toBeVisible();
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+attribute pair rather than assuming
    // one oscillation, since `toHaveAttribute` alone does not retry past a
    // strict-mode (multiple-match) violation.
    const studentForm = page.getByTestId('student-form');
    await expect(async () => {
      await expect(studentForm).toHaveCount(1, { timeout: 2_000 });
      await expect(studentForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await page.getByRole('button', { name: /save student/i }).click();
    await expect(page.getByText('First name is required')).toBeVisible();
    await expect(page.getByText('Last name is required')).toBeVisible();
    await expect(page.getByText('Date is required')).toBeVisible();
    await expect(page.getByText('Gender is required')).toBeVisible();
  });
});
