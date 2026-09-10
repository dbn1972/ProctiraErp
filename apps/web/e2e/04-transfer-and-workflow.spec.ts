import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: transfer request → workflow approval → status verification', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('a transfer request flows through approval and updates enrollment status', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    // 1. Open the first existing student
    await page.goto('/students');
    const firstStudent = page.getByRole('link', { name: /^[A-Z][\w\s.'-]+$/ }).first();
    await firstStudent.click();

    const studentHeading = page.getByRole('heading').first();
    const studentName = (await studentHeading.innerText()).trim();
    expect(studentName.length).toBeGreaterThan(0);

    // 2. Open transfer dialog
    await page
      .getByRole('button', { name: /request transfer|transfer/i })
      .first()
      .click();

    // Destination institution
    await page.getByLabel(/destination|new institution|institution/i).click();
    await page.getByRole('option').nth(1).click();

    await page.getByLabel(/reason/i).fill('Family relocation - automated e2e test');

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await page.getByLabel(/date|effective/i).fill(tomorrow);

    await page.getByRole('button', { name: /submit|request/i }).click();
    await expect(page.getByText(/pending approval|pending/i)).toBeVisible({ timeout: 10_000 });

    // 3. Approve in workflow approvals
    await page.goto('/workflows/approvals');
    const requestRow = page.getByRole('row', { name: new RegExp(studentName, 'i') }).first();
    await expect(requestRow).toBeVisible({ timeout: 15_000 });
    await requestRow.getByRole('button', { name: /approve/i }).click();

    const confirmDialog = page.getByRole('dialog');
    if (await confirmDialog.isVisible().catch(() => false)) {
      await confirmDialog.getByRole('button', { name: /confirm|approve|yes/i }).click();
    }
    await expect(page.getByText(/approved|success/i)).toBeVisible({ timeout: 10_000 });

    // 4. Verify enrollment status on student profile
    await page.goto('/students');
    await page
      .getByRole('link', { name: new RegExp(studentName, 'i') })
      .first()
      .click();
    await expect(page.getByText(/transferred/i)).toBeVisible({ timeout: 15_000 });
  });
});
