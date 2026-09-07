import { expect, test } from '@playwright/test';

import { setupFakeTenantSession } from './fixtures/fake-session';

/**
 * Attendance write-path — ungated client validation smoke.
 * Empty roster / missing selectors must surface zod errors — never demo-ack success.
 */

test.describe('Attendance write validation — ungated', () => {
  test.beforeEach(async ({ page }) => {
    await setupFakeTenantSession(page, {
      sub: 'attendance-e2e-user',
      displayName: 'Attendance E2E Admin',
    });
  });

  test('/attendance rejects empty roster before live mark', async ({ page }) => {
    const response = await page.goto('/attendance', { waitUntil: 'domcontentloaded' });
    expect(response?.status() ?? 500).toBeLessThan(400);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await expect(page.getByTestId('attendance-marking-form')).toHaveAttribute(
      'data-hydrated',
      'true',
    );
    await expect(page.getByTestId('attendance-marking-empty')).toBeVisible();

    await page.getByTestId('attendance-marking-submit').click();
    await expect(page.getByTestId('attendance-marking-error')).toBeVisible();
    await expect(page.getByTestId('attendance-marking-error')).toContainText(
      /Must be a valid UUID|Cannot record an empty roster|Date is required/i,
    );
    await expect(page.getByTestId('attendance-marking-success')).toHaveCount(0);
  });
});
