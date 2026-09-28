/**
 * Cross-board transfer workflow.
 * Ungated: unauthenticated /transfers redirects to login.
 * Live (E2E_BACKEND_READY): submit is already seeded; admin reviews, approves,
 * completes Aarav, and rejects Diya with a comment.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const AARAV = '00000000-0000-4000-8000-00000000b771';
const DIYA = '00000000-0000-4000-8000-00000000b772';

test.describe('Cross-board transfers — inventory smoke (ungated)', () => {
  test('/transfers unauthenticated → /login', async ({ page }) => {
    await page.goto('/transfers', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('/transfers/[id] unauthenticated → /login', async ({ page }) => {
    await page.goto(`/transfers/${AARAV}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Cross-board transfers — live workflow', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, Postgres, and the E2E seed');

  test('approve and complete one transfer, reject another', async ({ page }) => {
    await setupGatewayTenantSession(page);
    await page.goto('/transfers');
    await expect(page.getByRole('heading', { name: /pending transfer approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aarav Transfer' })).toBeVisible();

    await page.goto(`/transfers/${AARAV}`);
    await expect(page.getByRole('heading', { name: 'Aarav Transfer' })).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText(/^UNDER_REVIEW ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/^APPROVED ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Complete enrollment move' }).click();
    await expect(page.getByText(/^COMPLETED ·/)).toBeVisible();

    await page.goto(`/transfers/${DIYA}`);
    await expect(page.getByRole('heading', { name: 'Diya Transfer' })).toBeVisible();
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByLabel('Comment').fill('No seat in the ICSE section');
    await page.getByTestId('transfer-reject-confirm').click();
    await expect(page.getByText(/^REJECTED ·/)).toBeVisible();
    await expect(page.getByText('No seat in the ICSE section')).toBeVisible();
  });
});
