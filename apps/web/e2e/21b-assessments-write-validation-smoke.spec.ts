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

  test('/assessments/schemes/new validates required name before submit', async ({ page }) => {
    const response = await page.goto('/assessments/schemes/new', {
      waitUntil: 'domcontentloaded',
    });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading', { name: /grading scheme/i })).toBeVisible();
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+attribute pair rather than assuming
    // one oscillation, since `toHaveAttribute` alone does not retry past a
    // strict-mode (multiple-match) violation.
    const schemeForm = page.getByTestId('grading-scheme-form');
    await expect(async () => {
      await expect(schemeForm).toHaveCount(1, { timeout: 2_000 });
      await expect(schemeForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });

    await page.locator('#name').fill('');
    await page.getByTestId('grading-scheme-submit').click();
    await expect(page.getByText('Name is required')).toBeVisible();
  });
});
