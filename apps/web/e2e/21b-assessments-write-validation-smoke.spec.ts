import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

/**
 * Assessments write-path — ungated client validation smoke.
 * Does not claim a successful grading-scheme create against a live API.
 */

test.describe('Assessments write validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, {
      sub: 'assessment-e2e-user',
      displayName: 'Assessment E2E Admin',
    });
  });

  test('/assessments/schemes/new validates required name before submit', async ({
    page,
  }) => {
    const response = await page.goto('/assessments/schemes/new', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /grading scheme/i })).toBeVisible();
    await expect(page.getByTestId('grading-scheme-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );

    await page.locator('#name').fill('');
    await page.getByTestId('grading-scheme-submit').click();
    await expect(page.getByText('Name is required')).toBeVisible();
  });
});
