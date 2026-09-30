/**
 * Task 49.7 — E2E: sign-in MFA branch.
 *
 * The auth-service can respond to `POST /api/auth/login` with
 * `{ requiresMfa: true }` (challenge token in an httpOnly cookie) instead of session cookies. In
 * that case the client routes the user to the MFA verification page.
 * This spec asserts that:
 *   • the credential form forwards the user to `/mfa`
 *   • the challenge token is never placed on the URL (PRC-L024)
 *
 * Requirements: 4.11, 4.16
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockLogin } from './helpers';

test.describe('auth — sign-in (MFA challenge)', () => {
  test('login response with requiresMfa=true routes to /mfa without the challenge token in the URL', async ({
    page,
  }) => {
    await mockLogin(page, {
      requiresMfa: true,
      mfaToken: 'mfa-challenge-token-xyz',
    });

    await page.goto('/login');
    await page.getByLabel(/email/i).fill('admin@school.edu');
    await page.getByRole('textbox', { name: /^password$/i }).fill('CorrectHorse9!');
    await page.getByRole('button', { name: /sign in/i }).click();

    await page.waitForURL((u) => u.pathname.startsWith('/mfa'));
    const url = new URL(page.url());
    expect(url.pathname).toBe('/mfa');
    expect(url.searchParams.get('token')).toBeNull();
    expect(page.url()).not.toContain('mfa-challenge-token-xyz');

    // The 6-digit code group is rendered with role="group" and an
    // accessible name; this is the contract `mfa-form.keyboard.md`
    // pins down.
    await expect(page.getByRole('group', { name: /verification code/i })).toBeVisible();
  });
});
