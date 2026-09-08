import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

/**
 * Staff assignment / appraisal write-path — ungated client validation smoke.
 * Soft-renders forms when staff/API data is unavailable (fake JWT).
 * Does not claim a successful assignment/appraisal create against a live API.
 */

const STAFF_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

test.describe('Staff assignment / appraisal validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, { sub: 'staff-e2e-user', displayName: 'Staff E2E Admin' });
  });

  test('/staff/[id]/assignments/new validates required fields before submit', async ({ page }) => {
    const response = await page.goto(`/staff/${STAFF_ID}/assignments/new`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /new teaching assignment/i })).toBeVisible();
    await expect(page.getByTestId('staff-assignment-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.locator('#role').fill('');
    await page.getByRole('button', { name: /create assignment/i }).click();

    await expect(page.getByText('Role is required')).toBeVisible();
    await expect(page.getByText('Must be a valid UUID').first()).toBeVisible();
  });

  test('/staff/[id]/appraisals/new validates required fields before submit', async ({ page }) => {
    const response = await page.goto(`/staff/${STAFF_ID}/appraisals/new`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /new appraisal/i })).toBeVisible();
    await expect(page.getByTestId('staff-appraisal-form')).toHaveAttribute('data-hydrated', 'true');

    await page.locator('#appraisalDate').fill('');
    const scoreInput = page.locator('#scores\\.0\\.score');
    if (await scoreInput.count()) {
      await scoreInput.fill('');
    }
    await page.getByRole('button', { name: /save appraisal/i }).click();

    await expect(page.getByText('Date is required')).toBeVisible();
    const uuidOrScore = page
      .getByText('Must be a valid UUID')
      .or(page.getByText('At least one score is required'))
      .or(page.getByText('Score is required'));
    await expect(uuidOrScore.first()).toBeVisible();
  });
});
