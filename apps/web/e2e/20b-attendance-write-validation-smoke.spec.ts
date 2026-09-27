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
    // `next start` briefly streams an unhydrated duplicate outside <main>
    // during the client swap, sometimes more than once before settling.
    // `toPass` retries the whole count+attribute pair rather than assuming
    // one oscillation, since `toHaveAttribute` alone does not retry past a
    // strict-mode (multiple-match) violation.
    const attendanceForm = page.getByTestId('attendance-marking-form');
    await expect(async () => {
      await expect(attendanceForm).toHaveCount(1, { timeout: 2_000 });
      await expect(attendanceForm).toHaveAttribute('data-hydrated', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId('attendance-marking-empty')).toBeVisible();

    await page.getByTestId('attendance-marking-submit').click();
    await expect(page.getByTestId('attendance-marking-error')).toBeVisible();
    await expect(page.getByTestId('attendance-marking-error')).toContainText(
      /Must be a valid UUID|Cannot record an empty roster|Date is required/i,
    );
    await expect(page.getByTestId('attendance-marking-success')).toHaveCount(0);
  });
});
