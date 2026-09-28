/**
 * Cross-board transfer workflow.
 * Ungated: unauthenticated /transfers redirects to login.
 * Live (E2E_BACKEND_READY): create Kabir and Meera drafts in the UI.
 * Seeded Aarav and Diya rows are not mutated, so a retry cannot append history onto them.
 */
import { expect, test } from '@playwright/test';

import { setupGatewayTenantSession } from './fixtures/fake-session';

const BACKEND_READY = process.env.E2E_BACKEND_READY === '1';

async function chooseStudent(page: import('@playwright/test').Page, name: string) {
  await page.getByLabel('Student').fill(name);
  await page.getByRole('option', { name: new RegExp(name) }).click();
  await expect(page.getByTestId('transfer-current-enrollment')).toBeVisible();
}

async function saveDraft(page: import('@playwright/test').Page, student: string, reason: string) {
  await page.goto('/transfers');
  await chooseStudent(page, student);
  await page.getByLabel('Receiving school').selectOption({ label: /E2E ICSE Academy/ });
  await page.getByLabel('Destination grade').selectOption({ label: 'Grade 9' });
  await page.getByLabel('Destination class').selectOption({ label: '9-A' });
  await page.getByLabel('Academic period').selectOption({ label: 'E2E Academic Year' });
  await page.getByLabel('Reason').fill(reason);
  await page.getByRole('button', { name: 'Save draft' }).click();
}

test.describe('Cross-board transfers — inventory smoke (ungated)', () => {
  test('/transfers unauthenticated → /login', async ({ page }) => {
    await page.goto('/transfers', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('/transfers/[id] unauthenticated → /login', async ({ page }) => {
    await page.goto('/transfers/00000000-0000-4000-8000-00000000b771', {
      waitUntil: 'domcontentloaded',
    });
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('Cross-board transfers — live workflow', () => {
  test.skip(!BACKEND_READY, 'Requires E2E_BACKEND_READY=1, gateway, Postgres, and the E2E seed');

  test('create and submit a draft, then approve, complete, and reject a second draft', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await setupGatewayTenantSession(page);
    await page.goto('/transfers');
    await expect(page.getByRole('heading', { name: /pending transfer approvals/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Aarav Transfer' })).toBeVisible();

    await saveDraft(
      page,
      'Kabir Transfer',
      'Family moved from the CBSE school to the ICSE academy',
    );
    await expect(page.getByRole('heading', { name: 'Kabir Transfer' })).toBeVisible();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Draft');
    await expect(
      page.getByTestId('transfer-header-actions').getByRole('button', { name: 'Submit' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Submit' }).click();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Submitted');
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Under review');
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Approved');
    await page.getByRole('button', { name: 'Complete enrollment move' }).click();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Completed');

    await saveDraft(page, 'Meera Nair', 'Seat request for the reject path');
    await expect(page.getByRole('heading', { name: 'Meera Nair' })).toBeVisible();
    await page.getByRole('button', { name: 'Submit' }).click();
    await page.getByRole('button', { name: 'Start review' }).click();
    await page.getByRole('button', { name: 'Reject' }).click();
    await page.getByRole('dialog').getByLabel('Reason').fill('No seat in the ICSE section');
    await page.getByTestId('transfer-reject-confirm').click();
    await expect(page.getByTestId('transfer-status-pill')).toHaveText('Rejected');
    await expect(page.getByText('No seat in the ICSE section')).toHaveCount(1);
    await expect(page.getByText(/rejected ·/i)).toBeVisible();
  });
});
