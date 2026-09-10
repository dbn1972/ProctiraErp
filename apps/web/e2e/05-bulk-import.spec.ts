import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { buildStudentsWorkbook } from './fixtures/students-workbook';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: Excel import → error review → confirm import', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('importing a workbook with one valid and one invalid row imports only the valid row', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    const { buffer, validRow, invalidRow } = await buildStudentsWorkbook();

    await page.goto('/students/import');
    await expect(page.getByRole('heading', { name: /import/i })).toBeVisible();

    // Upload via the file input. setInputFiles accepts an in-memory buffer.
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'students-with-errors.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer,
    });

    // Some UIs auto-process, others have a preview button
    const previewButton = page.getByRole('button', { name: /preview|next|review/i });
    if (
      await previewButton
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      await previewButton.first().click();
    }

    // Error preview shows the invalid row
    await expect(page.getByText(invalidRow.lastName)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/invalid|error|not.*date|required/i).first()).toBeVisible();

    // Confirm import of the valid rows only
    await page
      .getByRole('button', { name: /import valid|confirm|import/i })
      .first()
      .click();

    await expect(
      page.getByText(/imported.*1|1 row imported|success.*1|1 success/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // The valid row's name should be searchable on the student list
    await page.goto('/students');
    await page
      .getByPlaceholder(/search/i)
      .first()
      .fill(validRow.firstName);
    await expect(page.getByText(validRow.firstName).first()).toBeVisible({ timeout: 10_000 });
  });
});
