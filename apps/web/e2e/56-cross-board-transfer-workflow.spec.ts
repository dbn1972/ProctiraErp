/**
 * Cross-board transfer workflow.
 * Ungated: unauthenticated /transfers redirects to login.
 * Live (E2E_BACKEND_READY): create a Kabir draft in the UI and submit it, then
 * approve and complete that move. Also review the seeded Aarav row and reject Diya.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';
const AARAV = '00000000-0000-4000-8000-00000000b771';
const DIYA = '00000000-0000-4000-8000-00000000b772';
const SOURCE_SCHOOL = 'a2e96cd1-0232-4cce-97e2-00ebbfb9a374';
const DEST_SCHOOL = '00000000-0000-4000-8000-00000000b721';
const GRADE = '00000000-0000-4000-8000-00000000b731';
const DEST_CLASS = '00000000-0000-4000-8000-00000000b742';
const PERIOD = '00000000-0000-4000-8000-00000000ac01';
const KABIR_STUDENT = '00000000-0000-4000-8000-00000000b753';
const KABIR_ENROLLMENT = '00000000-0000-4000-8000-00000000b763';

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

  test('create and submit a draft, then approve, complete, and reject', async ({ page }) => {
    test.setTimeout(60_000);
    await setupGatewayTenantSession(page);
    await page.goto('/transfers');
    await expect(page.getByRole('heading', { name: /pending transfer approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aarav Transfer' })).toBeVisible();

    await page.getByLabel('Student').fill(KABIR_STUDENT);
    await page.getByLabel('Source enrollment').fill(KABIR_ENROLLMENT);
    await page.getByLabel('Requesting school').fill(SOURCE_SCHOOL);
    await page.getByLabel('Receiving school').fill(DEST_SCHOOL);
    await page.getByLabel('Destination grade').fill(GRADE);
    await page.getByLabel('Destination class').fill(DEST_CLASS);
    await page.getByLabel('Academic period').fill(PERIOD);
    await page.getByLabel('Reason').fill('Family moved from the CBSE school to the ICSE academy');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('heading', { name: 'Kabir Transfer' })).toBeVisible();
    await expect(page.getByText(/^DRAFT ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByText(/^SUBMITTED ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText(/^UNDER_REVIEW ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/^APPROVED ·/)).toBeVisible();
    await page.getByRole('button', { name: 'Complete enrollment move' }).click();
    await expect(page.getByText(/^COMPLETED ·/)).toBeVisible();

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
    await expect(page.getByText('No seat in the ICSE section').first()).toBeVisible();
  });
});
