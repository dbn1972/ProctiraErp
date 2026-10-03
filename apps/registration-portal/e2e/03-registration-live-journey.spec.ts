import { expect, test } from '@playwright/test';

/**
 * PRC-M568 — live public admissions journey: submit -> track, plus negatives.
 *
 * Runs against a real gateway + seeded tenant/institution/published form:
 *   E2E_BACKEND_READY=1
 *   E2E_REGISTRATION_INSTITUTION_ID=<uuid of an institution whose published
 *     form has no required custom fields or documents>
 *   E2E_REGISTRATION_TYPE=<apply slug, default "primary">
 *
 * Fail closed: on main (GITHUB_REF=refs/heads/main) or with
 * E2E_REQUIRE_LIVE=1 a missing backend is a failure, not a silent skip.
 */
const BACKEND_READY = !!process.env.E2E_BACKEND_READY;
const REQUIRE_LIVE =
  process.env.E2E_REQUIRE_LIVE === '1' || process.env.GITHUB_REF === 'refs/heads/main';
const INSTITUTION_ID = process.env.E2E_REGISTRATION_INSTITUTION_ID ?? '';
const TYPE = process.env.E2E_REGISTRATION_TYPE ?? 'primary';

test.describe('Registration Portal — live gate', () => {
  test('live journey is configured where it is required', () => {
    test.skip(!REQUIRE_LIVE, 'live journey not required on this ref');
    expect(BACKEND_READY, 'E2E_BACKEND_READY must be set on main / E2E_REQUIRE_LIVE').toBe(true);
    expect(INSTITUTION_ID, 'E2E_REGISTRATION_INSTITUTION_ID must be seeded').not.toBe('');
  });
});

test.describe('Registration Portal — live submit and track', () => {
  test.skip(!BACKEND_READY, 'E2E_BACKEND_READY is not set; skipping live registration journey.');
  test.describe.configure({ mode: 'serial' });

  const dob = '2018-04-12';
  let trackingNumber = '';

  test('applicant submits and receives a tracking number', async ({ page }) => {
    expect(INSTITUTION_ID, 'E2E_REGISTRATION_INSTITUTION_ID must be seeded').not.toBe('');
    await page.goto(`/apply/${TYPE}?institutionId=${encodeURIComponent(INSTITUTION_ID)}`);
    await page.getByLabel(/first name/i).fill('E2E');
    await page.getByLabel(/last name/i).fill(`Applicant${Date.now() % 100000}`);
    await page.getByLabel(/date of birth/i).fill(dob);
    await page.locator('#gender').selectOption('female');
    await page.getByLabel(/guardian name/i).fill('E2E Guardian');
    await page.getByLabel(/guardian phone/i).fill('+911234567890');
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page).toHaveURL(/\/documents/);
    await page.getByRole('button', { name: /^next$/i }).click();

    await expect(page).toHaveURL(/\/review/);
    await page.getByRole('button', { name: /^submit$/i }).click();

    await expect(page).toHaveURL(/\/apply\/success/, { timeout: 30_000 });
    const number = page.getByText(/^REG-[A-Z0-9]{8}$/);
    await expect(number).toBeVisible();
    trackingNumber = (await number.textContent())!.trim();
  });

  test('the submitted application is found with the right DOB', async ({ page }) => {
    expect(trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill(trackingNumber);
    await page.getByLabel(/date of birth|dob/i).fill(dob);
    await page.getByRole('button', { name: /check status/i }).click();
    await expect(page).not.toHaveURL(/[?&]dob=/);
    await expect(page.getByText(/pending review|under review/i).first()).toBeVisible();
  });

  test('a wrong DOB does not reveal the application', async ({ page }) => {
    expect(trackingNumber).toMatch(/^REG-[A-Z0-9]{8}$/);
    await page.goto('/track');
    await page.getByLabel(/tracking number/i).fill(trackingNumber);
    await page.getByLabel(/date of birth|dob/i).fill('2017-01-01');
    await page.getByRole('button', { name: /check status/i }).click();
    await expect(page.getByText(/no application was found/i).first()).toBeVisible();
    await expect(page.getByText(/pending review|under review/i)).toHaveCount(0);
  });

  test('backend down: submit shows an error instead of a fake success', async ({ page }) => {
    expect(INSTITUTION_ID).not.toBe('');
    await page.route(/\/api\/registrations(\?|$)/, (route) =>
      route.request().method() === 'POST' ? route.abort('connectionrefused') : route.continue(),
    );
    await page.goto(`/apply/${TYPE}?institutionId=${encodeURIComponent(INSTITUTION_ID)}`);
    await page.getByLabel(/first name/i).fill('E2E');
    await page.getByLabel(/last name/i).fill('Down');
    await page.getByLabel(/date of birth/i).fill(dob);
    await page.locator('#gender').selectOption('male');
    await page.getByLabel(/guardian name/i).fill('E2E Guardian');
    await page.getByLabel(/guardian phone/i).fill('+911234567890');
    await page.getByRole('button', { name: /^next$/i }).click();
    await page.getByRole('button', { name: /^next$/i }).click();
    await page.getByRole('button', { name: /^submit$/i }).click();
    await expect(page.getByRole('alert').first()).toBeVisible();
    await expect(page).not.toHaveURL(/\/apply\/success/);
  });
});
