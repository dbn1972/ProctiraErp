/**
 * Task 49.7 — E2E: password reset link consumption.
 *
 * Visits `/reset-password?token=…` (the link surface emailed by the
 * forgot-password flow), enters a new password, and submits. Asserts:
 *
 *   • Successful reset posts to `/api/auth/reset-password` with the
 *     token from the URL and the new password, then redirects to
 *     `/login?reset=true`.
 *   • Invalid / expired token surfaces the upstream error message and
 *     keeps the user on `/reset-password`.
 *   • Mismatched confirmation password surfaces an inline error
 *     without making a network call.
 *   • Axe AA scan on the empty form passes.
 *
 * Requirements: 4.13
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockResetPassword } from './helpers';
import { runAxe } from '../helpers/axe';

const NEW_PASSWORD = 'CorrectHorse9!Battery';
const RESET_URL = '/reset-password?token=reset-token-abc';

test.describe('auth — reset password (link consumption)', () => {
  test('happy path: posts the new password and redirects to /login', async ({
    page,
  }) => {
    let resetBody: Record<string, unknown> | null = null;
    await page.route('**/api/auth/reset-password', async (route) => {
      resetBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto(RESET_URL);

    await runAxe(page, { checkpointLabel: '/reset-password (empty form)' });

    await page.getByLabel(/new password/i).fill(NEW_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /update password/i }).click();

    await page.waitForURL(
      (u) => u.pathname === '/login' && u.searchParams.get('reset') === 'true',
    );
    expect(resetBody).toMatchObject({
      token: 'reset-token-abc',
      newPassword: NEW_PASSWORD,
    });
  });

  test('invalid / expired token surfaces the upstream error message', async ({
    page,
  }) => {
    await mockResetPassword(page, {
      invalid: 'The reset link is invalid or has expired. Please request a new one.',
    });

    await page.goto(RESET_URL);
    await page.getByLabel(/new password/i).fill(NEW_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(
      page.getByText(/reset link is invalid or has expired/i),
    ).toBeVisible();
    // Still on /reset-password.
    expect(new URL(page.url()).pathname).toBe('/reset-password');
  });

  test('mismatched confirmation surfaces an inline error without calling the API', async ({
    page,
  }) => {
    let resetCalls = 0;
    await page.route('**/api/auth/reset-password', async (route) => {
      resetCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto(RESET_URL);
    await page.getByLabel(/new password/i).fill(NEW_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(`${NEW_PASSWORD}!`);
    await page.getByRole('button', { name: /update password/i }).click();

    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
    expect(resetCalls).toBe(0);
  });
});
