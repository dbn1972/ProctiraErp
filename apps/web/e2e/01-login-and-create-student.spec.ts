import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { makeTestStudent } from './fixtures/test-data';
import { runAxe } from './helpers/axe';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: login → institution → create student → enroll', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('admin can create and enroll a student in their first institution', async ({ page }) => {
    const student = makeTestStudent();

    // 1. Login as tenant admin
    await loginAsTenantAdmin(page);

    // Task 56.7 — the signed-in landing must pass WCAG 2.1 AA before
    // the user navigates further. Putting the checkpoint right after
    // login means a regression in the dashboard shell (sidebar, app
    // bar, breadcrumbs) fails the canonical journey test.
    await runAxe(page, { checkpointLabel: 'dashboard landing' });

    // 2. Open institutions list and pick the first institution
    await page.goto('/institutions');
    await expect(page.getByRole('heading', { name: /institutions/i })).toBeVisible();
    const firstInstitution = page.getByRole('link', { name: /^\s*\S+/ }).first();
    await firstInstitution.click();
    await expect(page).not.toHaveURL(/\/institutions\/?$/);

    // 3. Navigate to the new-student form and submit it
    await page.goto('/students/new');
    await page.getByLabel(/first name/i).fill(student.firstName);
    await page.getByLabel(/last name/i).fill(student.lastName);
    await page.getByLabel(/date of birth/i).fill(student.dateOfBirth);

    const genderSelect = page.getByLabel(/gender/i);
    if ((await genderSelect.count()) > 0) {
      await genderSelect.selectOption({ label: student.gender }).catch(async () => {
        await genderSelect.click();
        await page.getByRole('option', { name: student.gender }).click();
      });
    }

    await page.getByRole('button', { name: /create|save|submit/i }).click();

    // 4. Profile page loads with the newly created student name
    await expect(page.getByRole('heading', { name: new RegExp(student.firstName) })).toBeVisible({
      timeout: 15_000,
    });

    // 5. Enroll the student
    const enrollEntry = page.getByRole('link', { name: /enroll(ment)?/i }).first();
    if (await enrollEntry.isVisible().catch(() => false)) {
      await enrollEntry.click();
    }
    await page.getByRole('button', { name: /^enroll$/i }).click();

    const gradeSelect = page.getByLabel(/grade|education grade/i);
    await gradeSelect.click();
    await page.getByRole('option').first().click();

    const classSelect = page.getByLabel(/class|section/i);
    await classSelect.click();
    await page.getByRole('option').first().click();

    const periodSelect = page.getByLabel(/academic period|period/i);
    await periodSelect.click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: /submit|save|enroll/i }).click();

    await expect(page.getByText(/enrolled/i)).toBeVisible({ timeout: 15_000 });
  });
});
