/**
 * Auth — ungated matrix: axe + client validation across public identity routes.
 *
 * Always-on (mocked / no live IdP). Complements per-flow specs under e2e/auth/
 * with a single matrix that CI can list and run without E2E_BACKEND_READY.
 *
 * Residual: live IdP happy/negative against real auth-service remains waived
 * until auth-service is available in the agent environment.
 */
import { expect, test } from '@playwright/test';

import { runAxe } from '../helpers/axe';
import {
  mockForgotPassword,
  mockLogin,
  mockMfaVerify,
  mockResetPassword,
  mockSignup,
} from './helpers';

const AUTH_ROUTES: ReadonlyArray<{
  path: string;
  label: RegExp;
  checkpoint: string;
}> = [
  { path: '/login', label: /email/i, checkpoint: '/login' },
  { path: '/signup', label: /full name|email/i, checkpoint: '/signup' },
  { path: '/forgot-password', label: /email/i, checkpoint: '/forgot-password' },
  { path: '/reset-password?token=matrix-token', label: /password/i, checkpoint: '/reset-password' },
  { path: '/mfa?token=matrix-mfa', label: /digit 1|verification code|code/i, checkpoint: '/mfa' },
];

test.describe('Auth — ungated axe matrix', () => {
  for (const route of AUTH_ROUTES) {
    test(`${route.checkpoint} is WCAG 2.1 AA clean`, async ({ page }) => {
      if (route.path.startsWith('/signup')) {
        await mockSignup(page);
      }
      const response = await page.goto(route.path);
      expect(response?.ok() || (response && response.status() < 500)).toBeTruthy();
      await page
        .getByLabel(route.label)
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
      await runAxe(page, { checkpointLabel: `matrix ${route.checkpoint}` });
    });
  }
});

test.describe('Auth — ungated validation matrix', () => {
  test('login empty submit is blocked by required fields (no API call)', async ({ page }) => {
    let loginCalls = 0;
    await page.route('**/api/auth/login', async (route) => {
      loginCalls += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    });

    await page.goto('/login');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(loginCalls).toBe(0);
  });

  test('login invalid credentials surface error (mocked)', async ({ page }) => {
    await mockLogin(page, { invalid: 'Invalid email or password.' });
    await page.goto('/login');
    await page.getByRole('textbox', { name: /email/i }).fill('admin@school.edu');
    await page.getByRole('textbox', { name: /^password$/i }).fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/login');
  });

  test('signup weak password is rejected client-side', async ({ page }) => {
    await mockSignup(page);
    await page.goto('/signup');
    await page.getByLabel(/full name/i).fill('Jane Doe');
    await page.getByLabel(/email address/i).fill('jane@example.org');
    await page.getByLabel(/institution/i).fill('Springfield High');
    await page.getByLabel('Password', { exact: true }).fill('abc');
    await page.getByLabel(/confirm password/i).fill('abc');
    // Terms may be required — click if present; submit should still fail on weak pw.
    await page
      .getByTestId('signup-terms')
      .click()
      .catch(() => undefined);
    await page.getByTestId('signup-submit').click();
    await expect(page.getByText(/password|weak|at least|character/i).first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/signup');
  });

  test('forgot-password confirmation is non-disclosing', async ({ page }) => {
    await mockForgotPassword(page);
    await page.goto('/forgot-password');
    await page.getByLabel(/email address/i).fill('nobody@nope.test');
    await page.getByRole('button', { name: /send reset link/i }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
    await expect(page.getByText(/not\s+found/i)).toHaveCount(0);
  });

  test('reset-password mismatched confirmation does not call API', async ({ page }) => {
    let resetCalls = 0;
    await page.route('**/api/auth/reset-password', async (route) => {
      resetCalls += 1;
      await route.fulfill({ status: 200, body: '{}' });
    });
    await page.goto('/reset-password?token=matrix-token');
    const pwd = 'CorrectHorse9!Battery';
    await page.getByLabel(/new password/i).fill(pwd);
    await page.getByLabel(/confirm password/i).fill(`${pwd}!`);
    await page.getByRole('button', { name: /update password/i }).click();
    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
    expect(resetCalls).toBe(0);
  });

  test('mfa invalid code surfaces error (mocked)', async ({ page }) => {
    await mockMfaVerify(page, { invalid: 'That code is invalid or expired.' });
    await page.goto('/mfa?token=matrix-mfa');
    const group = page.getByRole('group', { name: /verification code/i });
    await expect(group).toBeVisible();
    await page.keyboard.type('999999');
    await page.getByRole('button', { name: /^verify$/i }).click();
    await expect(page.getByText(/that code is invalid or expired/i)).toBeVisible();
  });
});
