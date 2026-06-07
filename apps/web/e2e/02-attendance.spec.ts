import { expect, test } from '@playwright/test';

import { loginAsTenantAdmin } from './fixtures/auth';

const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Critical journey: attendance marking → percentage verification', () => {
  test.skip(
    !BACKEND_READY,
    'E2E_BACKEND_READY is not set; skipping live-backend e2e test. See e2e/README.md.',
  );

  test('marking 3 present and 2 absent yields a 60% attendance rate report', async ({ page }) => {
    await loginAsTenantAdmin(page);

    await page.goto('/attendance');
    await expect(page.getByRole('heading', { name: /attendance/i })).toBeVisible();

    // Pick institution + class + period + today's date
    await page.getByLabel(/institution/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/class|section/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/academic period|period/i).click();
    await page.getByRole('option').first().click();

    const today = new Date().toISOString().slice(0, 10);
    await page.getByLabel(/date/i).fill(today);

    await page.getByRole('button', { name: /load roster|load|fetch/i }).click();

    // Wait for roster rows to appear
    const rows = page.getByRole('row').filter({ has: page.getByRole('radio') });
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });

    // Mark first 3 as PRESENT
    for (let i = 0; i < 3; i++) {
      const row = rows.nth(i);
      await row.getByRole('radio', { name: /present/i }).check();
    }

    // Mark next 2 as ABSENT
    for (let i = 3; i < 5; i++) {
      const row = rows.nth(i);
      await row.getByRole('radio', { name: /absent/i }).check();
    }

    await page.getByRole('button', { name: /save/i }).click();
    await expect(page.getByText(/saved|success/i)).toBeVisible({ timeout: 10_000 });

    // Verify attendance percentage report
    await page.goto('/attendance/reports');

    await page.getByLabel(/institution/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/class|section/i).click();
    await page.getByRole('option').first().click();

    await page.getByLabel(/academic period|period/i).click();
    await page.getByRole('option').first().click();

    await page.getByRole('button', { name: /run report|generate|view/i }).click();

    const percentage = page.getByText(/\d{1,3}\.\d{2}\s*%?/);
    await expect(percentage.first()).toBeVisible({ timeout: 15_000 });
    const text = await percentage.first().innerText();
    const match = text.match(/(\d{1,3}\.\d{2})/);
    expect(match).not.toBeNull();
    const value = Number(match![1]);
    expect(value).toBeGreaterThanOrEqual(59.5);
    expect(value).toBeLessThanOrEqual(60.5);
  });
});
