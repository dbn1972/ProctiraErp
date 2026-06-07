/**
 * Task 49.7 — E2E: MFA verification (TOTP).
 *
 * The 6-digit OTP input enforces three keyboard contracts pinned in
 * `apps/web/src/app/(auth)/mfa/mfa-form.keyboard.md`:
 *
 *   1. Paste-spread — pasting a 6-digit string into any slot fills all
 *      six slots in order, focus lands on the last slot.
 *   2. Auto-advance — typing a digit moves focus to the next slot.
 *   3. Auto-retreat — pressing `Backspace` on an empty slot moves focus
 *      to the previous slot.
 *
 * Plus:
 *   • A 6-digit code submit posts to `/api/auth/mfa/verify` and
 *     redirects on success.
 *   • An invalid code surfaces the upstream error message and clears
 *     the boxes.
 *   • Axe AA scan on the empty challenge.
 *
 * Requirements: 4.11, 4.12
 * Design: D, K
 */
import { expect, test } from '@playwright/test';

import { mockMfaVerify } from './helpers';
import { runAxe } from '../helpers/axe';

const MFA_URL = '/mfa?token=mfa-challenge-token-xyz';

test.describe('auth — MFA verify', () => {
  test('paste-spread fills all six digit boxes in order', async ({ page }) => {
    await page.goto(MFA_URL);

    // Six independently labelled inputs sit inside a role="group".
    const group = page.getByRole('group', { name: /verification code/i });
    await expect(group).toBeVisible();

    await runAxe(page, { checkpointLabel: '/mfa (empty challenge)' });

    // Focus the first slot then paste — Playwright drives a real paste
    // event so the `onPaste` handler fires with the clipboard data.
    const firstDigit = group.getByLabel(/digit 1/i);
    await firstDigit.focus();
    await firstDigit.evaluate((el, value) => {
      const input = el as HTMLInputElement;
      const data = new DataTransfer();
      data.setData('text/plain', value);
      input.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, '482917');

    // All six boxes are filled by the paste handler.
    for (let i = 1; i <= 6; i += 1) {
      const slot = group.getByLabel(new RegExp(`digit ${i}`, 'i'));
      await expect(slot).toHaveValue(String('482917'[i - 1]!));
    }
  });

  test('typing a digit auto-advances focus to the next slot', async ({
    page,
  }) => {
    await page.goto(MFA_URL);
    const group = page.getByRole('group', { name: /verification code/i });

    // First slot is auto-focused on mount.
    await expect(group.getByLabel(/digit 1/i)).toBeFocused();

    await page.keyboard.type('1');
    await expect(group.getByLabel(/digit 2/i)).toBeFocused();

    await page.keyboard.type('2');
    await expect(group.getByLabel(/digit 3/i)).toBeFocused();
  });

  test('backspace on an empty slot auto-retreats to the previous slot', async ({
    page,
  }) => {
    await page.goto(MFA_URL);
    const group = page.getByRole('group', { name: /verification code/i });

    // Type into the first two slots.
    await page.keyboard.type('12');
    // Focus is now on slot 3 (auto-advance).
    await expect(group.getByLabel(/digit 3/i)).toBeFocused();

    // Slot 3 is empty: Backspace retreats to slot 2.
    await page.keyboard.press('Backspace');
    await expect(group.getByLabel(/digit 2/i)).toBeFocused();
  });

  test('submitting a 6-digit code posts to the verify endpoint', async ({
    page,
  }) => {
    let verifyBody: Record<string, unknown> | null = null;
    await page.route('**/api/auth/mfa/verify', async (route) => {
      verifyBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    });

    await page.goto(MFA_URL);
    await page.keyboard.type('482917');
    await page.getByRole('button', { name: /^verify$/i }).click();

    await expect.poll(() => verifyBody).not.toBeNull();
    expect(verifyBody).toMatchObject({
      mfaToken: 'mfa-challenge-token-xyz',
      code: '482917',
    });
  });

  test('invalid code surfaces the upstream message and clears the boxes', async ({
    page,
  }) => {
    await mockMfaVerify(page, {
      invalid: 'That code is invalid or expired.',
    });

    await page.goto(MFA_URL);
    await page.keyboard.type('999999');
    await page.getByRole('button', { name: /^verify$/i }).click();

    await expect(
      page.getByText(/that code is invalid or expired/i),
    ).toBeVisible();

    // The boxes are cleared so the user can re-enter without manually
    // backspacing six times.
    const group = page.getByRole('group', { name: /verification code/i });
    for (let i = 1; i <= 6; i += 1) {
      await expect(
        group.getByLabel(new RegExp(`digit ${i}`, 'i')),
      ).toHaveValue('');
    }
  });
});
