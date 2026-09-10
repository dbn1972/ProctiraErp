import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';
import { uniqueSuffix } from './fixtures/test-data';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: assessment entry → report card generation', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('admin can create scheme, items, enter results, and download a report card', async ({
    page,
  }) => {
    await loginAsTenantAdmin(page);

    const schemeName = `E2E Numeric Scheme ${uniqueSuffix()}`;

    // 1. Create a numeric grading scheme
    await page.goto('/assessments/schemes/new');
    await page.getByLabel(/scheme name|name/i).fill(schemeName);
    const typeSelect = page.getByLabel(/type|grading type/i);
    if ((await typeSelect.count()) > 0) {
      await typeSelect.click();
      await page.getByRole('option', { name: /numeric/i }).click();
    }
    await page.getByLabel(/min(imum)?/i).fill('0');
    await page
      .getByLabel(/max(imum)?|pass.*max/i)
      .first()
      .fill('100');
    await page.getByRole('button', { name: /create|save/i }).click();
    await expect(page.getByText(/created|saved|success/i)).toBeVisible({ timeout: 10_000 });

    // 2. Define 2 items (weights 60 and 40)
    await page.goto('/assessments/items');
    const itemDefs = [
      { name: `E2E Item A ${uniqueSuffix()}`, weight: '60' },
      { name: `E2E Item B ${uniqueSuffix()}`, weight: '40' },
    ];
    for (const item of itemDefs) {
      await page.getByRole('button', { name: /add item|new item|create/i }).click();
      await page.getByLabel(/item name|name/i).fill(item.name);
      await page.getByLabel(/weight/i).fill(item.weight);
      await page.getByRole('button', { name: /save|add|create/i }).click();
      await expect(page.getByText(item.name)).toBeVisible({ timeout: 10_000 });
    }

    // 3. Enter scores for one student
    await page.goto('/assessments/results');
    await page.getByLabel(/institution/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/class|section/i).click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: /load|fetch/i }).click();

    const firstScore = page.getByRole('row').nth(1).getByRole('textbox').first();
    await expect(firstScore).toBeVisible({ timeout: 15_000 });
    await firstScore.fill('80');

    const secondScore = page.getByRole('row').nth(1).getByRole('textbox').nth(1);
    await secondScore.fill('70');

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 10_000 });

    // 4. A report card download link is now available
    const downloadLink = page.getByRole('link', { name: /report card|download/i }).first();
    await expect(downloadLink).toBeVisible({ timeout: 15_000 });
  });
});
