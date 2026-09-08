/**
 * Task 49.7 — E2E: forgot-password.
 *
 * The forgot-password flow MUST NOT disclose whether an email is
 * registered (Requirement 4 AC 13). The Next.js route handler at
 * `/api/auth/forgot-password` always responds with `{ success: true }`
 * regardless of whether the upstream auth-service found the address.
 *
 * Asserts:
 *   • Submitting any email surfaces the same "Check your email"
 *     confirmation, with no clue as to whether the address exists.
 *   • The same confirmation appears for an obviously-unregistered
 *     address (the fronting endpoint replies 200 either way).
 *   • Axe AA scan on the empty form.
 *
 * Requirements: 4.13
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockForgotPassword } from './helpers';
import { runAxe } from '../helpers/axe';

test.describe('auth — forgot password (non-disclosing)', () => {
  test('shows the same confirmation for any submitted email', async ({ page }) => {
    await mockForgotPassword(page);

    await page.goto('/forgot-password');

    await runAxe(page, { checkpointLabel: '/forgot-password (empty form)' });

    await page.getByLabel(/email address/i).fill('user@example.org');
    await page.getByRole('button', { name: /send reset link/i }).click();

    // Non-disclosing confirmation. The page shows "Check your email"
    // and includes the submitted address, never confirming whether it
    // is registered.
    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByText(/we sent a reset link to user@example\.org/i)).toBeVisible();
  });

  test('unknown email yields the same confirmation copy', async ({ page }) => {
    await mockForgotPassword(page);

    await page.goto('/forgot-password');
    await page.getByLabel(/email address/i).fill('not-a-real-user@nope.test');
    await page.getByRole('button', { name: /send reset link/i }).click();

    await expect(page.getByText(/check your email/i)).toBeVisible();
    // No "address not found" disclosure ever surfaces.
    await expect(page.getByText(/not\s+found/i)).toHaveCount(0);
  });
});
