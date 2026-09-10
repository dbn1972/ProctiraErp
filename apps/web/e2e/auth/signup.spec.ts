/**
 * Task 49.7 — E2E: sign-up with role + terms acceptance.
 *
 * Fills the `/signup` form with valid personal information, picks a
 * tenant-supplied role, satisfies every password strength rule, accepts
 * the terms of service / privacy policy checkbox, and submits.
 *
 * Asserts:
 *   • The form posts the role-id, password, and termsAcceptance audit
 *     payload to `/api/auth/signup`.
 *   • The "check your email" confirmation surface renders after a
 *     successful response.
 *   • The form blocks submission when the terms checkbox is unchecked
 *     (Requirement 4 AC 15).
 *   • A weak password is rejected with an inline error and the
 *     password strength meter reflects the rating (Requirement 4 AC 14).
 *   • Axe-core scan on the empty form passes WCAG 2.1 AA.
 *
 * Requirements: 4.13, 4.14, 4.15, 4.17
 * Design: D
 */
import { expect, test } from '@playwright/test';

import { mockSignup } from './helpers';
import { runAxe } from '../helpers/axe';

const STRONG_PASSWORD = 'CorrectHorse9!Battery';
const WEAK_PASSWORD = 'abc';

test.describe('auth — sign-up', () => {
  test('happy path: posts role + terms acceptance and renders confirmation', async ({ page }) => {
    let signupBody: Record<string, unknown> | null = null;
    await page.route('**/api/tenant/signup-roles', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          roles: [
            { id: 'principal', label: 'Principal' },
            { id: 'teacher', label: 'Teacher' },
            { id: 'parent', label: 'Parent' },
          ],
        }),
      });
    });
    await page.route('**/api/auth/signup', async (route) => {
      signupBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          requiresApproval: true,
          email: 'jane@example.org',
          message: 'Activate via email',
        }),
      });
    });

    await page.goto('/signup');

    // Empty form — axe AA gate.
    await runAxe(page, { checkpointLabel: '/signup (empty form)' });

    // Personal information.
    await page.getByLabel(/full name/i).fill('Jane Doe');
    await page.getByLabel(/email address/i).fill('jane@example.org');
    await page.getByLabel(/institution/i).fill('Springfield High School');

    // Role picker.
    const roleTrigger = page.getByTestId('signup-role-trigger');
    await roleTrigger.click();
    await page.getByRole('option', { name: /teacher/i }).click();

    // Strong password.
    await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(STRONG_PASSWORD);

    // Terms acceptance.
    await page.getByTestId('signup-terms').click();

    await page.getByTestId('signup-submit').click();

    // Confirmation surface renders.
    await expect(page.getByTestId('signup-confirmation-message')).toBeVisible();

    // Body shape: role id + termsAcceptance payload present.
    await expect.poll(() => signupBody).not.toBeNull();
    expect(signupBody).toMatchObject({
      fullName: 'Jane Doe',
      email: 'jane@example.org',
      institutionName: 'Springfield High School',
      roleId: 'teacher',
    });
    const accepted = (
      signupBody as unknown as {
        termsAcceptance: Record<string, string>;
      }
    ).termsAcceptance;
    expect(accepted.acceptedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(accepted.termsVersion).toBeTruthy();
    expect(accepted.privacyVersion).toBeTruthy();
  });

  test('blocks submission when terms have not been accepted', async ({ page }) => {
    await mockSignup(page);
    let signupCalls = 0;
    await page.route('**/api/auth/signup', async (route) => {
      signupCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/signup');
    await page.getByLabel(/full name/i).fill('Jane Doe');
    await page.getByLabel(/email address/i).fill('jane@example.org');
    await page.getByLabel(/institution/i).fill('Springfield High School');
    await page.getByTestId('signup-role-trigger').click();
    await page.getByRole('option', { name: /teacher/i }).click();
    await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(STRONG_PASSWORD);
    // Terms intentionally NOT checked.

    await page.getByTestId('signup-submit').click();

    // Inline error on the terms field.
    await expect(page.getByTestId('signup-terms-error')).toBeVisible();
    expect(signupCalls).toBe(0);
  });

  test('weak password is rejected with an inline error and does not call the API', async ({
    page,
  }) => {
    await mockSignup(page);
    let signupCalls = 0;
    await page.route('**/api/auth/signup', async (route) => {
      signupCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });

    await page.goto('/signup');
    await page.getByLabel(/full name/i).fill('Jane Doe');
    await page.getByLabel(/email address/i).fill('jane@example.org');
    await page.getByLabel(/institution/i).fill('Springfield High School');
    await page.getByTestId('signup-role-trigger').click();
    await page.getByRole('option', { name: /teacher/i }).click();
    // Use a weak password that should be rejected client-side.
    await page.getByLabel('Password', { exact: true }).fill(WEAK_PASSWORD);
    await page.getByLabel(/confirm password/i).fill(WEAK_PASSWORD);
    await page.getByTestId('signup-terms').click();

    await page.getByTestId('signup-submit').click();

    // Inline error on the password field indicating it's too weak.
    await expect(page.getByTestId('signup-password-error')).toBeVisible();
    expect(signupCalls).toBe(0);
  });

  test('password strength meter renders and reflects the current rating', async ({ page }) => {
    await mockSignup(page);

    await page.goto('/signup');

    // The meter is not visible until the user starts typing a password.
    const meter = page.getByTestId('signup-password-meter');
    await expect(meter).toHaveCount(0);

    // Type a weak password — the meter should appear.
    await page.getByLabel('Password', { exact: true }).fill(WEAK_PASSWORD);
    await expect(meter).toBeVisible();

    // Type a strong password — the meter should update.
    await page.getByLabel('Password', { exact: true }).fill(STRONG_PASSWORD);
    await expect(meter).toBeVisible();
    // The meter should indicate a strong or good rating (not weak).
    await expect(meter).not.toContainText(/weak/i);
  });
});
