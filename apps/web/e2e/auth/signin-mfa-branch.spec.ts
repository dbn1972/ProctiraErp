/**
 * Task 49.7 — E2E: sign-in MFA branch.
 *
 * The auth-service can respond to `POST /api/auth/login` with
 * `{ requiresMfa: true, mfaToken: '…' }` instead of session cookies. In
 * that case the client routes the user to the MFA verification page.
 * This spec asserts that:
 *   • the credential form forwards the user to `/mfa?token=…`
 *   • the challenge token is preserved on the URL
 *
 * Requirements: 4.11, 4.16
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockLogin } from './helpers';

test.describe('auth — sign-in (MFA challenge)', () => {
  test('login response with requiresMfa=true routes to /mfa with the challenge token', async ({
    page,
  }) => {
    await mockLogin(page, {
      requiresMfa: true,
      mfaToken: 'mfa-challenge-token-xyz',
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@school.edu');
    await page
      .getByLabel(/password/i, { exact: true })
      .fill('CorrectHorse9!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL((u) => u.pathname.startsWith('/mfa'));
    const url = new URL(page.url());
    expect(url.pathname).toBe('/mfa');
    expect(url.searchParams.get('token')).toBe('mfa-challenge-token-xyz');

    // The 6-digit code group is rendered with role="group" and an
    // accessible name; this is the contract `mfa-form.keyboard.md`
    // pins down.
    await expect(
      page.getByRole('group', { name: /verification code/i }),
    ).toBeVisible();
  });
});
