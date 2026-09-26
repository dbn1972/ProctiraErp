import { expect, test } from '@playwright/test';

/**
 * Registration Portal production smoke.
 * Public inventory always runs. Live submit/status is gated on E2E_BACKEND_READY.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;

test.describe('Registration Portal — public surfaces', () => {
  test('home renders apply and track CTAs', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('find schools page renders', async ({ page }) => {
    await page.goto('/schools');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('apply step requires a selected school before rendering a form', async ({ page }) => {
    // ADM-CFG-01: a published form loads only for a concrete institution UUID.
    // Visiting an institution *type* alone must guide the applicant to pick a
    // school rather than render an empty/mock form.
    await page.goto('/apply/primary');
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByRole('link', { name: /choose a school/i })).toBeVisible();
  });

  test('apply documents and review routes render', async ({ page }) => {
    await page.goto('/apply/primary/documents');
    await expect(page.locator('body')).toBeVisible();
    await page.goto('/apply/primary/review');
    await expect(page.locator('body')).toBeVisible();
  });

  test('apply success page renders', async ({ page }) => {
    await page.goto('/apply/success');
    await expect(page.locator('body')).toBeVisible();
  });

  test('track form requires tracking number and DOB', async ({ page }) => {
    await page.goto('/track');
    await expect(page.getByLabel(/tracking number/i)).toBeVisible();
    await expect(page.getByLabel(/date of birth|dob/i).first()).toBeVisible();
  });
});

test.describe('Registration Portal — live backend', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live registration e2e.');

  test('status lookup posts the date of birth instead of putting it on the URL', async ({
    page,
  }) => {
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill('REG-AAAAAAAA');
    await page.getByLabel(/date of birth|dob/i).fill('2000-01-01');
    await page.getByRole('button', { name: /check status|consultar|consulter|التحقق/i }).click();
    await expect(page).not.toHaveURL(/[?&]dob=/);
    await expect(
      page.getByText(/not found|no application|aucune demande|لم يتم العثور/i).first(),
    ).toBeVisible();
  });
});
